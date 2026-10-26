/**
 * Contratos académicos: ítems, soluciones, intentos, evaluaciones y decisiones (spec §7).
 *
 * Límites conscientes:
 * - `solution` es JSON agnóstico a disciplina: no exige números, unidades ni estructura
 *   propia de una materia (§7.1).
 * - El snapshot del intento excluye la solución: mostrarla antes de responder rompería el ítem.
 * - Las reglas «puntuación por todos y solo los criterios», «una cabeza aceptada por intento»
 *   y la inmutabilidad tras `ready` requieren el rubric_snapshot y la DB: quedan anotadas.
 */
import { z, type ZodType } from 'zod';
import { canonicalDigest, CanonicalJsonError } from './canonical.js';
import {
  MAX_DESCRIPTION_CHARS,
  MAX_LIST_ITEMS,
} from './constants.js';
import { provenanceOriginSchema } from './enums.js';
import { reasonTextSchema } from './errors.js';
import {
  contentTextSchema,
  contextKeySchema,
  extensionsSchema,
  jsonValueSchema,
  resourceIdSchema,
  schemaVersionSchema,
  sha256Schema,
  sourceRefSchema,
  utcInstantSchema,
  uuidV7Schema,
} from './primitives.js';
import { rubricSchema, uncoveredSkills, type Rubric } from './rubric.js';

/* ------------------------------------------------------------------ *
 * Procedencia (§5.2, §7.1)
 * ------------------------------------------------------------------ */

export const provenanceSchema = z
  .object({
    origin: provenanceOriginSchema,
    provider_ref: z.string().max(200).optional(),
    model_ref: z.string().max(200).optional(),
    generation_request_uid: uuidV7Schema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.origin === 'ai-generated' && value.provider_ref === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['provider_ref'],
        message: 'ai-generated content must record its provider',
      });
    }
    if (value.origin !== 'ai-generated' && value.generation_request_uid !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['origin'],
        message: 'generation_request_uid only applies to origin=ai-generated',
      });
    }
  })
  .meta({
    'x-runtime-validation':
      'Zod exige provider_ref cuando origin=ai-generated; el resto de campos de runtime (actor, rol, token de aprobación) no existen en este contrato (§8.2).',
  });

export type Provenance = z.output<typeof provenanceSchema>;

/* ------------------------------------------------------------------ *
 * Declaración de solución (§7.1) — JSON agnóstico a disciplina
 * ------------------------------------------------------------------ */

export const solutionToleranceSchema = z
  .object({
    value: z.number().min(0),
    kind: z.enum(['absolute', 'relative']),
  })
  .strict();

export const solutionDeclarationSchema = z
  .object({
    answer: jsonValueSchema,
    units: z.array(z.string().min(1).max(32)).max(16).optional(),
    tolerance: solutionToleranceSchema.optional(),
    expected_justification: z.string().max(MAX_DESCRIPTION_CHARS).optional(),
    notes: z.string().max(MAX_DESCRIPTION_CHARS).optional(),
    extensions: extensionsSchema.optional(),
  })
  .strict()
  .meta({
    'x-runtime-validation':
      '`answer` es JSON arbitrario validado con el guard de la autoridad canónica (JSON estricto, acotado, sin ciclos ni claves de prototipo, sin ejecución); units/tolerance son opcionales porque otras disciplinas no usan números. JSON Schema lo ve como cualquier valor.',
  });

export type SolutionDeclaration = z.output<typeof solutionDeclarationSchema>;

/* ------------------------------------------------------------------ *
 * Ítems (§7.1)
 * ------------------------------------------------------------------ */

function itemContentShape<S extends ZodType>(refSchema: S) {
  return {
    statement: contentTextSchema,
    skill_ids: z.array(resourceIdSchema).min(1).max(MAX_LIST_ITEMS),
    context_key: contextKeySchema,
    source_refs: z.array(refSchema).min(1).max(MAX_LIST_ITEMS),
    solution: solutionDeclarationSchema,
    rubric: rubricSchema,
    provenance: provenanceSchema,
  };
}

type ItemContent = {
  skill_ids: readonly string[];
  source_refs: ReadonlyArray<{ resource_id: string; release_id?: string }>;
  context_key: string;
  rubric: Rubric;
};

function refKey(ref: { resource_id: string; release_id?: string }): string {
  return ref.release_id === undefined ? ref.resource_id : `${ref.release_id}|${ref.resource_id}`;
}

function refineItemContent(value: ItemContent, ctx: z.RefinementCtx): void {
  const skills = new Set<string>();
  value.skill_ids.forEach((skillId, index) => {
    if (skills.has(skillId)) {
      ctx.addIssue({ code: 'custom', path: ['skill_ids', index], message: `duplicate skill id: ${skillId}` });
    }
    skills.add(skillId);
  });

  const refs = new Set<string>();
  value.source_refs.forEach((ref, index) => {
    const key = refKey(ref);
    if (refs.has(key)) {
      ctx.addIssue({
        code: 'custom',
        path: ['source_refs', index],
        message: `duplicate source ref: ${key}`,
      });
    }
    refs.add(key);
  });

  const missing = uncoveredSkills(value.rubric, value.skill_ids);
  for (const skillId of missing) {
    ctx.addIssue({
      code: 'custom',
      path: ['rubric'],
      message: `skill ${skillId} has no criterion in the rubric`,
    });
  }

  for (const criterion of value.rubric.criteria) {
    for (const skillId of Object.keys(criterion.skill_weights)) {
      if (!skills.has(skillId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['rubric'],
          message: `criterion ${criterion.id} weights skill ${skillId}, which is not an objective of the item`,
        });
      }
    }
  }
}

const itemContentMeta = {
  'x-runtime-validation':
    'Zod superRefine exige skills únicos, source_refs únicos, que toda habilidad tenga al menos un criterio y que los pesos solo apunten a habilidades del ítem (§7.1). JSON Schema no puede cruzar rubric con skill_ids.',
};

/**
 * Referencia de fuente dentro de un **banco publicado**: solo `resource_id` y
 * `digest` del propio Notebook, nunca un `release_id` local de instalación
 * (§4.1, CF01). El Core vincula la release local al preparar el ítem.
 */
export const catalogSourceRefSchema = z
  .object({
    resource_id: resourceIdSchema,
    digest: sha256Schema,
  })
  .strict();

export type CatalogSourceRef = z.output<typeof catalogSourceRefSchema>;

/**
 * Definición de ítem de un banco publicado dentro del Notebook
 * (`diagnostic_items_path`/`assessment_items_path`, §4.1/CF01): todas sus
 * referencias son relativas al paquete.
 */
export const catalogItemDefinitionSchema = z
  .object({
    definition_id: resourceIdSchema,
    ...itemContentShape(catalogSourceRefSchema),
    extensions: extensionsSchema.optional(),
  })
  .strict()
  .superRefine(refineItemContent)
  .meta({
    ...itemContentMeta,
    'x-runtime-validation':
      'Refs de fuente relativas al propio Notebook {resource_id,digest}: un banco publicado no conoce el release_id local de ninguna instalación (§4.1, CF01). ' +
      'Además exige skills únicos, source_refs únicos, rúbrica que cubra toda habilidad y pesos solo del ítem; JSON Schema no puede cruzar rubric con skill_ids.',
  });

export type CatalogItemDefinition = z.output<typeof catalogItemDefinitionSchema>;

/**
 * Definición de ítem **ya vinculada** a una inscripción (propuesta aprobada):
 * usa las referencias completas `{release_id, resource_id, digest}` de Portfolio
 * (§5.2, §7.1, CF01). El Core valida que la release coincida con la inscripción.
 */
export const itemDefinitionSchema = z
  .object({
    definition_id: resourceIdSchema,
    ...itemContentShape(sourceRefSchema),
    extensions: extensionsSchema.optional(),
  })
  .strict()
  .superRefine(refineItemContent)
  .meta(itemContentMeta);

export type ItemDefinition = z.output<typeof itemDefinitionSchema>;

/** Ítem persistido antes de la respuesta (§7.1). */
export const itemSchema = z
  .object({
    schema_version: schemaVersionSchema,
    item_uid: uuidV7Schema,
    enrollment_uid: uuidV7Schema,
    release_id: uuidV7Schema,
    assignment_uid: uuidV7Schema.nullable(),
    created_event_seq: z.int().min(1).optional(),
    revision: z.int().min(1).optional(),
    ...itemContentShape(sourceRefSchema),
  })
  .strict()
  .superRefine(refineItemContent)
  .meta(itemContentMeta);

export type Item = z.output<typeof itemSchema>;

/** Catálogo de ítems revisados por autor (`diagnostic_items_path` / `assessment_items_path`). */
export const itemCatalogSchema = z
  .object({
    schema_version: schemaVersionSchema,
    items: z.array(catalogItemDefinitionSchema).min(1).max(MAX_LIST_ITEMS),
    extensions: extensionsSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    const ids = new Set<string>();
    value.items.forEach((item, index) => {
      if (ids.has(item.definition_id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['items', index, 'definition_id'],
          message: `duplicate definition id: ${item.definition_id}`,
        });
      }
      ids.add(item.definition_id);
    });
  })
  .meta({
    'x-runtime-validation':
      'Zod superRefine exige definition_id únicos dentro del catálogo; la unicidad global entre catálogos declarados la comprueba validateNotebookContracts para que PrepareItem no acepte un id ambiguo.',
  });

export type ItemCatalog = z.output<typeof itemCatalogSchema>;

/* ------------------------------------------------------------------ *
 * Intento (§7.2)
 * ------------------------------------------------------------------ */

/** Snapshot servido al alumno: sin solución, para no revelarla. */
export const attemptItemSnapshotSchema = z
  .object({
    statement: contentTextSchema,
    skill_ids: z.array(resourceIdSchema).min(1).max(MAX_LIST_ITEMS),
    context_key: contextKeySchema,
    source_refs: z.array(sourceRefSchema).min(1).max(MAX_LIST_ITEMS),
    provenance: provenanceSchema,
  })
  .strict();

export const answerSnapshotSchema = z
  .object({
    value: jsonValueSchema,
    sha256: sha256Schema,
    artifact_refs: z.array(uuidV7Schema).max(32).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    let expected: string;
    try {
      expected = canonicalDigest(value.value);
    } catch (error) {
      // Un safeParse nunca debe lanzar por una entrada JSON inválida (CF05).
      if (error instanceof CanonicalJsonError) {
        ctx.addIssue({ code: 'custom', path: ['value'], message: error.message });
        return;
      }
      throw error;
    }
    if (expected !== value.sha256) {
      ctx.addIssue({
        code: 'custom',
        path: ['sha256'],
        message: `sha256 must be the RFC 8785 canonical digest of value (expected ${expected})`,
      });
    }
  })
  .meta({
    'x-runtime-validation':
      'Zod comprueba que sha256 sea el digest canónico RFC 8785 de `value`; si `value` no es JSON estricto, el guard de la autoridad canónica se convierte en issue (safeParse no lanza). JSON Schema no puede calcular hashes.',
  });

export type AnswerSnapshot = z.output<typeof answerSnapshotSchema>;

export const attemptSchema = z
  .object({
    schema_version: schemaVersionSchema,
     attempt_uid: uuidV7Schema,
    session_uid: uuidV7Schema,
    enrollment_uid: uuidV7Schema,
    release_id: uuidV7Schema,
    assignment_uid: uuidV7Schema.nullable(),
    item_uid: uuidV7Schema,
    item_snapshot: attemptItemSnapshotSchema,
    rubric_snapshot: rubricSchema,
    answer_snapshot: answerSnapshotSchema,
    submitted_at: utcInstantSchema,
    hints_used: z.int().min(0),
    served_hint_count: z.int().min(0),
    declared_external_hints: z.int().min(0),
    hint_through_event_seq: z.int().min(0),
    context_key: contextKeySchema,
    capture_source: z.enum(['cli', 'opencode']),
    submitted_event_seq: z.int().min(1).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const expected = value.served_hint_count + value.declared_external_hints;
    if (value.hints_used !== expected) {
      ctx.addIssue({
        code: 'custom',
        path: ['hints_used'],
        message: `hints_used must equal served_hint_count + declared_external_hints (expected ${expected})`,
      });
    }
    if (value.context_key !== value.item_snapshot.context_key) {
      ctx.addIssue({
        code: 'custom',
        path: ['context_key'],
        message: 'context_key must match the item snapshot',
      });
    }
    const snapshotSkills = new Set(value.item_snapshot.skill_ids);
    for (const skillId of uncoveredSkills(value.rubric_snapshot, value.item_snapshot.skill_ids)) {
      ctx.addIssue({
        code: 'custom',
        path: ['rubric_snapshot'],
        message: `skill ${skillId} has no criterion in the rubric snapshot`,
      });
    }
    for (const criterion of value.rubric_snapshot.criteria) {
      for (const skillId of Object.keys(criterion.skill_weights)) {
        if (!snapshotSkills.has(skillId)) {
          ctx.addIssue({
            code: 'custom',
            path: ['rubric_snapshot'],
            message: `criterion ${criterion.id} weights skill ${skillId}, absent from the item snapshot`,
          });
        }
      }
    }
  })
  .meta({
    'x-runtime-validation':
      'Zod fija hints_used = served + declared (§6.2) y coherencia snapshot/rúbrica. La unicidad de un intento puntuable por ítem y el orden por submitted_event_seq son invariantes de SQLite/Core.',
  });

export type Attempt = z.output<typeof attemptSchema>;

/* ------------------------------------------------------------------ *
 * Evaluación y decisión (§7.2)
 * ------------------------------------------------------------------ */

export const criteriaJustificationSchema = z
  .object({
    text: contentTextSchema,
    response_refs: z.array(z.string().min(1).max(200)).min(1).max(64),
  })
  .strict();

export const evaluatorSchema = z
  .object({
    kind: z.enum(['human', 'model']),
    provider_ref: z.string().max(200).optional(),
    model_ref: z.string().max(200).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.kind === 'model' && value.provider_ref === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['provider_ref'],
        message: 'model evaluators must record their provider',
      });
    }
  })
  .meta({
    'x-runtime-validation':
      'Proveedor/modelo/actor provienen del runtime, nunca del input del LLM (§9.2): el Core los inyecta al registrar la evaluación.',
  });

export type Evaluator = z.output<typeof evaluatorSchema>;

export const assessmentSchema = z
  .object({
    schema_version: schemaVersionSchema,
     assessment_uid: uuidV7Schema,
    attempt_uid: uuidV7Schema,
    supersedes_assessment_uid: uuidV7Schema.nullable(),
    rubric_digest: sha256Schema,
    criteria_scores: z.record(resourceIdSchema, z.int().min(0).max(100)),
    criteria_justifications: z.record(resourceIdSchema, criteriaJustificationSchema),
    feedback: contentTextSchema,
    evaluator: evaluatorSchema,
    confidence_in_evaluation: z.number().min(0).max(1).optional(),
    recorded_event_seq: z.int().min(1).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.supersedes_assessment_uid !== null && value.supersedes_assessment_uid === value.assessment_uid) {
      ctx.addIssue({
        code: 'custom',
        path: ['supersedes_assessment_uid'],
        message: 'an assessment cannot supersede itself',
      });
    }
    const scoreKeys = Object.keys(value.criteria_scores).sort();
    const justificationKeys = Object.keys(value.criteria_justifications).sort();
    if (scoreKeys.join(',') !== justificationKeys.join(',')) {
      ctx.addIssue({
        code: 'custom',
        path: ['criteria_justifications'],
        message: 'criteria_scores and criteria_justifications must cover the same criterion ids',
      });
    }
    if (value.confidence_in_evaluation !== undefined && !Number.isFinite(value.confidence_in_evaluation)) {
      ctx.addIssue({ code: 'custom', path: ['confidence_in_evaluation'], message: 'confidence must be finite' });
    }
  })
  .meta({
    'x-runtime-validation':
      'Zod no puede exigir «todos y solo los criterios» sin el rubric_snapshot, ni comprobar que supersedes apunte a la cabeza aceptada del mismo intento: lo verifica Core bajo bloqueo (§6.1, §7.2).',
  });

export type Assessment = z.output<typeof assessmentSchema>;

export const assessmentDecisionSchema = z
  .object({
    schema_version: schemaVersionSchema,
     decision_uid: uuidV7Schema,
    assessment_uid: uuidV7Schema,
    decision: z.enum(['accepted', 'rejected']),
    reason: reasonTextSchema,
    actor: z.string().min(1).max(200),
    event_seq: z.int().min(1).optional(),
  })
  .strict()
  .meta({
    'x-runtime-validation':
      '`actor` lo asigna Core desde el CommandContext (§8.2): no es un campo de input del modelo. La decisión es append-only y terminal por evaluación.',
  });

export type AssessmentDecision = z.output<typeof assessmentDecisionSchema>;

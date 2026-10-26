/**
 * Comandos: envelope `Mutation<T>` e inputs de la API pública (spec §9.2).
 *
 * Convenciones:
 * - Inputs en camelCase (son llamadas TS/JSON-RPC del facade); los documentos y exportaciones
 *   de dominio usan snake_case (YAML/SQLite).
 * - Ningún input de modelo contiene `actor`, rol, workspace root, paths de destino ni tokens
 *   de aprobación: eso vive en el `CommandContext` interno (§8.2). Se marca con
 *   `x-input-audience: llm-domain` frente a `administrative-local`, que solo se expone por
 *   facades de usuario/CLI y jamás en el catálogo de herramientas del agente.
 */
import { z, type ZodType } from 'zod';
import { canonicalJson, CanonicalJsonError } from './canonical.js';
import { MAX_CONTENT_BYTES } from './constants.js';
import {
  itemDefinitionSchema,
  provenanceSchema,
  answerSnapshotSchema,
  criteriaJustificationSchema,
} from './academic.js';
import {
  MASTERY_ALGORITHM_VERSION,
  artifactModeSchema,
  consentCategorySchema,
  consentPurposeSchema,
} from './enums.js';
import { reasonTextSchema } from './errors.js';
import {
  contentTextSchema,
  fullCommitSchema,
  httpsUrlSchema,
  localPathSchema,
  resourceIdSchema,
  sha256Schema,
  utcInstantSchema,
  uuidV7Schema,
} from './primitives.js';
import { bcp47Schema } from './bcp47.js';
import { portablePathSchema } from './paths.js';
import {
  adoptionInputSchema,
  assignmentObservationInputSchema,
  profilePreferencesSchema,
  sessionStatusInputSchema,
  startSessionInputSchema,
} from './portfolio.js';

/** Envelope de toda mutación pública (§9.2). */
export type Mutation<T> = {
  idempotencyKey: string;
  expectedRevisions?: Record<string, number>;
  input: T;
};

export type EnrollmentRef = { enrollmentUid: string };
export type ReleaseRef = { releaseId: string };

export const INPUT_AUDIENCES = ['llm-domain', 'administrative-local'] as const;
export type InputAudience = (typeof INPUT_AUDIENCES)[number];

/**
 * Envuelve un input en el envelope de idempotencia.
 * `expectedRevisions` debe contener una entrada por cada agregado mutable existente afectado;
 * eso solo lo sabe Core en la transacción, por eso queda anotado y no pretendido por JSON Schema.
 */
export function mutationEnvelope<S extends ZodType>(input: S, audience: InputAudience = 'llm-domain') {
  return z
    .object({
      idempotencyKey: uuidV7Schema,
      expectedRevisions: z.record(uuidV7Schema, z.int().min(1)).optional(),
      input,
    })
    .strict()
    .superRefine((value, ctx) => {
      // Límite agregado de 2 MiB (§9.2): el input debe ser JSON estricto y caber
      // en bytes UTF-8. Se calcula con la autoridad canónica; sus errores se
      // convierten en issue para que safeParse nunca lance.
      const inputValue = (value as { input: unknown }).input;
      let bytes: number;
      try {
        bytes = Buffer.byteLength(canonicalJson(inputValue), 'utf8');
      } catch (error) {
        if (error instanceof CanonicalJsonError) {
          ctx.addIssue({ code: 'custom', path: ['input'], message: `input must be strict JSON: ${error.message}` });
          return;
        }
        throw error;
      }
      if (bytes > MAX_CONTENT_BYTES) {
        ctx.addIssue({
          code: 'custom',
          path: ['input'],
          message: `input must serialize to at most ${MAX_CONTENT_BYTES} UTF-8 bytes; got ${bytes}`,
        });
      }
    })
    .meta({
      'x-input-audience': audience,
      'x-runtime-validation':
        'Zod valida la forma y que el input serialice a JSON estricto de ≤ 2 MiB (bytes agregados); Core exige una entrada en expectedRevisions por cada agregado mutable existente afectado y devuelve REVISION_CONFLICT si falta o está vieja (§5.4, §6.3). La clave de idempotencia se persiste antes de publicar archivos. JSON Schema no puede medir el tamaño agregado.',
    });
}

/* ------------------------------------------------------------------ *
 * Referencias de lectura (sin mutación)
 * ------------------------------------------------------------------ */

export const enrollmentRefInputSchema = z
  .object({ enrollmentUid: uuidV7Schema })
  .strict()
  .meta({
    'x-input-audience': 'llm-domain',
    'x-runtime-validation':
      'Core restringe la lectura al enrollment vinculado al contexto del ejecutor: conocer el UID no concede acceso (§8.2, §8.3).',
  });
export const releaseRefInputSchema = z
  .object({ releaseId: uuidV7Schema })
  .strict()
  .meta({
    'x-input-audience': 'llm-domain',
    'x-runtime-validation':
      'Solo se admiten releases del workspace instaladas; una release en cuarentena deja de servir fuentes académicas (§3.2).',
  });

export type EnrollmentRefInput = z.output<typeof enrollmentRefInputSchema>;
export type ReleaseRefInput = z.output<typeof releaseRefInputSchema>;

/* ------------------------------------------------------------------ *
 * Traducción (§5.3)
 * ------------------------------------------------------------------ */

/**
 * Destino de enlace Markdown relativo. No es un path de destino de sistema de archivos:
 * el Core publica los bundles y el modelo jamás elige rutas de escritura (§5.3).
 * Se rechazan esquemas (`javascript:`, `data:`, `file:`, `obsidian:`...), rutas absolutas,
 * espacios y queries locales (no admitidas en v0.1).
 */
export const markdownHrefSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine(
    (value) =>
      !value.includes(':') &&
      !value.includes('?') &&
      !value.startsWith('/') &&
      !/[\s\\]/.test(value) &&
      !/[\u0000-\u001F\u007F]/.test(value),
    { message: 'must be a relative markdown link without scheme, query, spaces or control characters' },
  );

export const translationProposalSchema = z
  .object({
    markdown: contentTextSchema,
    links: z
      .array(z.object({ source: markdownHrefSchema, target: markdownHrefSchema }).strict())
      .max(2000),
    provenance: provenanceSchema,
  })
  .strict()
  .meta({
    'x-runtime-validation':
      'El mapa de enlaces se valida contra el cierre del bundle con el parser CommonMark en Core/F3; aquí solo se acota la forma. Ningún campo es un path de destino (§5.3).',
  });

export type TranslationProposal = z.output<typeof translationProposalSchema>;

/* ------------------------------------------------------------------ *
 * Inputs del facade LLM (§9.2)
 * ------------------------------------------------------------------ */

export const createEnrollmentInputSchema = z
  .object({
    learnerUid: uuidV7Schema,
    releaseId: uuidV7Schema,
    previousEnrollmentUid: uuidV7Schema.optional(),
  })
  .strict()
  .meta({
    'x-input-audience': 'llm-domain',
    'x-runtime-validation':
      'Core valida que previousEnrollmentUid sea del mismo learner y de otra release, y que la inscripción no duplique release (§5.1, §6.1).',
  });

export const enrollmentStatusInputSchema = z
  .object({
    enrollmentUid: uuidV7Schema,
    targetStatus: z.enum(['active', 'paused', 'archived']),
  })
  .strict()
  .meta({
    'x-input-audience': 'llm-domain',
    'x-runtime-validation':
      'Solo el usuario cambia estado; pausar/archivar exige no tener sesión activa y archive es terminal (§5.4). Esas condiciones las comprueba Core.',
  });

export const prepareAssignmentInputSchema = z
  .object({
    enrollmentUid: uuidV7Schema,
    resourceId: resourceIdSchema,
    objectiveSkillIds: z.array(resourceIdSchema).max(10_000),
    mode: artifactModeSchema,
    targetLanguage: bcp47Schema.optional(),
    translationProposal: translationProposalSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.mode === 'translation' && value.translationProposal === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['translationProposal'],
        message: 'translation mode requires a translation proposal with provenance',
      });
    }
    if (value.mode === 'exact-copy' && value.translationProposal !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['translationProposal'],
        message: 'exact-copy mode must not carry a translation proposal',
      });
    }
    if (value.mode === 'exact-copy' && value.targetLanguage !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['targetLanguage'],
        message: 'exact-copy preserves bytes: targetLanguage only applies to translation',
      });
    }
    const seen = new Set<string>();
    value.objectiveSkillIds.forEach((skillId, index) => {
      if (seen.has(skillId)) {
        ctx.addIssue({ code: 'custom', path: ['objectiveSkillIds', index], message: `duplicate skill: ${skillId}` });
      }
      seen.add(skillId);
    });
  })
  .meta({
    'x-input-audience': 'llm-domain',
    'x-runtime-validation':
      'Zod fija la coherencia mode/propuesta/idioma. Core comprueba que resourceId y los skills pertenezcan a la release inscrita, elige paths y IDs, y exige aprobación para publicar (§5.2, §8.2). Una lista de objetivos vacía es válida si el Notebook no tiene currículo.',
  });

export const prepareItemInputSchema = z
  .discriminatedUnion('source', [
    z
      .object({
        source: z.literal('catalog'),
        enrollmentUid: uuidV7Schema,
        assignmentUid: uuidV7Schema.optional(),
        definitionId: resourceIdSchema,
      })
      .strict(),
    z
      .object({
        source: z.literal('proposed'),
        enrollmentUid: uuidV7Schema,
        assignmentUid: uuidV7Schema.optional(),
        definition: itemDefinitionSchema,
      })
      .strict(),
  ])
  .meta({
    'x-input-audience': 'llm-domain',
    'x-runtime-validation':
      'Una propuesta requiere aprobación de usuario sobre el snapshot completo antes de persistirse; los ítems de banco revisados por autor no necesitan aprobación individual (§7.1, §8.2). La aprobación no viaja en el input.',
  });

export const serveHintInputSchema = z
  .object({
    sessionUid: uuidV7Schema,
    itemUid: uuidV7Schema,
    hint: z
      .object({
        text: z.string().min(1).max(8_000),
        provenance: provenanceSchema,
      })
      .strict(),
  })
  .strict()
  .meta({
    'x-input-audience': 'llm-domain',
    'x-runtime-validation':
      'No existe campo ordinal: Core asigna el consecutivo bajo bloqueo y fija hints_used al enviar el intento (§6.2).',
  });

export const submitAttemptInputSchema = z
  .object({
    sessionUid: uuidV7Schema,
    itemUid: uuidV7Schema,
    answerSnapshot: answerSnapshotSchema,
    declaredExternalHints: z.int().min(0).max(1000),
  })
  .strict()
  .meta({
    'x-input-audience': 'llm-domain',
    'x-runtime-validation':
      'Sin actor, evaluación ni skill IDs: los skills salen del ítem fijado y el envío requiere permiso interactivo ligado al hash de la respuesta (§7.2, §8.2).',
  });

export const assessmentInputSchema = z
  .object({
    attemptUid: uuidV7Schema,
    rubricDigest: sha256Schema,
    criteriaScores: z.record(resourceIdSchema, z.int().min(0).max(100)),
    criteriaJustifications: z.record(resourceIdSchema, criteriaJustificationSchema),
    feedback: contentTextSchema,
    supersedesAssessmentUid: uuidV7Schema.optional(),
  })
  .strict()
  .meta({
    'x-input-audience': 'llm-domain',
    'x-runtime-validation':
      'Proveedor, modelo y actor provienen del runtime; Core valida la puntuación contra el rubric_snapshot (todos y solo los criterios) y que solo exista una propuesta pendiente por intento (§7.2). Toda evaluación que cuenta requiere aceptación del usuario.',
  });

export const assessmentDecisionInputSchema = z
  .object({
    assessmentUid: uuidV7Schema,
    decision: z.enum(['accepted', 'rejected']),
    reason: reasonTextSchema,
  })
  .strict()
  .meta({
    'x-input-audience': 'llm-domain',
    'x-runtime-validation':
      'La decisión es terminal y append-only; Core revalida la cabeza aceptada bajo bloqueo para evitar forks concurrentes (§6.1, §7.2).',
  });

export const completeAssignmentInputSchema = z
  .object({ assignmentUid: uuidV7Schema })
  .strict()
  .meta({
    'x-input-audience': 'llm-domain',
    'x-runtime-validation':
      'completed exige al menos un intento persistido y confirmación del alumno; es estado terminal (§5.4).',
  });

export const rebuildInputSchema = z
  .object({
    enrollmentUid: uuidV7Schema,
    algorithmVersion: z.literal(MASTERY_ALGORITHM_VERSION),
  })
  .strict()
  .meta({
    'x-input-audience': 'llm-domain',
    'x-runtime-validation':
      'Core captura H (`through_event_seq`) al iniciar el replay; el rebuild es siempre un comando explícito, nunca un side effect de una consulta (§7.3, §9.2).',
  });

export const recoveryInputSchema = z
  .object({ enrollmentUid: uuidV7Schema })
  .strict()
  .meta({
    'x-input-audience': 'llm-domain',
    'x-runtime-validation':
      'La recuperación reconcilia planes ya aceptados; no regenera con LLM ni vuelve a aprobar el plan (§6.4).',
  });

/* ------------------------------------------------------------------ *
 * Inputs administrativos (solo usuario/CLI, jamás catálogo de herramientas)
 * ------------------------------------------------------------------ */

export const installSourceSchema = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('local'), path: localPathSchema }).strict(),
    z.object({ type: z.literal('git'), url: httpsUrlSchema, commit: fullCommitSchema }).strict(),
  ])
  .meta({
    'x-input-audience': 'administrative-local',
    'x-runtime-validation':
      'Solo lo introduce la persona usuaria por CLI: la captura del origen y la aprobación vinculada al snapshot viven en Core (§3.2, §8.2).',
  });

export const installNotebookInputSchema = z
  .object({ source: installSourceSchema })
  .strict()
  .meta({
    'x-input-audience': 'administrative-local',
    'x-runtime-validation':
      'Instalación solo por usuario con aprobación vinculada al snapshot ya capturado (§8.2). HTTPS es el único transporte remoto; commit completo obligatorio para Git (§3.2).',
  });

export const quarantineNotebookInputSchema = z
  .object({
    releaseId: uuidV7Schema,
    reason: reasonTextSchema,
    observed: z
      .array(z.object({ path: portablePathSchema, sha256: sha256Schema }).strict())
      .min(1)
      .max(2000),
  })
  .strict()
  .meta({
    'x-input-audience': 'administrative-local',
    'x-runtime-validation':
      'Cuarentena solo desde ready, una sola vez, con causa e inventario observado; nunca repara ni sobrescribe (§3.2, §5.4).',
  });

export const profileSetInputSchema = z
  .object({
    learnerUid: uuidV7Schema,
    preferredInstructionLanguage: bcp47Schema.optional(),
    preferences: profilePreferencesSchema.optional(),
  })
  .strict()
  .meta({
    'x-input-audience': 'administrative-local',
    'x-runtime-validation':
      'Core valida cambios y regenera `portfolio/exports/profile.yaml` por el protocolo de archivos; editar la exportación no cambia estado (§2).',
  });

export const consentGrantInputSchema = z
  .object({
    learnerUid: uuidV7Schema,
    enrollmentUid: uuidV7Schema.optional(),
    provider: z.string().min(1).max(200),
    endpoint: z.string().min(1).max(500),
    model: z.string().max(200).optional(),
    purposes: z.array(consentPurposeSchema).min(1).max(8),
    categories: z.array(consentCategorySchema).min(1).max(8),
    expiresAt: utcInstantSchema,
  })
  .strict()
  .meta({
    'x-input-audience': 'administrative-local',
    'x-runtime-validation':
      'El consentimiento se guarda en SQLite con expiración (por defecto fin de sesión o 24 h, lo que ocurra antes); notas y assets quedan excluidos por defecto (§11).',
  });

export const consentRevokeInputSchema = z
  .object({
    grantUid: uuidV7Schema,
    reason: reasonTextSchema.optional(),
  })
  .strict()
  .meta({
    'x-input-audience': 'administrative-local',
    'x-runtime-validation':
      'La revocación interrumpe la sesión vinculada y bloquea siguientes disclosures; no borra envíos previos (§11).',
  });

export const adoptArtifactMutationSchema = mutationEnvelope(adoptionInputSchema, 'administrative-local');

export const createEnrollmentMutationSchema = mutationEnvelope(createEnrollmentInputSchema);
export const enrollmentStatusMutationSchema = mutationEnvelope(enrollmentStatusInputSchema);
export const startSessionMutationSchema = mutationEnvelope(startSessionInputSchema);
export const sessionStatusMutationSchema = mutationEnvelope(sessionStatusInputSchema);
export const prepareAssignmentMutationSchema = mutationEnvelope(prepareAssignmentInputSchema);
export const assignmentObservationMutationSchema = mutationEnvelope(assignmentObservationInputSchema);
export const prepareItemMutationSchema = mutationEnvelope(prepareItemInputSchema);
export const serveHintMutationSchema = mutationEnvelope(serveHintInputSchema);
export const submitAttemptMutationSchema = mutationEnvelope(submitAttemptInputSchema);
export const proposeAssessmentMutationSchema = mutationEnvelope(assessmentInputSchema);
export const decideAssessmentMutationSchema = mutationEnvelope(assessmentDecisionInputSchema);
export const completeAssignmentMutationSchema = mutationEnvelope(completeAssignmentInputSchema);
export const rebuildProjectionsMutationSchema = mutationEnvelope(rebuildInputSchema);
export const recoverSessionMutationSchema = mutationEnvelope(recoveryInputSchema);

export const installNotebookMutationSchema = mutationEnvelope(installNotebookInputSchema, 'administrative-local');
export const quarantineNotebookMutationSchema = mutationEnvelope(quarantineNotebookInputSchema, 'administrative-local');
export const profileSetMutationSchema = mutationEnvelope(profileSetInputSchema, 'administrative-local');
export const consentGrantMutationSchema = mutationEnvelope(consentGrantInputSchema, 'administrative-local');
export const consentRevokeMutationSchema = mutationEnvelope(consentRevokeInputSchema, 'administrative-local');

/* ------------------------------------------------------------------ *
 * Tipos derivados
 * ------------------------------------------------------------------ */

export type CreateEnrollmentInput = z.output<typeof createEnrollmentInputSchema>;
export type EnrollmentStatusInput = z.output<typeof enrollmentStatusInputSchema>;
export type PrepareAssignmentInput = z.output<typeof prepareAssignmentInputSchema>;
export type PrepareItemInput = z.output<typeof prepareItemInputSchema>;
export type ServeHintInput = z.output<typeof serveHintInputSchema>;
export type SubmitAttemptInput = z.output<typeof submitAttemptInputSchema>;
export type AssessmentInput = z.output<typeof assessmentInputSchema>;
export type AssessmentDecisionInput = z.output<typeof assessmentDecisionInputSchema>;
export type CompleteAssignmentInput = z.output<typeof completeAssignmentInputSchema>;
export type RebuildInput = z.output<typeof rebuildInputSchema>;
export type RecoveryInput = z.output<typeof recoveryInputSchema>;
export type InstallNotebookInput = z.output<typeof installNotebookInputSchema>;
export type QuarantineNotebookInput = z.output<typeof quarantineNotebookInputSchema>;
export type ProfileSetInput = z.output<typeof profileSetInputSchema>;
export type ConsentGrantInput = z.output<typeof consentGrantInputSchema>;
export type ConsentRevokeInput = z.output<typeof consentRevokeInputSchema>;

export type MutationOf<S extends ZodType> = Mutation<z.output<S>>;


/**
 * Contratos de Portfolio: perfil, inscripción, assignment y artifact (spec §5).
 *
 * Son exportaciones/DTOs de SQLite; editarlos no cambia estado. Las transiciones y la
 * pertenencia a enrollment/release se comprueban en Core, no aquí: queda anotado donde aplica.
 */
import { z } from 'zod';
import {
  MAX_DESCRIPTION_CHARS,
  MAX_LIST_ITEMS,
} from './constants.js';
import {
  artifactKindSchema,
  artifactModeSchema,
  artifactOriginSchema,
  artifactReviewStatusSchema,
  artifactStateSchema,
  assignmentStatusSchema,
  enrollmentStatusSchema,
  explanationDetailSchema,
  sessionKindSchema,
  sessionStatusSchema,
} from './enums.js';
import { reasonTextSchema } from './errors.js';
import {
  licenseSchema,
  resourceIdSchema,
  schemaVersionSchema,
  semverSchema,
  sha256Schema,
  sourceRefSchema,
  utcInstantSchema,
  uuidV7Schema,
} from './primitives.js';
import { bcp47Schema } from './bcp47.js';
import { portablePathSchema } from './paths.js';

/* ------------------------------------------------------------------ *
 * Perfil (§5.1)
 * ------------------------------------------------------------------ */

export const profilePreferencesSchema = z
  .object({
    explanation_detail: explanationDetailSchema,
    preferred_session_minutes: z.int().min(1).max(480),
  })
  .strict();

export type ProfilePreferences = z.output<typeof profilePreferencesSchema>;

/** Exportación regenerable de SQLite; no se importa automáticamente. */
export const profileSchema = z
  .object({
    schema_version: schemaVersionSchema,
     learner_uid: uuidV7Schema,
    preferred_instruction_language: bcp47Schema.optional(),
    preferences: profilePreferencesSchema,
  })
  .strict()
  .meta({
    'x-runtime-validation':
      'Core valida el learner activo, impide cambiar learner_uid por edición y regenera la exportación por el protocolo de archivos (§2).',
  });

export type Profile = z.output<typeof profileSchema>;

/* ------------------------------------------------------------------ *
 * Inscripción (§5.1)
 * ------------------------------------------------------------------ */

const notebookViewSchema = z
  .object({
    package_uid: uuidV7Schema,
    version: semverSchema,
    content_digest: sha256Schema,
  })
  .strict();

export const enrollmentSchema = z
  .object({
    schema_version: schemaVersionSchema,
     enrollment_uid: uuidV7Schema,
    learner_uid: uuidV7Schema,
    release_id: uuidV7Schema,
    notebook: notebookViewSchema,
    status: enrollmentStatusSchema,
    previous_enrollment_uid: uuidV7Schema.nullable(),
    revision: z.int().min(1).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.previous_enrollment_uid !== null && value.previous_enrollment_uid === value.enrollment_uid) {
      ctx.addIssue({
        code: 'custom',
        path: ['previous_enrollment_uid'],
        message: 'previous_enrollment_uid must reference another enrollment',
      });
    }
    if (value.notebook.version !== value.notebook.version.trim()) {
      ctx.addIssue({ code: 'custom', path: ['notebook', 'version'], message: 'version must not contain whitespace' });
    }
  })
  .meta({
    'x-runtime-validation':
      'Zod no puede comprobar que previous_enrollment_uid sea del mismo learner y de otra release (§5.1, §6.1), ni que package_uid no esté duplicado: lo verifica Core bajo bloqueo.',
  });

export type Enrollment = z.output<typeof enrollmentSchema>;

/* ------------------------------------------------------------------ *
 * Sesiones (§5.4)
 * ------------------------------------------------------------------ */

export const sessionSchema = z
  .object({
    schema_version: schemaVersionSchema,
     session_uid: uuidV7Schema,
    enrollment_uid: uuidV7Schema,
    kind: sessionKindSchema,
    status: sessionStatusSchema,
    started_at: utcInstantSchema,
    ended_at: utcInstantSchema.nullable().optional(),
    revision: z.int().min(1).optional(),
  })
  .strict()
  .meta({
    'x-runtime-validation':
      'Zod no impone la máquina de transiciones (§5.4) ni el máximo de una sesión active por enrollment: son reglas transaccionales de Core.',
  });

export type Session = z.output<typeof sessionSchema>;

/* ------------------------------------------------------------------ *
 * Assignment (§5.2)
 * ------------------------------------------------------------------ */

export const assignmentSchema = z
  .object({
    schema_version: schemaVersionSchema,
     assignment_uid: uuidV7Schema,
    enrollment_uid: uuidV7Schema,
    release_id: uuidV7Schema,
    source_resource_id: resourceIdSchema,
    source_digest: sha256Schema,
    material_uid: uuidV7Schema.nullable(),
    objective_skill_ids: z.array(resourceIdSchema).max(MAX_LIST_ITEMS),
    status: assignmentStatusSchema,
    supersedes_assignment_uid: uuidV7Schema.nullable(),
    revision: z.int().min(1).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.supersedes_assignment_uid !== null && value.supersedes_assignment_uid === value.assignment_uid) {
      ctx.addIssue({
        code: 'custom',
        path: ['supersedes_assignment_uid'],
        message: 'an assignment cannot supersede itself',
      });
    }
    const seen = new Set<string>();
    value.objective_skill_ids.forEach((skillId, index) => {
      if (seen.has(skillId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['objective_skill_ids', index],
          message: `duplicate objective skill: ${skillId}`,
        });
      }
      seen.add(skillId);
    });
  })
  .meta({
    'x-runtime-validation':
      'Zod no comprueba que material_uid pertenezca al mismo enrollment, que supersedes sea acíclico, que los skills existan en la release ni la máquina de estados (§5.4, §6.1): lo hace Core en transacción.',
  });

export type Assignment = z.output<typeof assignmentSchema>;

/* ------------------------------------------------------------------ *
 * Artifact (§5.2)
 * ------------------------------------------------------------------ */

const inventoryEntrySchema = z
  .object({
    path: portablePathSchema,
    size: z.int().min(0),
    sha256: sha256Schema,
  })
  .strict();

export const artifactSchema = z
  .object({
    schema_version: schemaVersionSchema,
     artifact_uid: uuidV7Schema,
    enrollment_uid: uuidV7Schema.nullable(),
    kind: artifactKindSchema,
    mode: artifactModeSchema.nullable().optional(),
    relative_path: portablePathSchema,
    inventory: z.array(inventoryEntrySchema).min(1).max(MAX_LIST_ITEMS),
    origin: artifactOriginSchema,
    source_refs: z.array(sourceRefSchema).max(MAX_LIST_ITEMS),
    derived_from: uuidV7Schema.optional(),
    language: bcp47Schema.optional(),
    provider_ref: z.string().max(200).optional(),
    model_ref: z.string().max(200).optional(),
    generation_request_uid: uuidV7Schema.optional(),
    license: licenseSchema,
    attribution: z.string().min(1).max(MAX_DESCRIPTION_CHARS),
    review_status: artifactReviewStatusSchema,
    state: artifactStateSchema,
    revision: z.int().min(1).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.mode !== null && value.mode !== undefined && value.kind !== 'material') {
      ctx.addIssue({
        code: 'custom',
        path: ['mode'],
        message: 'mode is only defined for kind=material (exact-copy | translation)',
      });
    }
    if (value.origin === 'ai-generated' && value.provider_ref === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['provider_ref'],
        message: 'ai-generated artifacts must record their provider',
      });
    }
    if (value.origin !== 'ai-generated' && (value.generation_request_uid !== undefined || value.model_ref !== undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: ['origin'],
        message: 'generation provenance fields require origin=ai-generated',
      });
    }
    const seen = new Set<string>();
    value.inventory.forEach((entry, index) => {
      if (seen.has(entry.path)) {
        ctx.addIssue({ code: 'custom', path: ['inventory', index, 'path'], message: `duplicate path: ${entry.path}` });
      }
      seen.add(entry.path);
    });
  })
  .meta({
    'x-runtime-validation':
      'Zod no comprueba que el inventario coincida con los bytes publicados, que relative_path no colisione con otros artifacts, que review_status=reviewed tenga decisión de usuario ni la inmutabilidad tras ready (§5.2): son invariantes de Core y de `doctor`.',
  });

export type Artifact = z.output<typeof artifactSchema>;

/* ------------------------------------------------------------------ *
 * Contratos pequeños reutilizados por comandos
 * ------------------------------------------------------------------ */

export const adoptionInputSchema = z
  .object({
    artifactUid: uuidV7Schema,
    reason: reasonTextSchema.optional(),
  })
  .strict()
  .meta({
    'x-input-audience': 'administrative-local',
    'x-runtime-validation':
      'La adopción exige aprobación de usuario sobre los bytes observados y crea un artifact nuevo `user-provided` enlazado por derived_from (§2).',
  });

export type AdoptionInput = z.output<typeof adoptionInputSchema>;

export const assignmentObservationInputSchema = z
  .object({
    assignmentUid: uuidV7Schema,
    observation: z.enum(['opened', 'read_declared', 'practicing']),
  })
  .strict()
  .meta({
    'x-input-audience': 'llm-domain',
    'x-runtime-validation':
      'Core comprueba que la observación corresponda a un assignment activo del enrollment vinculado, que la transición sea válida (§5.4) y que nunca signifique completed ni cambie mastery (§9.2).',
  });

export type AssignmentObservationInput = z.output<typeof assignmentObservationInputSchema>;

export const startSessionInputSchema = z
  .object({
    enrollmentUid: uuidV7Schema,
    kind: sessionKindSchema,
  })
  .strict()
  .meta({
    'x-input-audience': 'llm-domain',
    'x-runtime-validation': 'Core exige enrollment activo y máximo una sesión active por enrollment (§5.4).',
  });

export type StartSessionInput = z.output<typeof startSessionInputSchema>;

export const sessionStatusInputSchema = z
  .object({
    sessionUid: uuidV7Schema,
    targetStatus: sessionStatusSchema,
  })
  .strict()
  .meta({
    'x-input-audience': 'llm-domain',
    'x-runtime-validation': 'Transiciones no listadas en §5.4 devuelven INVALID_TRANSITION en Core',
  });

export type SessionStatusInput = z.output<typeof sessionStatusInputSchema>;

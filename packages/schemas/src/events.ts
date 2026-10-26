/**
 * Journal de eventos (spec §6.2).
 *
 * `LearningEvent` es una unión discriminada por `type` con el payload que la spec fija para
 * cada tipo. Los payloads contienen IDs, versión de contrato y valores de transición; no
 * duplican blobs que ya viven en las tablas de hechos.
 *
 * `event_seq` es el único orden autoritativo de replay y lo asigna Core; aquí se modela como
 * opcional para poder validar un evento antes de persistirlo.
 */
import { z } from 'zod';
import { provenanceSchema } from './academic.js';
import {
  artifactKindSchema,
  assignmentStatusSchema,
  consentCategorySchema,
  consentPurposeSchema,
  enrollmentStatusSchema,
  type EventType,
} from './enums.js';
import { structuredErrorSchema } from './errors.js';
import {
  contentTextSchema,
  packageIdSchema,
  resourceIdSchema,
  schemaVersionSchema,
  semverSchema,
  sha256Schema,
  utcInstantSchema,
  uuidV7Schema,
} from './primitives.js';
import { portablePathSchema } from './paths.js';

const eventEnvelope = {
  event_uid: uuidV7Schema,
  event_seq: z.int().min(1).optional(),
  aggregate_type: resourceIdSchema,
  aggregate_uid: uuidV7Schema,
  aggregate_revision: z.int().min(1),
  schema_version: schemaVersionSchema,
   actor: z.string().min(1).max(200),
  operation_uid: uuidV7Schema.optional(),
  occurred_at: utcInstantSchema,
  recorded_at: utcInstantSchema,
} as const;

function eventVariant<const TType extends EventType, T extends z.ZodRawShape>(
  type: TType,
  payloadShape: T,
) {
  return z
    .object({
      ...eventEnvelope,
      type: z.literal(type),
      payload: z.object(payloadShape).strict(),
    })
    .strict();
}

const installPayload = {
  release_id: uuidV7Schema,
  package_uid: uuidV7Schema,
  package_id: packageIdSchema,
  version: semverSchema,
  content_digest: sha256Schema,
  operation_uid: uuidV7Schema,
} as const;

const sessionPayload = {
  session_uid: uuidV7Schema,
  enrollment_uid: uuidV7Schema,
} as const;

const decisionPayload = {
  assessment_uid: uuidV7Schema,
  attempt_uid: uuidV7Schema,
  decision_uid: uuidV7Schema,
  reason: contentTextSchema,
} as const;

/**
 * Tipos de evento de v0.1 (§6.2) con sus payloads.
 * No existe `NotebookVersionActivated`.
 */
export const learningEventSchema = z.discriminatedUnion('type', [
  eventVariant('ProfileCreated', { learner_uid: uuidV7Schema }),
  eventVariant('ProfileChanged', {
    learner_uid: uuidV7Schema,
    changed_keys: z.array(z.string().min(1).max(128)).min(1).max(64),
  }),

  eventVariant('NotebookInstallStarted', installPayload),
  eventVariant('NotebookInstallRetried', installPayload),
  eventVariant('NotebookInstallFailed', { ...installPayload, error: structuredErrorSchema }),
  eventVariant('NotebookInstalled', installPayload),
  eventVariant('NotebookQuarantined', {
    release_id: uuidV7Schema,
    package_uid: uuidV7Schema,
    version: semverSchema,
    content_digest: sha256Schema,
    reason: contentTextSchema,
    observed: z
      .array(z.object({ path: portablePathSchema, sha256: sha256Schema }).strict())
      .min(1)
      .max(2000),
  }),

  eventVariant('EnrollmentCreated', {
    enrollment_uid: uuidV7Schema,
    learner_uid: uuidV7Schema,
    release_id: uuidV7Schema,
    previous_enrollment_uid: uuidV7Schema.nullable(),
  }),
  eventVariant('EnrollmentStatusChanged', {
    enrollment_uid: uuidV7Schema,
    from: enrollmentStatusSchema,
    to: enrollmentStatusSchema,
  }),

  eventVariant('AssignmentCreated', {
    assignment_uid: uuidV7Schema,
    enrollment_uid: uuidV7Schema,
    release_id: uuidV7Schema,
    resource_id: resourceIdSchema,
  }),
  eventVariant('AssignmentStatusChanged', {
    assignment_uid: uuidV7Schema,
    from: assignmentStatusSchema,
    to: assignmentStatusSchema,
  }),
  eventVariant('MaterialPrepared', {
    assignment_uid: uuidV7Schema,
    enrollment_uid: uuidV7Schema,
    material_uid: uuidV7Schema,
    artifact_uid: uuidV7Schema,
  }),

  eventVariant('ArtifactRegistered', {
    artifact_uid: uuidV7Schema,
    enrollment_uid: uuidV7Schema.nullable(),
    kind: artifactKindSchema,
    operation_uid: uuidV7Schema,
  }),
  eventVariant('ArtifactFailed', {
    artifact_uid: uuidV7Schema,
    operation_uid: uuidV7Schema,
    error: structuredErrorSchema,
  }),
  eventVariant('ArtifactAdopted', {
    artifact_uid: uuidV7Schema,
    derived_from: uuidV7Schema,
    enrollment_uid: uuidV7Schema.nullable(),
  }),

  eventVariant('ReadingDeclared', {
    assignment_uid: uuidV7Schema,
    enrollment_uid: uuidV7Schema,
    resource_id: resourceIdSchema,
  }),
  eventVariant('ResourceOpened', {
    enrollment_uid: uuidV7Schema,
    release_id: uuidV7Schema,
    resource_id: resourceIdSchema,
    assignment_uid: uuidV7Schema.nullable(),
  }),

  eventVariant('SessionStarted', sessionPayload),
  eventVariant('SessionPaused', sessionPayload),
  eventVariant('SessionResumed', sessionPayload),
  eventVariant('SessionFinished', sessionPayload),

  eventVariant('ItemPrepared', {
    item_uid: uuidV7Schema,
    enrollment_uid: uuidV7Schema,
    release_id: uuidV7Schema,
    assignment_uid: uuidV7Schema.nullable(),
    artifact_uid: uuidV7Schema.nullable(),
  }),

  // Payload fijado por §6.2: ordinal consecutivo asignado por Core, nunca elegido por el modelo.
  eventVariant('HintServed', {
    enrollment_uid: uuidV7Schema,
    release_id: uuidV7Schema,
    session_uid: uuidV7Schema,
    item_uid: uuidV7Schema,
    ordinal: z.int().min(1),
    hint_snapshot: contentTextSchema,
    provenance: provenanceSchema,
  }),

  eventVariant('AttemptSubmitted', {
    attempt_uid: uuidV7Schema,
    session_uid: uuidV7Schema,
    enrollment_uid: uuidV7Schema,
    release_id: uuidV7Schema,
    item_uid: uuidV7Schema,
    hints_used: z.int().min(0),
    served_hint_count: z.int().min(0),
    declared_external_hints: z.int().min(0),
  }),

  eventVariant('AssessmentProposed', {
    assessment_uid: uuidV7Schema,
    attempt_uid: uuidV7Schema,
    rubric_digest: sha256Schema,
    supersedes_assessment_uid: uuidV7Schema.nullable(),
  }),
  eventVariant('AssessmentAccepted', decisionPayload),
  eventVariant('AssessmentRejected', decisionPayload),
  eventVariant('AssessmentCorrected', {
    ...decisionPayload,
    supersedes_assessment_uid: uuidV7Schema,
  }),

  eventVariant('ConsentGranted', {
    grant_uid: uuidV7Schema,
    learner_uid: uuidV7Schema,
    enrollment_uid: uuidV7Schema.nullable(),
    provider: z.string().min(1).max(200),
    endpoint: z.string().min(1).max(500),
    model: z.string().max(200).nullable(),
    purposes: z.array(consentPurposeSchema).min(1).max(8),
    categories: z.array(consentCategorySchema).min(1).max(8),
    expires_at: utcInstantSchema,
  }),
  eventVariant('ConsentRevoked', {
    grant_uid: uuidV7Schema,
    reason: contentTextSchema,
  }),
  eventVariant('DisclosureRecorded', {
    disclosure_uid: uuidV7Schema,
    grant_uid: uuidV7Schema,
    destination: z.string().min(1).max(500),
    categories: z.array(consentCategorySchema).min(1).max(8),
    reference_hashes: z.array(sha256Schema).min(1).max(64),
  }),
]).meta({
  'x-runtime-validation':
    'Zod valida la forma del payload por tipo (§6.2). Core asigna event_seq, aggregate_revision, actor y recorded_at bajo bloqueo, verifica que aggregate_uid concuerde con el payload y registra hecho y evento en la misma transacción. El ordinal de HintServed es consecutivo por ítem, fijado bajo bloqueo, nunca elegido por el modelo.',
});

export type LearningEvent = z.output<typeof learningEventSchema>;
export type LearningEventType = LearningEvent['type'];

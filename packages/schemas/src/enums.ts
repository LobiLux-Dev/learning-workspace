/**
 * Enums y literales de la especificación v0.1.
 *
 * Cada valor enum está nombrado en la spec; donde la spec solo da un ejemplo (y no un conjunto)
 * se documenta el conjunto elegido para no ocultar la decisión.
 */
import { z } from 'zod';

/* -- Estados de release e instalación (§3.2, §5.4) ------------------ */
export const releaseStateSchema = z.enum(['pending', 'ready', 'failed', 'quarantined']);
export type ReleaseState = z.output<typeof releaseStateSchema>;

export const verificationStatusSchema = z.enum(['verified', 'unverified', 'diverged']);
export type VerificationStatus = z.output<typeof verificationStatusSchema>;

export const digestAlgorithmSchema = z.enum(['snapshot-sha256-v1']);
export type DigestAlgorithm = z.output<typeof digestAlgorithmSchema>;

export const sourceTypeSchema = z.enum(['local', 'git']);
export type SourceType = z.output<typeof sourceTypeSchema>;

/* -- Perfil (§5.1) --------------------------------------------------- */
/** La spec solo ejemplifica `adaptive`; `concise`/`detailed` cubren el resto del espectro declarado. */
export const explanationDetailSchema = z.enum(['adaptive', 'concise', 'detailed']);
export type ExplanationDetail = z.output<typeof explanationDetailSchema>;

/* -- Inscripciones, assignments y sesiones (§5.4) -------------------- */
export const enrollmentStatusSchema = z.enum(['active', 'paused', 'archived']);
export type EnrollmentStatus = z.output<typeof enrollmentStatusSchema>;

export const assignmentStatusSchema = z.enum([
  'preparing',
  'assigned',
  'opened',
  'read_declared',
  'practicing',
  'completed',
  'failed',
  'cancelled',
]);
export type AssignmentStatus = z.output<typeof assignmentStatusSchema>;

export const assignmentObservationSchema = z.enum(['opened', 'read_declared', 'practicing']);
export type AssignmentObservation = z.output<typeof assignmentObservationSchema>;

export const sessionKindSchema = z.enum(['study', 'diagnostic']);
export type SessionKind = z.output<typeof sessionKindSchema>;

export const sessionStatusSchema = z.enum(['active', 'paused', 'finished']);
export type SessionStatus = z.output<typeof sessionStatusSchema>;

/* -- Artifacts y assets (§4.2, §5.2) -------------------------------- */
export const artifactKindSchema = z.enum(['material', 'exercise', 'supplement', 'asset', 'export']);
export type ArtifactKind = z.output<typeof artifactKindSchema>;

export const artifactModeSchema = z.enum(['exact-copy', 'translation']);
export type ArtifactMode = z.output<typeof artifactModeSchema>;

export const artifactOriginSchema = z.enum(['copied-from-notebook', 'translated', 'ai-generated', 'user-provided', 'external']);
export type ArtifactOrigin = z.output<typeof artifactOriginSchema>;

export const artifactReviewStatusSchema = z.enum(['not-required', 'unreviewed', 'reviewed']);
export type ArtifactReviewStatus = z.output<typeof artifactReviewStatusSchema>;

export const artifactStateSchema = z.enum(['pending', 'ready', 'failed']);
export type ArtifactState = z.output<typeof artifactStateSchema>;

/** Origen de un asset dentro del paquete (§4.2 ejemplifica `author-provided`). */
export const assetOriginSchema = z.enum(['author-provided', 'user-provided', 'external']);
export type AssetOrigin = z.output<typeof assetOriginSchema>;

/* -- Procedencia de contenido generado (§5.2, §7.1) ------------------ */
export const provenanceOriginSchema = z.enum(['author-provided', 'user-provided', 'ai-generated']);
export type ProvenanceOrigin = z.output<typeof provenanceOriginSchema>;

/* -- Ítems, evaluaciones y mastery (§7) ------------------------------- */
export const assessmentDecisionValueSchema = z.enum(['accepted', 'rejected']);
export type AssessmentDecisionValue = z.output<typeof assessmentDecisionValueSchema>;

/** Etiquetas de `mastery-rules-v1` (§7.3): dato derivado, no motor de scoring. */
export const masteryLabelSchema = z.enum([
  'unobserved',
  'insufficient-evidence',
  'needs-practice',
  'developing',
  'demonstrated',
]);
export type MasteryLabel = z.output<typeof masteryLabelSchema>;

export const MASTERY_ALGORITHM_VERSION = 'mastery-rules-v1';
export const masteryAlgorithmVersionSchema = z.literal(MASTERY_ALGORITHM_VERSION);

/* -- Consentimiento y divulgación (§11) ------------------------------ */
export const consentPurposeSchema = z.enum(['tutor', 'translate', 'generate-item', 'evaluate']);
export type ConsentPurpose = z.output<typeof consentPurposeSchema>;

export const consentCategorySchema = z.enum([
  'public-resource',
  'learner-answer',
  'academic-state',
  'personal-note',
  'asset',
]);
export type ConsentCategory = z.output<typeof consentCategorySchema>;

/* -- Operaciones (§6.3) ---------------------------------------------- */
export const operationStatusSchema = z.enum(['pending', 'completed', 'failed']);
export type OperationStatus = z.output<typeof operationStatusSchema>;

/* -- Tipos de evento (§6.2) ------------------------------------------ */
export const EVENT_TYPES = [
  'ProfileCreated',
  'ProfileChanged',
  'NotebookInstallStarted',
  'NotebookInstallRetried',
  'NotebookInstallFailed',
  'NotebookInstalled',
  'NotebookQuarantined',
  'EnrollmentCreated',
  'EnrollmentStatusChanged',
  'AssignmentCreated',
  'AssignmentStatusChanged',
  'MaterialPrepared',
  'ArtifactRegistered',
  'ArtifactFailed',
  'ArtifactAdopted',
  'ReadingDeclared',
  'ResourceOpened',
  'SessionStarted',
  'SessionPaused',
  'SessionResumed',
  'SessionFinished',
  'ItemPrepared',
  'HintServed',
  'AttemptSubmitted',
  'AssessmentProposed',
  'AssessmentAccepted',
  'AssessmentRejected',
  'AssessmentCorrected',
  'ConsentGranted',
  'ConsentRevoked',
  'DisclosureRecorded',
] as const;

export const eventTypeSchema = z.enum(EVENT_TYPES);
export type EventType = z.output<typeof eventTypeSchema>;

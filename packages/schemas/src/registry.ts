/**
 * Registro único de contratos.
 *
 * `schemaRegistry` mapea nombres PascalCase a sus esquemas Zod y es la fuente de verdad que
 * consume el generador de JSON Schema. `llmCommandInputs` y `adminCommandInputs` separan los
 * inputs que un agente puede manejar de los que solo existen para el usuario/CLI (§8.2): el
 * catálogo de herramientas nunca debe incluir los administrativos.
 */
import type { ZodType } from 'zod';
import {
  attemptItemSnapshotSchema,
  attemptSchema,
  answerSnapshotSchema,
  assessmentDecisionSchema,
  assessmentSchema,
  criteriaJustificationSchema,
  evaluatorSchema,
  catalogItemDefinitionSchema,
  catalogSourceRefSchema,
  itemCatalogSchema,
  itemDefinitionSchema,
  itemSchema,
  provenanceSchema,
  solutionDeclarationSchema,
  solutionToleranceSchema,
} from './academic.js';
import {
  adoptionInputSchema,
  assignmentObservationInputSchema,
  artifactSchema,
  assignmentSchema,
  enrollmentSchema,
  profilePreferencesSchema,
  profileSchema,
  sessionSchema,
  sessionStatusInputSchema,
  startSessionInputSchema,
} from './portfolio.js';
import {
  assessmentDecisionInputSchema,
  assessmentInputSchema,
  completeAssignmentInputSchema,
  consentGrantInputSchema,
  consentRevokeInputSchema,
  createEnrollmentInputSchema,
  enrollmentStatusInputSchema,
  installNotebookInputSchema,
  installSourceSchema,
  markdownHrefSchema,
  prepareAssignmentInputSchema,
  prepareItemInputSchema,
  profileSetInputSchema,
  quarantineNotebookInputSchema,
  rebuildInputSchema,
  recoveryInputSchema,
  serveHintInputSchema,
  submitAttemptInputSchema,
  translationProposalSchema,
  enrollmentRefInputSchema,
  releaseRefInputSchema,
  adoptArtifactMutationSchema,
  assignmentObservationMutationSchema,
  completeAssignmentMutationSchema,
  consentGrantMutationSchema,
  consentRevokeMutationSchema,
  createEnrollmentMutationSchema,
  decideAssessmentMutationSchema,
  enrollmentStatusMutationSchema,
  installNotebookMutationSchema,
  prepareAssignmentMutationSchema,
  prepareItemMutationSchema,
  profileSetMutationSchema,
  proposeAssessmentMutationSchema,
  quarantineNotebookMutationSchema,
  rebuildProjectionsMutationSchema,
  recoverSessionMutationSchema,
  serveHintMutationSchema,
  sessionStatusMutationSchema,
  startSessionMutationSchema,
  submitAttemptMutationSchema,
} from './commands.js';
import { learningEventSchema } from './events.js';
import {
  assessmentDecisionValueSchema,
  assetOriginSchema,
  assignmentObservationSchema,
  assignmentStatusSchema,
  artifactKindSchema,
  artifactModeSchema,
  artifactOriginSchema,
  artifactReviewStatusSchema,
  artifactStateSchema,
  consentCategorySchema,
  consentPurposeSchema,
  digestAlgorithmSchema,
  enrollmentStatusSchema,
  eventTypeSchema,
  explanationDetailSchema,
  masteryAlgorithmVersionSchema,
  masteryLabelSchema,
  operationStatusSchema,
  provenanceOriginSchema,
  releaseStateSchema,
  sessionKindSchema,
  sessionStatusSchema,
  sourceTypeSchema,
  verificationStatusSchema,
} from './enums.js';
import {
  contractIssueCodeSchema,
  contractIssueSchema,
  operationResultSchema,
  specErrorCodeSchema,
  structuredErrorSchema,
  yamlIssueCodeSchema,
  yamlIssueSchema,
} from './errors.js';
import {
  assetsManifestSchema,
  assetEntrySchema,
  assetMediaTypeSchema,
  curriculumSchema,
  moduleEntrySchema,
  notebookManifestSchema,
  resourceCatalogSchema,
  resourceEntrySchema,
  resourceMediaTypeSchema,
  skillEntrySchema,
} from './notebook.js';
import { rubricAnchorSchema, rubricCriterionSchema, rubricSchema } from './rubric.js';
import { sourceRefSchema } from './primitives.js';
import {
  diagnosticSessionSchema,
  doctorFindingSchema,
  doctorReportSchema,
  enrollmentViewSchema,
  hintSchema,
  installedNotebookSchema,
  masteryStateSchema,
  masteryViewSchema,
  rebuildReportSchema,
  recoveryReportSchema,
  servedItemSchema,
  verificationFindingSchema,
  verificationReportSchema,
} from './views.js';

/** Entradas del facade que un agente de dominio puede invocar (§9.2). */
export const llmCommandInputs: Readonly<Record<string, ZodType>> = {
  CreateEnrollmentInput: createEnrollmentInputSchema,
  EnrollmentStatusInput: enrollmentStatusInputSchema,
  StartSessionInput: startSessionInputSchema,
  SessionStatusInput: sessionStatusInputSchema,
  PrepareAssignmentInput: prepareAssignmentInputSchema,
  AssignmentObservationInput: assignmentObservationInputSchema,
  PrepareItemInput: prepareItemInputSchema,
  ServeHintInput: serveHintInputSchema,
  SubmitAttemptInput: submitAttemptInputSchema,
  AssessmentInput: assessmentInputSchema,
  AssessmentDecisionInput: assessmentDecisionInputSchema,
  CompleteAssignmentInput: completeAssignmentInputSchema,
  RebuildInput: rebuildInputSchema,
  RecoveryInput: recoveryInputSchema,
  EnrollmentRefInput: enrollmentRefInputSchema,
  ReleaseRefInput: releaseRefInputSchema,
};

/**
 * Inputs administrativos locales: instalación, cuarentena, perfil, consentimiento y adopción.
 * Solo se exponen por facades de usuario/CLI con aprobación; nunca en el catálogo de
 * herramientas de un agente (§8.2, §8.3).
 */
export const adminCommandInputs: Readonly<Record<string, ZodType>> = {
  InstallNotebookInput: installNotebookInputSchema,
  InstallSource: installSourceSchema,
  QuarantineNotebookInput: quarantineNotebookInputSchema,
  ProfileSetInput: profileSetInputSchema,
  ConsentGrantInput: consentGrantInputSchema,
  ConsentRevokeInput: consentRevokeInputSchema,
  AdoptionInput: adoptionInputSchema,
};

/** Envelope `Mutation<T>` por comando (§9.2). */
export const mutationSchemas: Readonly<Record<string, ZodType>> = {
  CreateEnrollmentMutation: createEnrollmentMutationSchema,
  EnrollmentStatusMutation: enrollmentStatusMutationSchema,
  StartSessionMutation: startSessionMutationSchema,
  SessionStatusMutation: sessionStatusMutationSchema,
  PrepareAssignmentMutation: prepareAssignmentMutationSchema,
  AssignmentObservationMutation: assignmentObservationMutationSchema,
  PrepareItemMutation: prepareItemMutationSchema,
  ServeHintMutation: serveHintMutationSchema,
  SubmitAttemptMutation: submitAttemptMutationSchema,
  ProposeAssessmentMutation: proposeAssessmentMutationSchema,
  DecideAssessmentMutation: decideAssessmentMutationSchema,
  CompleteAssignmentMutation: completeAssignmentMutationSchema,
  RebuildProjectionsMutation: rebuildProjectionsMutationSchema,
  RecoverSessionMutation: recoverSessionMutationSchema,
  InstallNotebookMutation: installNotebookMutationSchema,
  QuarantineNotebookMutation: quarantineNotebookMutationSchema,
  ProfileSetMutation: profileSetMutationSchema,
  ConsentGrantMutation: consentGrantMutationSchema,
  ConsentRevokeMutation: consentRevokeMutationSchema,
  AdoptArtifactMutation: adoptArtifactMutationSchema,
};

/** Catálogo completo de contratos, orden alfabético para generación determinista. */
export const schemaRegistry: Readonly<Record<string, ZodType>> = {
  // Notebook y catálogos (§4)
  NotebookManifest: notebookManifestSchema,
  ResourceCatalog: resourceCatalogSchema,
  ResourceEntry: resourceEntrySchema,
  AssetsManifest: assetsManifestSchema,
  AssetEntry: assetEntrySchema,
  Curriculum: curriculumSchema,
  ModuleEntry: moduleEntrySchema,
  SkillEntry: skillEntrySchema,

  // Rúbricas (§7.1)
  Rubric: rubricSchema,
  RubricCriterion: rubricCriterionSchema,
  RubricAnchor: rubricAnchorSchema,

  // Portfolio (§5)
  Profile: profileSchema,
  ProfilePreferences: profilePreferencesSchema,
  Enrollment: enrollmentSchema,
  Session: sessionSchema,
  Assignment: assignmentSchema,
  Artifact: artifactSchema,

  // Académico (§7)
  ItemDefinition: itemDefinitionSchema,
  CatalogItemDefinition: catalogItemDefinitionSchema,
  CatalogSourceRef: catalogSourceRefSchema,
  ItemCatalog: itemCatalogSchema,
  Item: itemSchema,
  SolutionDeclaration: solutionDeclarationSchema,
  SolutionTolerance: solutionToleranceSchema,
  Attempt: attemptSchema,
  AttemptItemSnapshot: attemptItemSnapshotSchema,
  AnswerSnapshot: answerSnapshotSchema,
  Assessment: assessmentSchema,
  AssessmentDecision: assessmentDecisionSchema,
  Provenance: provenanceSchema,
  Evaluator: evaluatorSchema,
  CriteriaJustification: criteriaJustificationSchema,

  // Vistas de solo lectura (§9.2, §10.3)
  InstalledNotebook: installedNotebookSchema,
  VerificationReport: verificationReportSchema,
  VerificationFinding: verificationFindingSchema,
  EnrollmentView: enrollmentViewSchema,
  DiagnosticSession: diagnosticSessionSchema,
  ServedItem: servedItemSchema,
  Hint: hintSchema,
  MasteryState: masteryStateSchema,
  MasteryView: masteryViewSchema,
  RebuildReport: rebuildReportSchema,
  RecoveryReport: recoveryReportSchema,
  DoctorReport: doctorReportSchema,
  DoctorFinding: doctorFindingSchema,

  // Eventos (§6.2)
  LearningEvent: learningEventSchema,
  EventType: eventTypeSchema,

  // DTOs y errores (§9.2)
  OperationResult: operationResultSchema,
  StructuredError: structuredErrorSchema,
  SpecErrorCode: specErrorCodeSchema,
  SourceRef: sourceRefSchema,
  ContractIssue: contractIssueSchema,
  ContractIssueCode: contractIssueCodeSchema,
  YamlIssue: yamlIssueSchema,
  YamlIssueCode: yamlIssueCodeSchema,

  // Enums de dominio
  ReleaseState: releaseStateSchema,
  VerificationStatus: verificationStatusSchema,
  DigestAlgorithm: digestAlgorithmSchema,
  SourceType: sourceTypeSchema,
  ExplanationDetail: explanationDetailSchema,
  EnrollmentStatus: enrollmentStatusSchema,
  AssignmentStatus: assignmentStatusSchema,
  AssignmentObservation: assignmentObservationSchema,
  SessionKind: sessionKindSchema,
  SessionStatus: sessionStatusSchema,
  ArtifactKind: artifactKindSchema,
  ArtifactMode: artifactModeSchema,
  ArtifactOrigin: artifactOriginSchema,
  ArtifactReviewStatus: artifactReviewStatusSchema,
  ArtifactState: artifactStateSchema,
  AssetOrigin: assetOriginSchema,
  ProvenanceOrigin: provenanceOriginSchema,
  AssessmentDecisionValue: assessmentDecisionValueSchema,
  MasteryLabel: masteryLabelSchema,
  MasteryAlgorithmVersion: masteryAlgorithmVersionSchema,
  ConsentPurpose: consentPurposeSchema,
  ConsentCategory: consentCategorySchema,
  OperationStatus: operationStatusSchema,
  ResourceMediaType: resourceMediaTypeSchema,
  AssetMediaType: assetMediaTypeSchema,

  // Inputs de comando y envelopes
  ...llmCommandInputs,
  ...adminCommandInputs,
  TranslationProposal: translationProposalSchema,
  MarkdownHref: markdownHrefSchema,
  ...mutationSchemas,
};

export const SCHEMA_REGISTRY_NAMES: readonly string[] = Object.keys(schemaRegistry).sort();

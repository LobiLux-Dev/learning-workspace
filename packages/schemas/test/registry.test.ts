/**
 * Integridad del registro de contratos: nombres, cobertura y generabilidad.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  adminCommandInputs,
  buildJsonSchemaDocuments,
  llmCommandInputs,
  mutationSchemas,
  SCHEMA_REGISTRY_NAMES,
  schemaRegistry,
} from '../dist/index.js';

const REQUIRED_NAMES = [
  'NotebookManifest',
  'ResourceCatalog',
  'AssetsManifest',
  'Curriculum',
  'Rubric',
  'Profile',
  'Enrollment',
  'Assignment',
  'Artifact',
  'Item',
  'Attempt',
  'Assessment',
  'AssessmentDecision',
  'LearningEvent',
  // CF01: referencias y definiciones de bancos publicados
  'CatalogSourceRef',
  'CatalogItemDefinition',
  'ItemDefinition',
  // Vistas de solo lectura §9.2
  'InstalledNotebook',
  'VerificationReport',
  'VerificationFinding',
  'EnrollmentView',
  'DiagnosticSession',
  'ServedItem',
  'Hint',
  'MasteryState',
  'MasteryView',
  'RebuildReport',
  'RecoveryReport',
  'DoctorReport',
  'DoctorFinding',
  'OperationResult',
  'StructuredError',
  'SpecErrorCode',
  'CreateEnrollmentInput',
  'SubmitAttemptInput',
  'AssessmentInput',
  'InstallNotebookInput',
  'CreateEnrollmentMutation',
  'SubmitAttemptMutation',
  'InstallNotebookMutation',
  'EventType',
  'EnrollmentStatus',
  'AssignmentStatus',
  'ArtifactKind',
  'ConsentPurpose',
  'MasteryLabel',
];

test('nombres PascalCase y cobertura mínima', () => {
  assert.ok(SCHEMA_REGISTRY_NAMES.length >= 120, `registros: ${SCHEMA_REGISTRY_NAMES.length}`);
  for (const name of SCHEMA_REGISTRY_NAMES) {
    assert.match(name, /^[A-Z][A-Za-z0-9]*$/, `${name} debe ser PascalCase`);
  }
  for (const name of REQUIRED_NAMES) {
    assert.ok(name in schemaRegistry, `falta ${name} en schemaRegistry`);
  }
});

test('todo registro es un esquema Zod utilizable', () => {
  for (const [name, schema] of Object.entries(schemaRegistry)) {
    assert.equal(typeof schema.safeParse, 'function', `${name} debe ser un esquema Zod`);
  }
  // Los esquemas de objeto rechazan claves desconocidas (strict).
  const probe = schemaRegistry['Enrollment'];
  assert.ok(probe);
  assert.equal(probe.safeParse({ schema_version: '1.0' }).success, false);
});

test('todo registro genera JSON Schema sin excepciones', () => {
  const documents = buildJsonSchemaDocuments();
  assert.equal(Object.keys(documents).length, SCHEMA_REGISTRY_NAMES.length);
  for (const name of SCHEMA_REGISTRY_NAMES) {
    const document = documents[name];
    assert.ok(document, `${name} debe generar documento`);
    assert.ok(typeof document['$schema'] === 'string');
  }
});

test('los catálogos de audiencia son disjuntos y sus nombres están registrados', () => {
  const llm = Object.keys(llmCommandInputs);
  const admin = Object.keys(adminCommandInputs);
  assert.ok(llm.length >= 15, `inputs de agente: ${llm.length}`);
  assert.ok(admin.length >= 5, `inputs administrativos: ${admin.length}`);
  for (const name of llm) {
    assert.equal(name in adminCommandInputs, false, `${name} no puede estar en ambas audiencias`);
    assert.ok(name in schemaRegistry);
  }
  for (const name of admin) {
    assert.ok(name in schemaRegistry);
  }
  for (const [name, schema] of Object.entries(mutationSchemas)) {
    assert.ok(name in schemaRegistry, `${name} debe estar registrado`);
    assert.equal(typeof schema.safeParse, 'function');
  }
  assert.ok(Object.keys(mutationSchemas).length >= 18, 'un envelope por comando mutante de §9.2');
});

test('los comandos mutantes del facade tienen su envelope', () => {
  const expectedEnvelopes = [
    'CreateEnrollmentMutation',
    'EnrollmentStatusMutation',
    'StartSessionMutation',
    'SessionStatusMutation',
    'PrepareAssignmentMutation',
    'AssignmentObservationMutation',
    'PrepareItemMutation',
    'ServeHintMutation',
    'SubmitAttemptMutation',
    'ProposeAssessmentMutation',
    'DecideAssessmentMutation',
    'CompleteAssignmentMutation',
    'RebuildProjectionsMutation',
    'RecoverSessionMutation',
    'InstallNotebookMutation',
    'QuarantineNotebookMutation',
    'ProfileSetMutation',
    'ConsentGrantMutation',
    'ConsentRevokeMutation',
    'AdoptArtifactMutation',
  ];
  for (const name of expectedEnvelopes) {
    assert.ok(name in schemaRegistry, `falta envelope ${name}`);
  }
});

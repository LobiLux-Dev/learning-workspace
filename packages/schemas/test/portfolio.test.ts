/**
 * Contratos de Portfolio §5: perfil, inscripción, sesión, assignment y artifact.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  adoptionInputSchema,
  assignmentSchema,
  artifactSchema,
  enrollmentSchema,
  parseYaml,
  profileSchema,
  sessionSchema,
  type Artifact,
  type Assignment,
  type Enrollment,
} from '../dist/index.js';
import { accepts, failureMessage, readFixture } from './helpers.ts';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function fixtureEnrollment(): Enrollment {
  return parseYaml(readFixture('portfolio/enrollment.yaml'), enrollmentSchema);
}

function fixtureAssignment(): Assignment {
  return parseYaml(readFixture('portfolio/assignment.yaml'), assignmentSchema);
}

function fixtureArtifact(): Artifact {
  return parseYaml(readFixture('portfolio/artifact.yaml'), artifactSchema);
}

test('los fixtures de portfolio validan', () => {
  const profile = parseYaml(readFixture('portfolio/profile.yaml'), profileSchema);
  assert.equal(profile.preferences.explanation_detail, 'adaptive');
  assert.equal(profile.preferred_instruction_language, 'es-MX');

  const enrollment = fixtureEnrollment();
  assert.equal(enrollment.status, 'active');
  assert.equal(enrollment.previous_enrollment_uid, null);
  assert.equal(enrollment.revision, 1);

  const assignment = fixtureAssignment();
  assert.equal(assignment.status, 'assigned');
  assert.equal(assignment.objective_skill_ids.length, 3);

  const artifact = fixtureArtifact();
  assert.equal(artifact.mode, 'exact-copy');
  assert.equal(artifact.state, 'ready');
  assert.equal(artifact.inventory.length, 2);
});

test('inscripción: la inscripción anterior no puede ser ella misma', () => {
  const enrollment = fixtureEnrollment();
  const selfReference = clone(enrollment);
  selfReference.previous_enrollment_uid = enrollment.enrollment_uid;
  assert.equal(enrollmentSchema.safeParse(selfReference).success, false);
  assert.match(failureMessage(enrollmentSchema, selfReference), /previous_enrollment_uid/);

  const badRevision = clone(enrollment);
  badRevision.revision = 0;
  assert.equal(enrollmentSchema.safeParse(badRevision).success, false, 'revision >= 1');

  const unknownKey = clone(enrollment) as unknown as Record<string, unknown>;
  unknownKey['package_uid'] = enrollment.notebook.package_uid;
  assert.equal(enrollmentSchema.safeParse(unknownKey).success, false, 'package_uid no se duplica en enrollments');
});

test('assignment: supersedes sin autorreferencias y objetivos únicos', () => {
  const assignment = fixtureAssignment();

  const selfSupersede = clone(assignment);
  selfSupersede.supersedes_assignment_uid = assignment.assignment_uid;
  assert.equal(assignmentSchema.safeParse(selfSupersede).success, false);

  const duplicateObjectives = clone(assignment);
  duplicateObjectives.objective_skill_ids = ['apply-ohms-law', 'apply-ohms-law'];
  assert.equal(assignmentSchema.safeParse(duplicateObjectives).success, false, 'objetivos únicos');
  assert.match(failureMessage(assignmentSchema, duplicateObjectives), /duplicate objective/);

  const badStatus = clone(assignment) as unknown as Record<string, unknown>;
  badStatus['status'] = 'deferred';
  assert.equal(assignmentSchema.safeParse(badStatus).success, false, 'estados cerrados');

  const preparing = clone(assignment);
  preparing.status = 'preparing';
  preparing.material_uid = null;
  assert.equal(assignmentSchema.safeParse(preparing).success, true, 'preparing sin material todavía');
});

test('artifact: modo solo para material y procedencia coherente', () => {
  const artifact = fixtureArtifact();

  const exerciseWithMode = clone(artifact);
  exerciseWithMode.kind = 'exercise';
  assert.equal(artifactSchema.safeParse(exerciseWithMode).success, false, 'mode solo con kind=material');

  const generatedWithoutProvider = clone(artifact);
  generatedWithoutProvider.origin = 'ai-generated';
  assert.equal(artifactSchema.safeParse(generatedWithoutProvider).success, false);

  const copiedWithGeneration = clone(artifact);
  copiedWithGeneration.generation_request_uid = '019a3dd5-4a10-7a90-8eef-3174e0386931';
  assert.equal(artifactSchema.safeParse(copiedWithGeneration).success, false);

  const duplicateEntry = clone(artifact);
  duplicateEntry.inventory.push({ ...duplicateEntry.inventory[0]! });
  assert.equal(artifactSchema.safeParse(duplicateEntry).success, false, 'inventario sin paths repetidos');

  const badState = clone(artifact) as unknown as Record<string, unknown>;
  badState['state'] = 'published';
  assert.equal(artifactSchema.safeParse(badState).success, false, 'estados de artifact cerrados');

  const badReview = clone(artifact) as unknown as Record<string, unknown>;
  badReview['review_status'] = 'approved';
  assert.equal(artifactSchema.safeParse(badReview).success, false, 'review_status cerrado');
});

test('sesión: instantes UTC y estados cerrados', () => {
  const session = {
    schema_version: '1.0',
    session_uid: '019a3dd5-4a10-7a90-8eef-3174e0386931',
    enrollment_uid: '019a3dda-cc44-73c0-989a-2e14c65d13e1',
    kind: 'study',
    status: 'active',
    started_at: '2026-10-25T12:00:00.000Z',
    revision: 1,
  };
  assert.equal(sessionSchema.safeParse(session).success, true);

  const badInstant = clone(session);
  badInstant.started_at = 'ayer';
  assert.equal(sessionSchema.safeParse(badInstant).success, false, 'instante UTC exigido');

  const badKind = clone(session) as unknown as Record<string, unknown>;
  badKind['kind'] = 'quiz';
  assert.equal(sessionSchema.safeParse(badKind).success, false, 'kind cerrado');
});

test('adopción: input administrativo estricto', () => {
  assert.equal(
    accepts(adoptionInputSchema, { artifactUid: '019a3dd5-4a10-7a90-8eef-3174e0386931' }),
    true,
  );
  assert.equal(accepts(adoptionInputSchema, { artifactUid: 'no-uuid' }), false);
  assert.equal(
    accepts(adoptionInputSchema, {
      artifactUid: '019a3dd5-4a10-7a90-8eef-3174e0386931',
      actor: 'agent',
      root: '/tmp',
    }),
    false,
    'sin campos de contexto runtime',
  );
});

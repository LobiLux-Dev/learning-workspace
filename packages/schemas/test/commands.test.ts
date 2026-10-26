/**
 * Comandos §9.2: envelopes de idempotencia, inputs de agente y inputs administrativos.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import {
  adminCommandInputs,
  assessmentDecisionInputSchema,
  assessmentInputSchema,
  canonicalDigest,
  completeAssignmentInputSchema,
  createEnrollmentInputSchema,
  createEnrollmentMutationSchema,
  enrollmentStatusMutationSchema,
  installNotebookInputSchema,
  installNotebookMutationSchema,
  llmCommandInputs,
  mutationEnvelope,
  parseYaml,
  parseYamlDocument,
  prepareAssignmentInputSchema,
  prepareItemInputSchema,
  proposeAssessmentMutationSchema,
  rebuildInputSchema,
  schemaRegistry,
  serveHintInputSchema,
  submitAttemptInputSchema,
  toJsonSchema,
  type Mutation,
} from '../dist/index.js';
import { accepts, failureMessage, fixtureIds, readFixture } from './helpers.ts';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function findPropertyNames(schema: unknown, names = new Set<string>()): Set<string> {
  if (Array.isArray(schema)) {
    for (const item of schema) findPropertyNames(item, names);
    return names;
  }
  if (typeof schema !== 'object' || schema === null) return names;
  const record = schema as Record<string, unknown>;
  const properties = record['properties'];
  if (typeof properties === 'object' && properties !== null && properties !== undefined) {
    for (const key of Object.keys(properties)) names.add(key);
    findPropertyNames(properties, names);
  }
  for (const key of Object.keys(record)) {
    if (key !== 'properties') findPropertyNames(record[key], names);
  }
  return names;
}

test('los envelopes de fixture validan y exigen clave de idempotencia', () => {
  const create = parseYaml(readFixture('commands/create-enrollment.mutation.yaml'), createEnrollmentMutationSchema);
  assert.equal(typeof create.idempotencyKey, 'string');
  assert.equal(create.input.learnerUid, fixtureIds()['learnerUid']);

  const status = parseYaml(readFixture('commands/enrollment-status.mutation.yaml'), enrollmentStatusMutationSchema);
  assert.equal(status.input.targetStatus, 'paused');

  const install = parseYaml(readFixture('commands/install-notebook.mutation.yaml'), installNotebookMutationSchema);
  assert.equal(install.input.source.type, 'git');

  const missingKey = parseYamlDocument(readFixture('commands/create-enrollment.mutation.yaml')) as Record<string, unknown>;
  delete missingKey['idempotencyKey'];
  assert.equal(createEnrollmentMutationSchema.safeParse(missingKey).success, false, 'idempotencyKey obligatoria');

  const badKey = clone(missingKey);
  badKey['idempotencyKey'] = 'not-a-uuid';
  assert.equal(createEnrollmentMutationSchema.safeParse(badKey).success, false, 'clave UUIDv7');

  const withActor = parseYamlDocument(readFixture('commands/create-enrollment.mutation.yaml')) as Record<string, unknown>;
  withActor['actor'] = 'agent';
  assert.equal(createEnrollmentMutationSchema.safeParse(withActor).success, false, 'actor no viaja en el envelope');

  const badRevision = parseYamlDocument(readFixture('commands/enrollment-status.mutation.yaml')) as Record<string, unknown>;
  const revisions = badRevision['expectedRevisions'] as Record<string, number>;
  const firstKey = Object.keys(revisions)[0];
  assert.ok(firstKey);
  revisions[firstKey] = 0;
  assert.equal(enrollmentStatusMutationSchema.safeParse(badRevision).success, false, 'revisiones >= 1');
  assert.match(failureMessage(enrollmentStatusMutationSchema, badRevision), /expectedRevisions|Revision|revision/i);
});

test('el envelope es estricto y valida revisiones por agregado', () => {
  const ids = fixtureIds();
  const valid: Mutation<{ learnerUid: string; releaseId: string }> = {
    idempotencyKey: '019a3dd5-4a10-7a90-8eef-3174e0386931',
    input: { learnerUid: ids['learnerUid'] as string, releaseId: ids['releaseUid'] as string },
  };
  assert.equal(createEnrollmentMutationSchema.safeParse(valid).success, true);

  const unknownKey = clone(valid as unknown as Record<string, unknown>);
  unknownKey['approvalToken'] = 'fabricada';
  assert.equal(createEnrollmentMutationSchema.safeParse(unknownKey).success, false, 'sin tokens de aprobación');

  const revisionNonUuid = clone(valid as unknown as Record<string, unknown>);
  revisionNonUuid['expectedRevisions'] = { enrollment: 1 };
  assert.equal(createEnrollmentMutationSchema.safeParse(revisionNonUuid).success, false, 'claves UUIDv7');

  const revisionFloat = clone(valid as unknown as Record<string, unknown>);
  revisionFloat['expectedRevisions'] = { [ids['enrollmentUid'] as string]: 1.5 };
  assert.equal(createEnrollmentMutationSchema.safeParse(revisionFloat).success, false, 'revisiones enteras');
});

test('inputs de agente: sin actor, rol, evaluación ni campos de runtime', () => {
  const ids = fixtureIds();
  const attemptInput = {
    sessionUid: ids['sessionUid'] as string,
    itemUid: ids['itemUid'] as string,
    answerSnapshot: { value: 'respuesta', sha256: canonicalDigest('respuesta') },
    declaredExternalHints: 0,
  };
  assert.equal(submitAttemptInputSchema.safeParse(attemptInput).success, true);

  for (const forbidden of ['actor', 'role', 'skills', 'evaluation', 'mastery', 'approvalToken', 'root']) {
    const tampered = clone(attemptInput as Record<string, unknown>);
    tampered[forbidden] = 'x';
    assert.equal(
      submitAttemptInputSchema.safeParse(tampered).success,
      false,
      `SubmitAttemptInput no admite ${forbidden}`,
    );
  }

  const assessmentInput = {
    attemptUid: ids['attemptUid'] as string,
    rubricDigest: 'b'.repeat(64),
    criteriaScores: { relation: 2 },
    criteriaJustifications: { relation: { text: 'ok', response_refs: ['answer'] } },
    feedback: 'correcto',
  };
  assert.equal(assessmentInputSchema.safeParse(assessmentInput).success, true);
  for (const forbidden of ['provider', 'model', 'actor', 'confidence']) {
    const tampered = clone(assessmentInput as Record<string, unknown>);
    tampered[forbidden] = 'x';
    assert.equal(assessmentInputSchema.safeParse(tampered).success, false, `AssessmentInput no admite ${forbidden}`);
  }

  const hintInput = {
    sessionUid: ids['sessionUid'] as string,
    itemUid: ids['itemUid'] as string,
    hint: { text: 'pista', provenance: { origin: 'ai-generated', provider_ref: 'local:mock' } },
  };
  assert.equal(serveHintInputSchema.safeParse(hintInput).success, true);
  const withOrdinal = clone(hintInput as Record<string, unknown>);
  withOrdinal['ordinal'] = 3;
  assert.equal(serveHintInputSchema.safeParse(withOrdinal).success, false, 'el ordinal lo asigna Core (§6.2)');
});

test('instalación: solo usuario, solo https y commit completo', () => {
  assert.equal(accepts(installNotebookInputSchema, { source: { type: 'local', path: '/tmp/pkg' } }), true);
  assert.equal(
    accepts(installNotebookInputSchema, {
      source: { type: 'git', url: 'https://example.org/a.git', commit: '0123456789abcdef0123456789abcdef01234567' },
    }),
    true,
  );
  assert.equal(accepts(installNotebookInputSchema, { source: { type: 'ssh', path: '/x' } }), false);
  assert.equal(
    accepts(installNotebookInputSchema, {
      source: { type: 'git', url: 'http://example.org/a.git', commit: '0123456789abcdef0123456789abcdef01234567' },
    }),
    false,
    'https es el único transporte remoto',
  );
  assert.equal(
    accepts(installNotebookInputSchema, { source: { type: 'git', url: 'https://example.org/a.git', commit: 'abc' } }),
    false,
    'commit completo',
  );
  assert.equal(
    accepts(installNotebookInputSchema, { source: { type: 'local', path: '/tmp/pkg' }, actor: 'agent' }),
    false,
  );
});

test('prepareAssignment: coherencia entre modo, propuesta e idioma', () => {
  const ids = fixtureIds();
  const exact = {
    enrollmentUid: ids['enrollmentUid'] as string,
    resourceId: 'ohms-law',
    objectiveSkillIds: ['apply-ohms-law'],
    mode: 'exact-copy',
  };
  assert.equal(prepareAssignmentInputSchema.safeParse(exact).success, true);

  assert.equal(
    prepareAssignmentInputSchema.safeParse({ ...exact, objectiveSkillIds: [] }).success,
    true,
    'lista de objetivos vacía es válida sin currículo',
  );

  const proposal = {
    markdown: '# Ley de Ohm\n',
    links: [{ source: 'resources/ohms-law.md', target: 'resources/ohms-law-es.md' }],
    provenance: { origin: 'ai-generated', provider_ref: 'local:mock', model_ref: 'mock-1' },
  };
  const translation = {
    ...exact,
    mode: 'translation',
    targetLanguage: 'es-MX',
    translationProposal: proposal,
  };
  assert.equal(prepareAssignmentInputSchema.safeParse(translation).success, true);

  assert.equal(
    prepareAssignmentInputSchema.safeParse({ ...exact, mode: 'translation' }).success,
    false,
    'traducción exige propuesta',
  );
  assert.equal(prepareAssignmentInputSchema.safeParse({ ...exact, translationProposal: proposal }).success, false);
  assert.equal(
    prepareAssignmentInputSchema.safeParse({ ...exact, targetLanguage: 'es-MX' }).success,
    false,
    'exact-copy no cambia idioma',
  );

  // `../` como referencia Markdown se permite (§5.3) y se resuelve/contiene en Core/F3;
  // aquí solo se rechazan lo que nunca puede ser un enlace relativo seguro.
  const linkCases: string[] = [
    'javascript:alert(1)',
    'data:text/html,<script>',
    'file:///etc/passwd',
    '/etc/passwd',
    'index.md?query=1',
  ];
  for (const target of linkCases) {
    const candidate = {
      ...translation,
      translationProposal: { ...proposal, links: [{ source: 'resources/ohms-law.md', target }] },
    };
    assert.equal(prepareAssignmentInputSchema.safeParse(candidate).success, false, `debe rechazar enlace ${target}`);
  }
});

test('prepareItem: banco o propuesta aprobada, sin campos de runtime', () => {
  const ids = fixtureIds();
  const catalogSource = {
    source: 'catalog',
    enrollmentUid: ids['enrollmentUid'] as string,
    definitionId: 'ohm-diagnostic-1',
  };
  assert.equal(prepareItemInputSchema.safeParse(catalogSource).success, true);
  assert.equal(prepareItemInputSchema.safeParse({ ...catalogSource, actor: 'agent' }).success, false);
  assert.equal(prepareItemInputSchema.safeParse({ source: 'other', enrollmentUid: ids['enrollmentUid'] }).success, false);
  assert.equal(prepareItemInputSchema.safeParse({ source: 'proposed', enrollmentUid: ids['enrollmentUid'] }).success, false);
});

test('rebuild y completion exigen los datos mínimos de la spec', () => {
  const ids = fixtureIds();
  assert.equal(
    accepts(rebuildInputSchema, { enrollmentUid: ids['enrollmentUid'], algorithmVersion: 'mastery-rules-v1' }),
    true,
  );
  assert.equal(
    accepts(rebuildInputSchema, { enrollmentUid: ids['enrollmentUid'], algorithmVersion: 'mastery-rules-v2' }),
    false,
    'la versión de algoritmo está fijada en v0.1',
  );
  assert.equal(accepts(completeAssignmentInputSchema, { assignmentUid: ids['assignmentUid'] }), true);
  assert.equal(accepts(completeAssignmentInputSchema, { assignmentUid: ids['assignmentUid'], actor: 'tutor' }), false);
  assert.equal(
    accepts(assessmentDecisionInputSchema, {
      assessmentUid: ids['assessmentUid'],
      decision: 'accepted',
      reason: 'revisado',
    }),
    true,
  );
  assert.equal(
    accepts(assessmentDecisionInputSchema, { assessmentUid: ids['assessmentUid'], decision: 'deferred', reason: 'x' }),
    false,
    'decisión terminal: accepted|rejected',
  );
  assert.equal(
    accepts(createEnrollmentInputSchema, {
      learnerUid: ids['learnerUid'],
      releaseId: ids['releaseUid'],
      previousEnrollmentUid: null,
    }),
    false,
    'previousEnrollmentUid es opcional, no anulable',
  );
});

test('audiencias: los inputs administrativos jamás entran al catálogo de agente', () => {
  for (const name of Object.keys(llmCommandInputs)) {
    assert.ok(name in schemaRegistry, `${name} debe estar en schemaRegistry`);
    const document = toJsonSchema(llmCommandInputs[name] as never, name);
    assert.equal(document['x-input-audience'], 'llm-domain', `${name} debe marcarse llm-domain`);
    const propertyNames = findPropertyNames(document);
    for (const forbidden of ['actor', 'role', 'root', 'workspaceRoot', 'approvalToken', 'sql', 'shell']) {
      assert.equal(propertyNames.has(forbidden), false, `${name} no debe exponer ${forbidden}`);
    }
  }
  for (const name of Object.keys(adminCommandInputs)) {
    assert.ok(name in schemaRegistry, `${name} debe estar en schemaRegistry`);
    const document = toJsonSchema(adminCommandInputs[name] as never, name);
    assert.equal(document['x-input-audience'], 'administrative-local', `${name} debe marcarse administrativo`);
    assert.equal(name in llmCommandInputs, false, `${name} no puede ser además input de agente`);
  }
  const envelope = toJsonSchema(installNotebookMutationSchema, 'InstallNotebookMutation');
  assert.equal(
    envelope['x-input-audience'],
    'administrative-local',
    'el envelope hereda la audiencia administrativa',
  );
  // Los inputs de comando usan camelCase (estilo §9.2); los documentos de dominio usan snake_case.
  for (const [name, schema] of [...Object.entries(llmCommandInputs), ...Object.entries(adminCommandInputs)]) {
    const document = toJsonSchema(schema as never, name);
    const properties = document['properties'];
    if (typeof properties !== 'object' || properties === null) continue;
    for (const key of Object.keys(properties)) {
      assert.match(key, /^[a-z][A-Za-z0-9]*$/, `${name}: los campos de input son camelCase (recibido ${key})`);
    }
  }
});

test('el input del envelope se limita a 2 MiB agregados de bytes JSON (§9.2)', () => {
  const ids = fixtureIds();
  const input = {
    attemptUid: ids['attemptUid'] as string,
    rubricDigest: 'b'.repeat(64),
    criteriaScores: { relation: 2 },
    criteriaJustifications: { relation: { text: 'b'.repeat(1024 * 1024), response_refs: ['answer'] } },
    feedback: 'a'.repeat(1024 * 1024),
  };
  // Cada campo por sí mismo respeta su límite individual de 2 MiB...
  assert.equal(assessmentInputSchema.safeParse(input).success, true, 'los campos caben por separado');
  // ... pero el conjunto supera los 2 MiB agregados que limita el envelope.
  const envelope = { idempotencyKey: '019a3dd5-4a10-7a90-8eef-3174e0386931', input };
  const result = proposeAssessmentMutationSchema.safeParse(envelope);
  assert.equal(result.success, false, 'límite agregado aplicado por el envelope');
  if (!result.success) {
    assert.ok(
      result.error.issues.some((issue) => issue.path.join('.') === 'input'),
      JSON.stringify(result.error.issues.slice(0, 2)),
    );
    assert.match(result.error.issues.map((issue) => issue.message).join(' '), /2097152|UTF-8 bytes/);
  }
});

test('un input que no es JSON estricto se convierte en issue, nunca en excepción', () => {
  const loose = mutationEnvelope(z.any());
  const key = '019a3dd5-4a10-7a90-8eef-3174e0386931';

  const date = loose.safeParse({ idempotencyKey: key, input: new Date('2026-10-25T00:00:00.000Z') });
  assert.equal(date.success, false, 'Date no es JSON');
  if (!date.success) assert.match(JSON.stringify(date.error.issues), /strict JSON/);

  const cyclic: Record<string, unknown> = {};
  cyclic['self'] = cyclic;
  assert.equal(loose.safeParse({ idempotencyKey: key, input: cyclic }).success, false, 'ciclo sin lanzar');

  const big = loose.safeParse({ idempotencyKey: key, input: { text: 'x'.repeat(2 * 1024 * 1024 + 1) } });
  assert.equal(big.success, false, '2 MiB de bytes');

  assert.equal(loose.safeParse({ idempotencyKey: key, input: { small: 'ok' } }).success, true, 'JSON pequeño aceptado');
});

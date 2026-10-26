/**
 * Contratos académicos §7: ítems, soluciones agnósticas, intentos, evaluaciones y eventos §6.2.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  answerSnapshotSchema,
  assessmentDecisionSchema,
  assessmentSchema,
  attemptSchema,
  canonicalDigest,
  itemCatalogSchema,
  itemDefinitionSchema,
  itemSchema,
  learningEventSchema,
  parseYaml,
  rubricSchema,
  solutionDeclarationSchema,
  uncoveredSkills,
  type Attempt,
  type Assessment,
  type Item,
  type LearningEvent,
  type Rubric,
} from '../dist/index.js';
import { accepts, failureMessage, readFixture } from './helpers.ts';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function fixtureItem(): Item {
  return parseYaml(readFixture('academic/item.yaml'), itemSchema);
}

function fixtureAttempt(): Attempt {
  return parseYaml(readFixture('academic/attempt.yaml'), attemptSchema);
}

function fixtureAssessment(): Assessment {
  return parseYaml(readFixture('academic/assessment.yaml'), assessmentSchema);
}

test('los fixtures académicos validan', () => {
  const item = fixtureItem();
  assert.equal(item.skill_ids.length, 1);
  assert.equal(item.provenance.origin, 'author-provided');

  const attempt = fixtureAttempt();
  assert.equal(attempt.hints_used, 1);
  assert.equal(attempt.capture_source, 'cli');

  const assessment = fixtureAssessment();
  assert.equal(assessment.evaluator.kind, 'human');
  assert.equal(assessment.confidence_in_evaluation, 0.9);

  const decision = parseYaml(readFixture('academic/assessment-decision.yaml'), assessmentDecisionSchema);
  assert.equal(decision.decision, 'accepted');
  assert.equal(decision.actor, 'local-user');
});

test('la solución es JSON agnóstico a disciplina', () => {
  const base = { answer: '6 V', units: ['V'], tolerance: { value: 0.01, kind: 'relative' } };
  assert.equal(accepts(solutionDeclarationSchema, base), true);

  // Disciplinas sin números: la respuesta puede ser texto, booleano, lista u objeto.
  assert.equal(accepts(solutionDeclarationSchema, { answer: 'Sí, porque la segunda ley de Newton' }), true);
  assert.equal(accepts(solutionDeclarationSchema, { answer: 42 }), true);
  assert.equal(accepts(solutionDeclarationSchema, { answer: true }), true);
  assert.equal(accepts(solutionDeclarationSchema, { answer: [1, 2, 3] }), true);
  assert.equal(accepts(solutionDeclarationSchema, { answer: { lemma: 'todo número par' } }), true);
  assert.equal(accepts(solutionDeclarationSchema, { answer: null }), true);

  // Unidades y tolerancia siguen siendo opcionales: no se exigen números a otras disciplinas.
  assert.equal(accepts(solutionDeclarationSchema, { answer: 'respuesta' }), true);
  assert.equal(accepts(solutionDeclarationSchema, { answer: 'x', tolerance: { value: -1, kind: 'absolute' } }), false);
  assert.equal(accepts(solutionDeclarationSchema, { answer: 'x', units: [] }), true);

  // JSON estricto: sin undefined, NaN, fechas ni funciones.
  assert.equal(accepts(solutionDeclarationSchema, { answer: undefined }), false);
  assert.equal(accepts(solutionDeclarationSchema, { answer: Number.NaN }), false);
  assert.equal(accepts(solutionDeclarationSchema, { answer: new Date() }), false);
  assert.equal(accepts(solutionDeclarationSchema, {}), false, 'answer es obligatorio');
});

test('el intento fija hints_used = servidas + declaradas', () => {
  const attempt = fixtureAttempt();
  assert.equal(attempt.served_hint_count + attempt.declared_external_hints, attempt.hints_used);

  const mismatch = clone(attempt);
  mismatch.hints_used = 2;
  assert.equal(attemptSchema.safeParse(mismatch).success, false);
  assert.match(failureMessage(attemptSchema, mismatch), /hints_used/);

  const negative = clone(attempt);
  (negative as unknown as Record<string, unknown>)['declared_external_hints'] = -1;
  assert.equal(attemptSchema.safeParse(negative).success, false, 'enteros no negativos');
});

test('el hash de la respuesta es el digest canónico de su valor', () => {
  const attempt = fixtureAttempt();
  const expected = canonicalDigest(attempt.answer_snapshot.value);
  assert.equal(attempt.answer_snapshot.sha256, expected, 'el fixture usa el digest real del valor');

  const tampered = clone(attempt);
  tampered.answer_snapshot.sha256 = 'f'.repeat(64);
  assert.equal(attemptSchema.safeParse(tampered).success, false);
  assert.match(failureMessage(attemptSchema, tampered), /digest/);
});

test('el snapshot del intento no contiene la solución', () => {
  const attempt = fixtureAttempt();
  const snapshotText = JSON.stringify(attempt.item_snapshot);
  assert.equal(snapshotText.includes('expected_justification'), false, 'no se filtra la solución al snapshot');
  assert.equal(snapshotText.includes('"solution"'), false);
});

test('context_key y rúbrica del intento coinciden con el ítem', () => {
  const attempt = fixtureAttempt();
  const wrongContext = clone(attempt);
  wrongContext.context_key = 'otro-contexto';
  assert.equal(attemptSchema.safeParse(wrongContext).success, false);

  const uncovered = clone(attempt);
  const rubric = uncovered.rubric_snapshot as Rubric;
  rubric.criteria = [rubric.criteria[0]!];
  rubric.criteria[0]!.skill_weights = { 'understand-voltage': 1 };
  assert.equal(attemptSchema.safeParse(uncovered).success, false, 'toda skill del snapshot necesita criterio');
  assert.match(failureMessage(attemptSchema, uncovered), /no criterion/);

  const rubricFixture = parseYaml(readFixture('academic/rubric.yaml'), rubricSchema);
  assert.deepEqual(uncoveredSkills(rubricFixture, ['apply-ohms-law', 'ghost-skill']), ['ghost-skill']);
  assert.deepEqual(uncoveredSkills(rubricFixture, ['apply-ohms-law']), []);
});

test('el ítem exige skills no vacíos, refs y cobertura de rúbrica', () => {
  const item = fixtureItem();

  const emptySkills = clone(item);
  emptySkills.skill_ids = [];
  assert.equal(itemSchema.safeParse(emptySkills).success, false, 'habilidades no vacías');

  const duplicateSkills = clone(item);
  duplicateSkills.skill_ids = ['apply-ohms-law', 'apply-ohms-law'];
  assert.equal(itemSchema.safeParse(duplicateSkills).success, false);

  const uncoveredSkill = clone(item);
  uncoveredSkill.skill_ids = ['apply-ohms-law', 'understand-voltage'];
  assert.equal(itemSchema.safeParse(uncoveredSkill).success, false, 'toda skill debe tener criterio');
  assert.match(failureMessage(itemSchema, uncoveredSkill), /no criterion/);

  const weightForForeignSkill = clone(item);
  const criterion = weightForForeignSkill.rubric.criteria[0];
  assert.ok(criterion);
  criterion.skill_weights = { 'understand-voltage': 1 };
  assert.equal(itemSchema.safeParse(weightForForeignSkill).success, false, 'pesos solo del ítem');

  const duplicateRefs = clone(item);
  duplicateRefs.source_refs.push({ ...duplicateRefs.source_refs[0]! });
  assert.equal(itemSchema.safeParse(duplicateRefs).success, false, 'source_refs únicos');

  const generatedWithoutProvider = clone(item);
  generatedWithoutProvider.provenance = { origin: 'ai-generated' };
  assert.equal(itemSchema.safeParse(generatedWithoutProvider).success, false, 'ai-generated exige provider');

  const providedWithGeneration = clone(item);
  providedWithGeneration.provenance = {
    origin: 'author-provided',
    generation_request_uid: '019a3dd5-4a10-7a90-8eef-3174e0386931',
  };
  assert.equal(itemSchema.safeParse(providedWithGeneration).success, false);
});

test('catálogo de ítems: definition_id únicos y validación de cada ítem', () => {
  const catalog = parseYaml(readFixture('notebooks/electronics/items/diagnostic.yaml'), itemCatalogSchema);
  assert.equal(catalog.items.length, 1);

  const duplicate = clone(catalog);
  duplicate.items.push({ ...duplicate.items[0]! });
  assert.equal(itemCatalogSchema.safeParse(duplicate).success, false);

  const brokenItem = clone(catalog);
  brokenItem.items[0]!.skill_ids = [];
  assert.equal(itemCatalogSchema.safeParse(brokenItem).success, false, 'los ítems del catálogo validan individualmente');

  assert.equal(itemCatalogSchema.safeParse({ schema_version: '1.0', items: [], extensions: {} }).success, false);
});

test('evaluación: puntuaciones acotadas y coherentes con justificaciones', () => {
  const assessment = fixtureAssessment();

  const outOfRange = clone(assessment);
  outOfRange.criteria_scores['relation'] = 101;
  assert.equal(assessmentSchema.safeParse(outOfRange).success, false, 'puntuación <= 100');

  const negative = clone(assessment);
  negative.criteria_scores['relation'] = -1;
  assert.equal(assessmentSchema.safeParse(negative).success, false, 'puntuación >= 0');

  const missingJustification = clone(assessment);
  delete (missingJustification.criteria_justifications as Record<string, unknown>)['relation'];
  assert.equal(assessmentSchema.safeParse(missingJustification).success, false, 'todos y solo los criterios');

  const extraScore = clone(assessment);
  extraScore.criteria_scores['ghost'] = 1;
  assert.equal(assessmentSchema.safeParse(extraScore).success, false);

  const selfSupersede = clone(assessment);
  selfSupersede.supersedes_assessment_uid = assessment.assessment_uid;
  assert.equal(assessmentSchema.safeParse(selfSupersede).success, false, 'sin autorreferencias');

  const modelWithoutProvider = clone(assessment);
  modelWithoutProvider.evaluator = { kind: 'model' };
  assert.equal(assessmentSchema.safeParse(modelWithoutProvider).success, false, 'evaluador model documenta proveedor');

  const highConfidence = clone(assessment);
  highConfidence.confidence_in_evaluation = 1.5;
  assert.equal(assessmentSchema.safeParse(highConfidence).success, false, 'confianza en [0,1]');
});

test('eventos: payloads por tipo y sin tipos fuera de la spec', () => {
  type InstalledEvent = Extract<LearningEvent, { type: 'NotebookInstalled' }>;
  type HintEvent = Extract<LearningEvent, { type: 'HintServed' }>;
  type SubmittedEvent = Extract<LearningEvent, { type: 'AttemptSubmitted' }>;

  const installed = parseYaml(readFixture('events/notebook-installed.yaml'), learningEventSchema) as InstalledEvent;
  assert.equal(installed.type, 'NotebookInstalled');
  assert.equal(installed.payload.version, '1.0.0');
  assert.equal(installed.payload.package_id, 'github.com/academy-a/electronics-fundamentals');

  const hint = parseYaml(readFixture('events/hint-served.yaml'), learningEventSchema) as HintEvent;
  assert.equal(hint.type, 'HintServed');
  assert.equal(hint.payload.ordinal, 1);
  assert.equal(hint.payload.provenance.origin, 'ai-generated');

  const submitted = parseYaml(readFixture('events/attempt-submitted.yaml'), learningEventSchema) as SubmittedEvent;
  assert.equal(submitted.type, 'AttemptSubmitted');
  assert.equal(submitted.payload.hints_used, 1);

  // §6.2: no existe NotebookVersionActivated.
  const removed = clone(installed) as unknown as Record<string, unknown>;
  removed['type'] = 'NotebookVersionActivated';
  assert.equal(learningEventSchema.safeParse(removed).success, false, 'tipo de evento fuera de v0.1');

  const badOrdinal = clone(hint) as unknown as Record<string, unknown>;
  const payload = badOrdinal['payload'] as Record<string, unknown>;
  payload['ordinal'] = 0;
  assert.equal(learningEventSchema.safeParse(badOrdinal).success, false, 'ordinal positivo');

  const extraField = clone(hint) as unknown as Record<string, unknown>;
  extraField['note'] = 'x';
  assert.equal(learningEventSchema.safeParse(extraField).success, false, 'objeto estricto');

  const unknownPayloadKey = clone(hint) as unknown as Record<string, unknown>;
  const hintPayload = unknownPayloadKey['payload'] as Record<string, unknown>;
  hintPayload['hint_count'] = 2;
  assert.equal(learningEventSchema.safeParse(unknownPayloadKey).success, false, 'payload estricto');
});

test('los bancos publicados no conocen el release_id local (CF01)', () => {
  const catalog = parseYaml(readFixture('notebooks/electronics/items/diagnostic.yaml'), itemCatalogSchema);
  const ref = catalog.items[0]?.source_refs[0];
  assert.ok(ref);
  assert.equal('release_id' in ref, false, 'refs del banco: {resource_id, digest}');
  assert.equal(ref.resource_id, 'ohms-law');
  assert.match(ref.digest, /^[0-9a-f]{64}$/);

  // Un banco con un UUID de instalación local no es un banco publicado.
  const withLocalRelease = clone(catalog);
  const localRef = withLocalRelease.items[0]?.source_refs[0] as unknown as Record<string, unknown>;
  assert.ok(localRef);
  localRef['release_id'] = '019a3dd5-4a10-7a90-8eef-3174e0386931';
  assert.equal(itemCatalogSchema.safeParse(withLocalRelease).success, false, 'release_id local rechazado');

  // ... pero la definición ya vinculada a una inscripción sigue exigiendo refs completas.
  const base = catalog.items[0];
  assert.ok(base);
  const digest = base.source_refs[0]?.digest;
  assert.ok(digest);
  const fullRef = {
    release_id: '019a3dd5-4a10-7a90-8eef-3174e0386931',
    resource_id: 'ohms-law',
    digest,
  };
  const linked = { ...base, source_refs: [fullRef] };
  assert.equal(itemDefinitionSchema.safeParse(linked).success, true, 'refs completas en Portfolio');
  const unlinked = { ...base, source_refs: [{ resource_id: 'ohms-law', digest }] };
  assert.equal(itemDefinitionSchema.safeParse(unlinked).success, false, 'sin release_id no está vinculado');
});

test('soluciones y snapshots: JSON acotado, safeParse nunca lanza (CF05)', () => {
  assert.equal(accepts(solutionDeclarationSchema, { answer: '6 V' }), true);

  const cyclic: Record<string, unknown> = {};
  cyclic['self'] = cyclic;
  assert.equal(accepts(solutionDeclarationSchema, { answer: cyclic }), false, 'ciclo sin lanzar');
  let deep: unknown = 'leaf';
  for (let index = 0; index < 10_000; index += 1) deep = [deep];
  assert.equal(accepts(solutionDeclarationSchema, { answer: deep }), false, 'profundidad sin RangeError');
  assert.equal(accepts(solutionDeclarationSchema, { answer: new Date() }), false, 'Date no es JSON');
  assert.equal(accepts(solutionDeclarationSchema, { answer: 'lone-\uD800' }), false, 'surrogate sin pareja');

  // El digest se calcula dentro de un superRefine: si el valor no es JSON,
  // CanonicalJsonError se convierte en issue y safeParse devuelve fallo.
  const notJson = answerSnapshotSchema.safeParse({ value: new Date(), sha256: 'a'.repeat(64) });
  assert.equal(notJson.success, false, 'fallo, no excepción');
  if (!notJson.success) assert.match(JSON.stringify(notJson.error.issues), /JSON value|unpaired surrogate|not plain/);

  const lone = answerSnapshotSchema.safeParse({ value: 'lone-\uD800', sha256: 'a'.repeat(64) });
  assert.equal(lone.success, false, 'surrogate sin pareja en la respuesta');

  // El snapshot de una respuesta válida sigue exigiendo su digest real.
  const ok = answerSnapshotSchema.safeParse({ value: '6 V', sha256: canonicalDigest('6 V') });
  assert.equal(ok.success, true);
});

/**
 * Generación de JSON Schema y paridad con AJV (draft 2020-12).
 *
 * Aquí se fija el contrato honesto de F0: JSON Schema valida lo que puede expresar y queda
 * anotado con `x-runtime-validation` lo que solo Zod comprueba en runtime. Nada se finge.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  assetsManifestSchema,
  bcp47Schema,
  buildJsonSchemaDocuments,
  contentTextSchema,
  curriculumSchema,
  itemSchema,
  mediaTypeSchema,
  notebookManifestSchema,
  parseYaml,
  profileSchema,
  resourceIdSchema,
  resourceCatalogSchema,
  rubricCriterionSchema,
  rubricSchema,
  schemaRegistry,
  solutionDeclarationSchema,
  stableJsonStringify,
  toJsonSchema,
  utcInstantSchema,
  attemptSchema,
  type JsonSchemaDocument,
} from '../dist/index.js';
import type { ZodType } from 'zod';
import { generatedDir, readFixture } from './helpers.ts';

/** Uso mínimo de AJV con tipado estructural: evita acoplar el test a los tipos internos. */
type CompiledValidator = (data: unknown) => boolean | undefined;
type AjvInstance = {
  addKeyword: (keyword: { keyword: string; schemaType?: string }) => unknown;
  compile: (schema: object) => CompiledValidator;
};

const Ajv2020Constructor = Ajv2020 as unknown as new (options?: {
  strict?: boolean;
  allErrors?: boolean;
}) => AjvInstance;

type CompiledAjv = { validate: (name: string, document: JsonSchemaDocument, value: unknown) => boolean };

function createAjv(): CompiledAjv {
  const ajv = new Ajv2020Constructor({ strict: true, allErrors: true });
  ajv.addKeyword({ keyword: 'x-runtime-validation', schemaType: 'string' });
  ajv.addKeyword({ keyword: 'x-input-audience', schemaType: 'string' });
  const compiled = new Map<string, CompiledValidator>();
  return {
    validate(name, document, value) {
      const existing = compiled.get(name);
      if (existing !== undefined) return existing(value) as boolean;
      const validate = ajv.compile(document);
      compiled.set(name, validate);
      return validate(value) as boolean;
    },
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function registrySchema(name: string): ZodType {
  const schema = schemaRegistry[name];
  assert.ok(schema, `${name} debe existir en el registro`);
  return schema;
}

test('todos los contratos generan JSON Schema draft 2020-12 determinista', () => {
  const first = buildJsonSchemaDocuments();
  const second = buildJsonSchemaDocuments();
  assert.equal(Object.keys(first).length, Object.keys(schemaRegistry).length);
  assert.equal(stableJsonStringify(first), stableJsonStringify(second), 'misma entrada, mismos bytes');

  for (const [name, document] of Object.entries(first)) {
    assert.equal(document['$schema'], 'https://json-schema.org/draft/2020-12/schema', `${name}: draft correcto`);
    assert.equal(document['title'], name, `${name}: auto-título`);
  }
});

test('los documentos generados en disco coinciden con la generación actual', () => {
  const documents = buildJsonSchemaDocuments();
  for (const [name, document] of Object.entries(documents)) {
    const onDisk = readFileSync(path.join(generatedDir, `${name}.schema.json`), 'utf8');
    assert.equal(onDisk, stableJsonStringify(document, true), `${name}: el archivo generado está desactualizado`);
  }
});

test('paridad con AJV sobre los controles comunes', () => {
  const ajv = createAjv();

  const manifest = parseYaml(readFixture('notebooks/electronics/notebook.yaml'), notebookManifestSchema);
  const resources = parseYaml(readFixture('notebooks/electronics/resources/index.yaml'), resourceCatalogSchema);
  const assets = parseYaml(readFixture('notebooks/electronics/assets/manifest.yaml'), assetsManifestSchema);

  const agreement: Array<{ name: string; schema: ZodType; document: JsonSchemaDocument; value: unknown }> = [
    { name: 'manifest-valid', schema: notebookManifestSchema, document: toJsonSchema(notebookManifestSchema), value: manifest },
    {
      name: 'manifest-unknown-key',
      schema: notebookManifestSchema,
      document: toJsonSchema(notebookManifestSchema),
      value: { ...clone(manifest), surprise: 1 },
    },
    {
      name: 'manifest-incomplete',
      schema: notebookManifestSchema,
      document: toJsonSchema(notebookManifestSchema),
      value: { schema_version: '1.0' },
    },
    { name: 'resources-valid', schema: resourceCatalogSchema, document: toJsonSchema(resourceCatalogSchema), value: resources },
    { name: 'assets-valid', schema: assetsManifestSchema, document: toJsonSchema(assetsManifestSchema), value: assets },
    { name: 'media-valid', schema: mediaTypeSchema, document: toJsonSchema(mediaTypeSchema), value: 'text/markdown' },
    { name: 'media-invalid', schema: mediaTypeSchema, document: toJsonSchema(mediaTypeSchema), value: 'TEXT/MARKDOWN' },
    { name: 'id-invalid', schema: resourceIdSchema, document: toJsonSchema(resourceIdSchema), value: 'Ghost' },
    { name: 'id-valid', schema: resourceIdSchema, document: toJsonSchema(resourceIdSchema), value: 'ohms-law' },
    { name: 'uuid-version', schema: registrySchema('CreateEnrollmentMutation'), document: toJsonSchema(registrySchema('CreateEnrollmentMutation')), value: {
      idempotencyKey: '9f6c2e1a-1234-4abc-8def-0123456789ab',
      input: { learnerUid: '019a3dda-cc44-73c0-989a-2e14c65d13e1', releaseId: '019a3ddb-3c68-7c34-9677-048ac9a7d1f8' },
    } },
  ];

  for (const caseDef of agreement) {
    const zodResult = caseDef.schema.safeParse(caseDef.value).success;
    const ajvResult = ajv.validate(caseDef.name, caseDef.document, caseDef.value);
    assert.equal(
      ajvResult,
      zodResult,
      `${caseDef.name}: AJV y Zod deben coincidir (ajv=${ajvResult}, zod=${zodResult})`,
    );
  }

  // Un envelope válido pasa en ambos; con actor extra o clave no UUID fallan en ambos.
  const envelope = {
    idempotencyKey: '019a3dd5-4a10-7a90-8eef-3174e0386931',
    input: { learnerUid: '019a3dda-cc44-73c0-989a-2e14c65d13e1', releaseId: '019a3ddb-3c68-7c34-9677-048ac9a7d1f8' },
  };
  const mutationDocument = toJsonSchema(registrySchema('CreateEnrollmentMutation'), 'CreateEnrollmentMutation');
  assert.equal(ajv.validate('mutation-valid', mutationDocument, envelope), true);
  assert.equal(
    ajv.validate('mutation-actor', mutationDocument, { ...envelope, actor: 'agent' }),
    false,
    'AJV también rechaza claves desconocidas',
  );
  assert.equal(
    ajv.validate('mutation-bad-key', mutationDocument, { ...envelope, idempotencyKey: 'no-uuid' }),
    false,
    'el patrón de UUID está expresado en JSON Schema',
  );
});

test('lo que solo valida Zod queda anotado, no simulado', () => {
  const ajv = createAjv();

  // 1. Currículo con ciclo: JSON Schema no detecta ciclos.
  const curriculum = parseYaml(readFixture('notebooks/electronics/curriculum/index.yaml'), curriculumSchema);
  const cyclic = clone(curriculum);
  const firstSkill = cyclic.skills[0];
  const lastSkill = cyclic.skills[2];
  assert.ok(firstSkill && lastSkill);
  firstSkill.prerequisites = [lastSkill.id];
  lastSkill.prerequisites = [firstSkill.id];
  const curriculumDocument = toJsonSchema(curriculumSchema, 'Curriculum');
  assert.equal(curriculumSchema.safeParse(cyclic).success, false, 'Zod rechaza el ciclo');
  assert.equal(
    ajv.validate('cyclic-curriculum', curriculumDocument, cyclic),
    true,
    'AJV no puede ver el ciclo: por eso no debe usarse como única validación',
  );
  assert.match(JSON.stringify(curriculumDocument), /x-runtime-validation/);

  // 2. Rúbrica sin un anchor intermedio: la cobertura 0..max es de Zod.
  const rubric = parseYaml(readFixture('academic/rubric.yaml'), rubricSchema);
  const incomplete = clone(rubric);
  const criterion = incomplete.criteria[0];
  assert.ok(criterion);
  criterion.anchors = criterion.anchors.filter((anchor) => anchor.points !== 1);
  const rubricDocument = toJsonSchema(rubricSchema, 'Rubric');
  assert.equal(rubricSchema.safeParse(incomplete).success, false);
  assert.equal(ajv.validate('rubric', rubricDocument, incomplete), true, 'AJV no cubre el rango de anchors');
  assert.match(JSON.stringify(rubricDocument), /x-runtime-validation/);

  // 3. hints_used descoherente.
  const attempt = parseYaml(readFixture('academic/attempt.yaml'), attemptSchema);
  const mismatch = clone(attempt);
  mismatch.hints_used = 5;
  const attemptDocument = toJsonSchema(attemptSchema, 'Attempt');
  assert.equal(attemptSchema.safeParse(mismatch).success, false);
  assert.equal(ajv.validate('attempt', attemptDocument, mismatch), true);
  assert.match(JSON.stringify(attemptDocument), /x-runtime-validation/);

  // 4. Idioma no canónico.
  const profile = parseYaml(readFixture('portfolio/profile.yaml'), profileSchema);
  const badLanguage = clone(profile);
  badLanguage.preferred_instruction_language = 'ES-mx';
  const profileDocument = toJsonSchema(profileSchema, 'Profile');
  assert.equal(profileSchema.safeParse(badLanguage).success, false);
  assert.equal(ajv.validate('profile', profileDocument, badLanguage), true);
  assert.match(JSON.stringify(profileDocument), /x-runtime-validation/);

  // 5. Fecha de calendario imposible.
  assert.equal(utcInstantSchema.safeParse('2026-02-31T00:00:00.000Z').success, false);
  assert.equal(bcp47Schema.safeParse('ES-mx').success, false);

  // 6. Path no portable: el JSON Schema solo dice `string` y lo dice con nota.
  const resources = parseYaml(readFixture('notebooks/electronics/resources/index.yaml'), resourceCatalogSchema);
  const escaped = clone(resources);
  const entry = escaped.resources[0];
  assert.ok(entry);
  entry.path = '../../etc/passwd';
  const resourcesDocument = toJsonSchema(resourceCatalogSchema, 'ResourceCatalog');
  assert.equal(resourceCatalogSchema.safeParse(escaped).success, false);
  assert.equal(ajv.validate('resources-escaped', resourcesDocument, escaped), true);
  assert.match(JSON.stringify(resourcesDocument), /Las reglas portables/, 'el path portable lleva anotación explícita');

  // 7. Ítem sin cobertura de rúbrica.
  const item = parseYaml(readFixture('academic/item.yaml'), itemSchema);
  const uncoveredItem = clone(item);
  uncoveredItem.skill_ids = ['apply-ohms-law', 'understand-voltage'];
  const itemDocument = toJsonSchema(itemSchema, 'Item');
  assert.equal(itemSchema.safeParse(uncoveredItem).success, false);
  assert.equal(ajv.validate('item-uncovered', itemDocument, uncoveredItem), true);
  assert.match(JSON.stringify(itemDocument), /x-runtime-validation/);
});

test('los invariantes anotados aparecen en los esquemas que los contienen', () => {
  const expected: Array<[string, string]> = [
    ['NotebookManifest', 'curriculum_path'],
    ['Curriculum', 'acyclic'],
    ['Rubric', 'anchors'],
    ['Attempt', 'hints_used'],
    ['Item', 'rubric'],
    ['Assessment', 'rubric_snapshot'],
    ['AnswerSnapshot', 'digest'],
    ['Artifact', 'inventario'],
    ['LearningEvent', 'ordinal'],
    ['CreateEnrollmentMutation', 'expectedRevisions'],
    // Vistas: lo que Core calcula fuera del objeto.
    ['Hint', 'ordinal'],
    ['ServedItem', 'solución'],
    ['VerificationReport', 'cuarentena'],
    ['MasteryState', 'replay'],
    ['EnrollmentView', 'sesión'],
    ['SolutionDeclaration', 'canónica'],
  ];
  for (const [name, needle] of expected) {
    const document = toJsonSchema(registrySchema(name), name);
    const text = JSON.stringify(document);
    assert.ok(text.includes('x-runtime-validation'), `${name} debe anotar sus invariantes de runtime`);
    assert.ok(text.includes(needle), `${name}: la anotación debe mencionar ${needle}`);
  }
});

test('el esquema de criterio de rúbrica anota la cobertura de anchors', () => {
  const document = toJsonSchema(rubricCriterionSchema, 'RubricCriterion');
  const annotation = document['x-runtime-validation'];
  assert.equal(typeof annotation, 'string');
  assert.match(String(annotation), /anchors|0\.\.max/);
});

test('límites que JSON Schema no puede ver quedan anotados como x-runtime-validation', () => {
  const ajv = createAjv();

  // 2 MiB medidos en bytes UTF-8: JSON Schema solo ve maxLength y pattern.
  const accented = 'é'.repeat(1024 * 1024 + 1); // 2 MiB + 2 bytes, menos de 2 MiB de caracteres
  assert.ok(accented.length < 2 * 1024 * 1024);
  const contentDoc = toJsonSchema(contentTextSchema, 'ContentText');
  assert.equal(contentTextSchema.safeParse(accented).success, false, 'Zod mide bytes');
  assert.equal(ajv.validate('content-bytes', contentDoc, accented), true, 'AJV no mide bytes UTF-8');
  assert.match(JSON.stringify(contentDoc), /x-runtime-validation/);

  // `answer` no es JSON: JSON Schema lo ve como cualquier valor.
  const solutionDoc = toJsonSchema(registrySchema('SolutionDeclaration'), 'SolutionDeclaration');
  const withDate = { answer: new Date('2026-10-25T00:00:00.000Z') };
  assert.equal(solutionDeclarationSchema.safeParse(withDate).success, false, 'Date no es JSON en Zod');
  assert.equal(ajv.validate('solution-date', solutionDoc, withDate), true, 'JSON Schema no lo sabe');
  assert.match(JSON.stringify(solutionDoc), /x-runtime-validation/, 'y queda anotado honestamente');
});

test('el registro expone las vistas de §9.2 y generan sin excepciones', () => {
  const documents = buildJsonSchemaDocuments();
  for (const name of [
    'InstalledNotebook',
    'VerificationReport',
    'EnrollmentView',
    'DiagnosticSession',
    'ServedItem',
    'Hint',
    'MasteryState',
    'MasteryView',
    'RebuildReport',
    'RecoveryReport',
    'DoctorReport',
    'CatalogItemDefinition',
    'CatalogSourceRef',
  ]) {
    const document = documents[name];
    assert.ok(document, `${name} debe generar JSON Schema`);
    assert.equal(document['$schema'], 'https://json-schema.org/draft/2020-12/schema');
  }
});

/**
 * Todos los fixtures publicados validan con su esquema.
 * Si añades un fixture, decláralo aquí: un YAML sin esquema asociado hace fallar la prueba.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ZodType } from 'zod';
import {
  assessmentDecisionSchema,
  assessmentSchema,
  assetsManifestSchema,
  assignmentSchema,
  artifactSchema,
  attemptSchema,
  curriculumSchema,
  enrollmentSchema,
  itemCatalogSchema,
  itemSchema,
  learningEventSchema,
  notebookManifestSchema,
  parseYaml,
  profileSchema,
  resourceCatalogSchema,
  rubricSchema,
  schemaRegistry,
  type Mutation,
} from '../dist/index.js';
import { listFixtureFiles, readFixture } from './helpers.ts';

function schemaFor(relativePath: string): ZodType {
  const direct: Record<string, ZodType> = {
    'portfolio/profile.yaml': profileSchema,
    'portfolio/enrollment.yaml': enrollmentSchema,
    'portfolio/assignment.yaml': assignmentSchema,
    'portfolio/artifact.yaml': artifactSchema,
    'academic/rubric.yaml': rubricSchema,
    'academic/item.yaml': itemSchema,
    'academic/attempt.yaml': attemptSchema,
    'academic/assessment.yaml': assessmentSchema,
    'academic/assessment-decision.yaml': assessmentDecisionSchema,
    'commands/create-enrollment.mutation.yaml': required('CreateEnrollmentMutation'),
    'commands/enrollment-status.mutation.yaml': required('EnrollmentStatusMutation'),
    'commands/install-notebook.mutation.yaml': required('InstallNotebookMutation'),
  };
  const found = direct[relativePath];
  if (found !== undefined) return found;

  if (/^notebooks\/[^/]+\/notebook\.yaml$/.test(relativePath)) return notebookManifestSchema;
  if (/^notebooks\/[^/]+\/resources\/index\.yaml$/.test(relativePath)) return resourceCatalogSchema;
  if (/^notebooks\/[^/]+\/curriculum\/index\.yaml$/.test(relativePath)) return curriculumSchema;
  if (/^notebooks\/[^/]+\/assets\/manifest\.yaml$/.test(relativePath)) return assetsManifestSchema;
  if (/^notebooks\/[^/]+\/items\/[^/]+\.yaml$/.test(relativePath)) return itemCatalogSchema;
  if (/^events\/[^/]+\.yaml$/.test(relativePath)) return learningEventSchema;
  throw new Error(`fixture sin esquema declarado: ${relativePath}`);
}

function required(name: string): ZodType {
  const schema = schemaRegistry[name];
  assert.ok(schema, `falta ${name} en schemaRegistry`);
  return schema;
}

test('todos los fixtures de contratos validan', () => {
  const files = listFixtureFiles('', 'yaml').filter((file) => !file.startsWith('invalid/'));
  assert.ok(files.length >= 20, `fixtures YAML: ${files.length}`);
  for (const file of files) {
    const schema = schemaFor(file);
    const value = parseYaml(readFixture(file), schema);
    assert.ok(value !== null && value !== undefined, `${file} debe producir datos`);
  }
});

test('las mutaciones de fixture son envelopes completos', () => {
  const files = listFixtureFiles('commands', 'yaml');
  assert.ok(files.length >= 3, 'al menos tres envelopes publicados');
  for (const file of files) {
    const relative = `commands/${file}`;
    const value = parseYaml(readFixture(relative), schemaFor(relative)) as Mutation<unknown>;
    assert.equal(typeof value.idempotencyKey, 'string');
    assert.notEqual(value.input, undefined, `${relative}: input presente`);
  }
});

test('los fixtures de invalid/ no son aceptados por ningún esquema de dominio', () => {
  const invalidFiles = listFixtureFiles('invalid/yaml', 'yaml');
  assert.ok(invalidFiles.length >= 8, `fixtures de ataque: ${invalidFiles.length}`);
  for (const file of invalidFiles) {
    let rejected = false;
    try {
      parseYaml(readFixture(`invalid/yaml/${file}`), notebookManifestSchema);
    } catch {
      rejected = true;
    }
    assert.equal(rejected, true, `invalid/yaml/${file} debe ser rechazado`);
  }
});

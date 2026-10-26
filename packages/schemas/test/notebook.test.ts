/**
 * Contratos de Notebook §4: manifiesto, catálogos, currículo y rúbricas.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assetsManifestSchema,
  curriculumSchema,
  notebookManifestSchema,
  parseYaml,
  resourceCatalogSchema,
  rubricSchema,
  YamlValidationError,
  type Curriculum,
  type NotebookManifest,
  type ResourceCatalog,
} from '../dist/index.js';
import { accepts, failureMessage, readFixture } from './helpers.ts';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function electronicsManifest(): NotebookManifest {
  return parseYaml(readFixture('notebooks/electronics/notebook.yaml'), notebookManifestSchema);
}

function electronicsResources(): ResourceCatalog {
  return parseYaml(readFixture('notebooks/electronics/resources/index.yaml'), resourceCatalogSchema);
}

function electronicsCurriculum(): Curriculum {
  return parseYaml(readFixture('notebooks/electronics/curriculum/index.yaml'), curriculumSchema);
}

test('los fixtures electrónica y referencia validan', () => {
  const manifest = electronicsManifest();
  assert.equal(manifest.identity.package_id, 'github.com/academy-a/electronics-fundamentals');
  assert.equal(manifest.capabilities.curriculum, true);
  assert.equal(manifest.capabilities.diagnostics, true);
  assert.equal(manifest.capabilities.assessments, false);

  const reference = parseYaml(readFixture('notebooks/reference/notebook.yaml'), notebookManifestSchema);
  assert.equal(reference.capabilities.curriculum, false);
  assert.equal(reference.content.curriculum_path, undefined, 'sin currículo no hay curriculum_path');
  assert.equal(reference.content.assets_manifest, undefined);
  assert.equal(reference.metadata.license, 'MIT');
});

test('los ejemplos de la especificación validan tal cual (sustituyendo placeholders)', () => {
  const specManifest = `schema_version: '1.0'
identity:
  package_uid: '019a3dd5-4a10-7a90-8eef-3174e0386931'
  package_id: 'github.com/academy-a/electronics-fundamentals'
  name: 'Electronics Fundamentals'
release:
  version: '1.0.0'
metadata:
  description: 'Fundamentos de circuitos'
  authors: [{name: 'Academy A'}]
  license: 'CC-BY-4.0'
  tags: [electronics, fundamentals]
content:
  entrypoint_resource_id: 'overview'
  resources_manifest: 'resources/index.yaml'
  assets_manifest: 'assets/manifest.yaml'
  curriculum_path: 'curriculum/index.yaml'
capabilities:
  curriculum: true
  diagnostics: false
  assessments: false
extensions: {}
`;
  const specManifestParsed = parseYaml(specManifest, notebookManifestSchema);
  assert.equal(specManifestParsed.identity.package_uid, '019a3dd5-4a10-7a90-8eef-3174e0386931');
  assert.equal(specManifestParsed.metadata.license, 'CC-BY-4.0');
  assert.equal(specManifestParsed.release.version, '1.0.0');

  const specResources = `schema_version: '1.0'
resources:
  - id: 'overview'
    path: 'index.md'
    media_type: 'text/markdown'
    title: 'Introducción'
  - id: 'ohms-law'
    path: 'resources/ohms-law.md'
    media_type: 'text/markdown'
    title: 'Ley de Ohm'
    language: 'es-MX'
extensions: {}
`;
  const resources = parseYaml(specResources, resourceCatalogSchema);
  assert.equal(resources.resources.length, 2);

  const specRubric = `schema_version: '1.0'
rubric_id: 'ohm-item'
version: '1.0.0'
criteria:
  - id: 'relation'
    description: 'Selecciona y despeja correctamente la relación V = I·R'
    max_points: 2
    anchors:
      - {points: 0, description: 'Relación incorrecta o ausente'}
      - {points: 1, description: 'Relación correcta sin despeje correcto'}
      - {points: 2, description: 'Relación y despeje correctos'}
    skill_weights: {'apply-ohms-law': 1}
  - id: 'result'
    description: 'Calcula valor y unidad conforme al resultado esperado del ítem'
    max_points: 2
    anchors:
      - {points: 0, description: 'Resultado incorrecto sin procedimiento válido'}
      - {points: 1, description: 'Procedimiento correcto con error de cálculo o unidad'}
      - {points: 2, description: 'Valor dentro de tolerancia y unidad correctos'}
    skill_weights: {'apply-ohms-law': 1}
`;
  const rubric = parseYaml(specRubric, rubricSchema);
  assert.equal(rubric.criteria.length, 2);
});

test('claves desconocidas se rechazan en cada nivel', () => {
  const topLevel = clone(electronicsManifest()) as Record<string, unknown>;
  topLevel['surprise'] = 1;
  assert.equal(notebookManifestSchema.safeParse(topLevel).success, false, 'nivel raíz');

  const nested = clone(electronicsManifest());
  (nested.identity as unknown as Record<string, unknown>)['extra'] = 'x';
  assert.equal(notebookManifestSchema.safeParse(nested).success, false, 'nivel identity');

  const deep = clone(electronicsManifest());
  (deep.capabilities as unknown as Record<string, unknown>)['extra'] = true;
  assert.equal(notebookManifestSchema.safeParse(deep).success, false, 'nivel capabilities');

  const entry = clone(electronicsResources());
  (entry.resources[0] as unknown as Record<string, unknown>)['audience'] = 'kids';
  assert.equal(resourceCatalogSchema.safeParse(entry).success, false, 'nivel entrada de catálogo');
});

test('capabilities y paths de manifiesto son coherentes', () => {
  const noPath = clone(electronicsManifest());
  delete (noPath.content as Record<string, unknown>)['curriculum_path'];
  assert.equal(notebookManifestSchema.safeParse(noPath).success, false, 'curriculum true exige curriculum_path');

  const reference = clone(parseYaml(readFixture('notebooks/reference/notebook.yaml'), notebookManifestSchema));
  (reference.content as Record<string, unknown>)['curriculum_path'] = 'curriculum/index.yaml';
  assert.equal(notebookManifestSchema.safeParse(reference).success, false, 'curriculum false prohíbe curriculum_path');

  const diagnosticsOff = clone(electronicsManifest());
  diagnosticsOff.capabilities.diagnostics = false;
  assert.equal(
    notebookManifestSchema.safeParse(diagnosticsOff).success,
    false,
    'diagnostics false prohíbe diagnostic_items_path',
  );

  const diagnosticsOn = clone(electronicsManifest());
  diagnosticsOn.capabilities.diagnostics = true;
  delete (diagnosticsOn.capabilities as Record<string, unknown>)['diagnostic_items_path'];
  assert.equal(notebookManifestSchema.safeParse(diagnosticsOn).success, false, 'diagnostics true exige el banco');

  const duplicated = clone(electronicsManifest());
  duplicated.content.resources_manifest = 'curriculum/index.yaml';
  assert.equal(notebookManifestSchema.safeParse(duplicated).success, false, 'paths de manifiesto distintos');

  const assessmentsOn = clone(electronicsManifest());
  assessmentsOn.capabilities.assessments = true;
  assert.equal(
    notebookManifestSchema.safeParse(assessmentsOn).success,
    false,
    'assessments true exige assessment_items_path',
  );

  const assessmentsOff = clone(electronicsManifest());
  assessmentsOff.capabilities.assessments = false;
  (assessmentsOff.capabilities as Record<string, unknown>)['assessment_items_path'] = 'items/assessment.yaml';
  assert.equal(
    notebookManifestSchema.safeParse(assessmentsOff).success,
    false,
    'assessments false prohíbe assessment_items_path',
  );

  const banksOn = clone(electronicsManifest());
  banksOn.capabilities.assessments = true;
  (banksOn.capabilities as Record<string, unknown>)['assessment_items_path'] = 'items/assessment.yaml';
  assert.equal(
    notebookManifestSchema.safeParse(banksOn).success,
    true,
    'ambas capabilities con sus catálogos declarados son válidas',
  );
});

test('catálogo: IDs y paths únicos, media types del allowlist, idioma opcional', () => {
  const duplicateId = clone(electronicsResources());
  const first = duplicateId.resources[0];
  assert.ok(first);
  duplicateId.resources.push({ ...first, path: 'other.md' });
  assert.equal(resourceCatalogSchema.safeParse(duplicateId).success, false, 'id duplicado');

  const duplicatePath = clone(electronicsResources());
  const second = duplicatePath.resources[1];
  assert.ok(second);
  duplicatePath.resources.push({ ...second, id: 'other' });
  assert.equal(resourceCatalogSchema.safeParse(duplicatePath).success, false, 'path duplicado');

  const svg = clone(electronicsResources());
  const entry = svg.resources[0];
  assert.ok(entry);
  (entry as unknown as Record<string, unknown>)['media_type'] = 'image/svg+xml';
  assert.equal(resourceCatalogSchema.safeParse(svg).success, false, 'allowlist de formatos');

  const badLanguage = clone(electronicsResources());
  const withLanguage = badLanguage.resources[1];
  assert.ok(withLanguage);
  withLanguage.language = 'ES-mx';
  assert.equal(resourceCatalogSchema.safeParse(badLanguage).success, false, 'BCP 47 canónico');

  const empty = { schema_version: '1.0', resources: [], extensions: {} };
  assert.equal(resourceCatalogSchema.safeParse(empty).success, false, 'catálogo vacío');
});

test('assets: hash, origen y allowlist', () => {
  const manifest = parseYaml(readFixture('notebooks/electronics/assets/manifest.yaml'), assetsManifestSchema);
  const asset = manifest.assets[0];
  assert.ok(asset);
  assert.match(asset.sha256, /^[0-9a-f]{64}$/);

  const badHash = clone(manifest);
  const badHashAsset = badHash.assets[0];
  assert.ok(badHashAsset);
  badHashAsset.sha256 = 'DEADBEEF';
  assert.equal(assetsManifestSchema.safeParse(badHash).success, false);

  const badOrigin = clone(manifest);
  const badOriginAsset = badOrigin.assets[0];
  assert.ok(badOriginAsset);
  (badOriginAsset as unknown as Record<string, unknown>)['origin'] = 'ai-generated';
  assert.equal(assetsManifestSchema.safeParse(badOrigin).success, false, 'origen de asset cerrado');

  const html = clone(manifest);
  const htmlAsset = html.assets[0];
  assert.ok(htmlAsset);
  (htmlAsset as unknown as Record<string, unknown>)['media_type'] = 'text/html';
  assert.equal(assetsManifestSchema.safeParse(html).success, false, 'HTML fuera del allowlist');
});

test('currículo: referencias válidas y DAG sin ciclos', () => {
  const curriculum = electronicsCurriculum();
  assert.equal(curriculum.skills.length, 3);

  const unknownPrereq = clone(curriculum);
  const skill = unknownPrereq.skills[2];
  assert.ok(skill);
  skill.prerequisites = ['ghost-skill'];
  assert.equal(curriculumSchema.safeParse(unknownPrereq).success, false, 'prerequisito inexistente');

  const selfRef = clone(curriculum);
  const selfSkill = selfRef.skills[0];
  assert.ok(selfSkill);
  selfSkill.prerequisites = [selfSkill.id];
  assert.equal(curriculumSchema.safeParse(selfRef).success, false, 'autorreferencia');

  const cycle = clone(curriculum);
  const firstSkill = cycle.skills[0];
  const lastSkill = cycle.skills[2];
  assert.ok(firstSkill && lastSkill);
  lastSkill.prerequisites = ['understand-voltage'];
  firstSkill.prerequisites = ['apply-ohms-law'];
  const cycleResult = curriculumSchema.safeParse(cycle);
  assert.equal(cycleResult.success, false, 'ciclo de prerrequisitos');
  assert.match(failureMessage(curriculumSchema, cycle), /cycle|prerequisite/i);

  const unknownModuleSkill = clone(curriculum);
  const module = unknownModuleSkill.modules[0];
  assert.ok(module);
  module.skill_ids = ['apply-ohms-law', 'ghost-skill'];
  assert.equal(curriculumSchema.safeParse(unknownModuleSkill).success, false, 'skill inexistente en módulo');

  const unknownResource = clone(curriculum);
  const moduleResource = unknownResource.modules[0];
  assert.ok(moduleResource);
  moduleResource.resource_ids = ['ohms-law', 'ghost-resource'];
  // El catálogo de recursos no está en este documento: la referencia a skill sí se valida aquí,
  // la de recurso se valida en validateNotebookContracts (se comprueba en contracts.test.ts).
  assert.equal(curriculumSchema.safeParse(unknownResource).success, true);

  const duplicateModule = clone(curriculum);
  const moduleDuplicate = duplicateModule.modules[0];
  assert.ok(moduleDuplicate);
  duplicateModule.modules.push({ ...moduleDuplicate });
  assert.equal(curriculumSchema.safeParse(duplicateModule).success, false, 'módulo duplicado');

  const duplicateSkill = clone(curriculum);
  duplicateSkill.skills.push({ ...duplicateSkill.skills[0]! });
  assert.equal(curriculumSchema.safeParse(duplicateSkill).success, false, 'skill duplicada');

  const duplicateResourceInModule = clone(curriculum);
  const moduleWithDuplicate = duplicateResourceInModule.modules[0];
  assert.ok(moduleWithDuplicate);
  moduleWithDuplicate.resource_ids = ['ohms-law', 'ohms-law'];
  assert.equal(curriculumSchema.safeParse(duplicateResourceInModule).success, false, 'recurso repetido en módulo');

  const duplicateSkillInModule = clone(curriculum);
  const moduleWithDuplicateSkill = duplicateSkillInModule.modules[0];
  assert.ok(moduleWithDuplicateSkill);
  moduleWithDuplicateSkill.skill_ids = ['apply-ohms-law', 'apply-ohms-law'];
  assert.equal(curriculumSchema.safeParse(duplicateSkillInModule).success, false, 'skill repetida en módulo');
});

test('rúbricas: anchors 0..max completos y pesos 1..100', () => {
  const rubric = parseYaml(readFixture('academic/rubric.yaml'), rubricSchema);

  const missingAnchor = clone(rubric);
  const criterion = missingAnchor.criteria[0];
  assert.ok(criterion);
  criterion.anchors = criterion.anchors.filter((anchor) => anchor.points !== 1);
  assert.equal(rubricSchema.safeParse(missingAnchor).success, false, 'falta el anchor 1');

  const duplicateAnchor = clone(rubric);
  const duplicateCriterion = duplicateAnchor.criteria[0];
  assert.ok(duplicateCriterion);
  duplicateCriterion.anchors[1] = { ...duplicateCriterion.anchors[0]! };
  assert.equal(rubricSchema.safeParse(duplicateAnchor).success, false, 'anchor duplicado');

  const outOfRange = clone(rubric);
  const outOfRangeCriterion = outOfRange.criteria[0];
  assert.ok(outOfRangeCriterion);
  outOfRangeCriterion.anchors.push({ points: 3, description: 'fuera de rango' });
  assert.equal(rubricSchema.safeParse(outOfRange).success, false, 'anchor > max_points');

  const zeroMax = clone(rubric);
  const zeroCriterion = zeroMax.criteria[0];
  assert.ok(zeroCriterion);
  zeroCriterion.max_points = 0;
  assert.equal(rubricSchema.safeParse(zeroMax).success, false, 'max_points >= 1');

  const hugeMax = clone(rubric);
  const hugeCriterion = hugeMax.criteria[0];
  assert.ok(hugeCriterion);
  hugeCriterion.max_points = 101;
  assert.equal(rubricSchema.safeParse(hugeMax).success, false, 'max_points <= 100');

  const noWeights = clone(rubric);
  const noWeightsCriterion = noWeights.criteria[0];
  assert.ok(noWeightsCriterion);
  noWeightsCriterion.skill_weights = {};
  assert.equal(rubricSchema.safeParse(noWeights).success, false, 'criterio sin pesos');

  const heavyWeight = clone(rubric);
  const heavyCriterion = heavyWeight.criteria[0];
  assert.ok(heavyCriterion);
  heavyCriterion.skill_weights = { 'apply-ohms-law': 101 };
  assert.equal(rubricSchema.safeParse(heavyWeight).success, false, 'peso <= 100');

  const weirdSkill = clone(rubric);
  const weirdCriterion = weirdSkill.criteria[0];
  assert.ok(weirdCriterion);
  weirdCriterion.skill_weights = { 'Apply_Ohms': 1 };
  assert.equal(rubricSchema.safeParse(weirdSkill).success, false, 'skill id fuera del patrón');

  const duplicateCriterionId = clone(rubric);
  const duplicatedFirst = duplicateCriterionId.criteria[0];
  assert.ok(duplicatedFirst);
  duplicateCriterionId.criteria.push({ ...duplicatedFirst });
  assert.equal(rubricSchema.safeParse(duplicateCriterionId).success, false, 'criterio duplicado');
});

test('el parser estricto rechaza documentos YAML inválidos para el esquema', () => {
  const broken = `schema_version: '2.0'\n`;
  assert.throws(() => parseYaml(broken, notebookManifestSchema), YamlValidationError);
  try {
    parseYaml(broken, notebookManifestSchema);
    assert.fail('debió lanzar');
  } catch (error) {
    assert.ok(error instanceof YamlValidationError);
    assert.equal(error.issues[0]?.code, 'SCHEMA_MISMATCH');
    assert.equal(error.issues[0]?.path, 'schema_version');
  }
  assert.equal(accepts(notebookManifestSchema, { schema_version: '1.0' }), false, 'objeto incompleto');
});

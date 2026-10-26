/**
 * Relaciones entre documentos de un Notebook (§4, §7.1) mediante `validateNotebookContracts`.
 *
 * Incluye las regresiones de CF03: ningún fallo de esquema puede convertirse en éxito.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assetsManifestSchema,
  curriculumSchema,
  itemCatalogSchema,
  notebookManifestSchema,
  parseYaml,
  resourceCatalogSchema,
  validateNotebookContracts,
  type AssetsManifest,
  type ContractIssueCode,
  type Curriculum,
  type ItemCatalog,
  type NotebookManifest,
  type ResourceCatalog,
} from '../dist/index.js';
import { readFixture } from './helpers.ts';

/** Documentos ya parseados y tipados: así los tests pueden mutarlos con seguridad. */
type Docs = {
  manifest: NotebookManifest;
  resources: ResourceCatalog;
  curriculum?: Curriculum;
  assets?: AssetsManifest;
  itemBanks?: Record<string, ItemCatalog>;
};

function diagnosticCatalog(): ItemCatalog {
  return parseYaml(readFixture('notebooks/electronics/items/diagnostic.yaml'), itemCatalogSchema);
}

function electronicsDocs(): Docs {
  return {
    manifest: parseYaml(readFixture('notebooks/electronics/notebook.yaml'), notebookManifestSchema),
    resources: parseYaml(readFixture('notebooks/electronics/resources/index.yaml'), resourceCatalogSchema),
    curriculum: parseYaml(readFixture('notebooks/electronics/curriculum/index.yaml'), curriculumSchema),
    assets: parseYaml(readFixture('notebooks/electronics/assets/manifest.yaml'), assetsManifestSchema),
    itemBanks: { 'items/diagnostic.yaml': diagnosticCatalog() },
  };
}

function referenceDocs(): Docs {
  return {
    manifest: parseYaml(readFixture('notebooks/reference/notebook.yaml'), notebookManifestSchema),
    resources: parseYaml(readFixture('notebooks/reference/resources/index.yaml'), resourceCatalogSchema),
  };
}

function codes(issues: ReadonlyArray<{ code: ContractIssueCode }>): ContractIssueCode[] {
  return issues.map((issue) => issue.code);
}

test('fixture electrónica completo valida sin incidencias', () => {
  const result = validateNotebookContracts(electronicsDocs());
  assert.deepEqual(result.issues, [], 'sin relaciones rotas');
  assert.equal(result.ok, true);
});

test('fixture referencia sin currículo ni assets valida (AC16)', () => {
  const result = validateNotebookContracts(referenceDocs());
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

/* ------------------------------------------------------------------ *
 * CF03: ningún fallo de esquema puede convertirse en éxito
 * ------------------------------------------------------------------ */

test('CF03: un path no string en el manifiesto invalida el resultado combinado', () => {
  for (const badValue of [42, null, true, ['resources/index.yaml'], { path: 'x' }]) {
    const docs = electronicsDocs();
    (docs.manifest.content as unknown as Record<string, unknown>)['resources_manifest'] = badValue;
    const schemaOk = notebookManifestSchema.safeParse(docs.manifest).success;
    const result = validateNotebookContracts(docs);
    assert.equal(schemaOk, false, `NotebookManifest.safeParse debe fallar con ${JSON.stringify(badValue)}`);
    assert.equal(result.ok, false, `validateNotebookContracts no puede devolver ok con ${JSON.stringify(badValue)}`);
    assert.ok(result.issues.length > 0, 'issues no vacío');
    assert.ok(codes(result.issues).includes('PATH_NOT_PORTABLE'), codes(result.issues).join(','));
  }
});

test('CF03: path ausente en el manifiesto invalida el resultado', () => {
  const docs = electronicsDocs();
  delete (docs.manifest.content as Record<string, unknown>)['resources_manifest'];
  assert.equal(notebookManifestSchema.safeParse(docs.manifest).success, false);
  const result = validateNotebookContracts(docs);
  assert.equal(result.ok, false);
  assert.ok(result.issues.length > 0);
  assert.ok(codes(result.issues).includes('PATH_NOT_PORTABLE'), codes(result.issues).join(','));
});

test('CF03: paths no string en recursos y assets invalidan el resultado', () => {
  for (const badValue of [42, null, 7]) {
    const resources = electronicsDocs();
    (resources.resources.resources[0] as unknown as Record<string, unknown>)['path'] = badValue;
    assert.equal(resourceCatalogSchema.safeParse(resources.resources).success, false);
    const resourceResult = validateNotebookContracts(resources);
    assert.equal(resourceResult.ok, false);
    assert.ok(resourceResult.issues.length > 0);
    assert.ok(codes(resourceResult.issues).includes('PATH_NOT_PORTABLE'), codes(resourceResult.issues).join(','));

    const assets = electronicsDocs();
    (assets.assets?.assets[0] as unknown as Record<string, unknown>)['path'] = badValue;
    assert.equal(assetsManifestSchema.safeParse(assets.assets).success, false);
    const assetResult = validateNotebookContracts(assets);
    assert.equal(assetResult.ok, false);
    assert.ok(assetResult.issues.length > 0);
  }
});

test('CF03: fallos combinados acumulan diagnósticos, nunca colapsan a éxito', () => {
  const docs = electronicsDocs();
  (docs.manifest.content as unknown as Record<string, unknown>)['resources_manifest'] = 42;
  (docs.resources.resources[0] as unknown as Record<string, unknown>)['path'] = null;
  delete (docs.manifest.content as Record<string, unknown>)['assets_manifest'];
  const result = validateNotebookContracts(docs);
  assert.equal(result.ok, false);
  assert.ok(result.issues.length >= 2, `esperaba varios diagnósticos: ${JSON.stringify(result.issues)}`);
  assert.ok(codes(result.issues).includes('PATH_NOT_PORTABLE'));
  // Ningún problema se pierde por filtrado: el de recursos sigue presente.
  assert.ok(
    result.issues.some((issue) => issue.document === 'resources'),
    'el fallo del catálogo de recursos también se reporta',
  );
});

test('CF03: un fallo de esquema que no sea de path también se reporta', () => {
  const docs = electronicsDocs();
  (docs.manifest.metadata as unknown as Record<string, unknown>)['license'] = 42;
  assert.equal(notebookManifestSchema.safeParse(docs.manifest).success, false);
  const result = validateNotebookContracts(docs);
  assert.equal(result.ok, false);
  assert.ok(result.issues.length > 0);
  assert.ok(codes(result.issues).includes('SCHEMA_INVALID'), codes(result.issues).join(','));
});

/* ------------------------------------------------------------------ *
 * Bancos de ítems asociados a su path declarado (§4.1)
 * ------------------------------------------------------------------ */

test('cada path declarado exige su catálogo', () => {
  const missing = electronicsDocs();
  delete missing['itemBanks'];
  const missingResult = validateNotebookContracts(missing);
  assert.ok(codes(missingResult.issues).includes('MISSING_ITEM_BANK'), codes(missingResult.issues).join(','));

  const empty = electronicsDocs();
  empty['itemBanks'] = {};
  assert.ok(codes(validateNotebookContracts(empty).issues).includes('MISSING_ITEM_BANK'));

  const wrongKey = electronicsDocs();
  wrongKey['itemBanks'] = { 'items/otro.yaml': diagnosticCatalog() };
  const wrongKeyResult = validateNotebookContracts(wrongKey);
  assert.ok(codes(wrongKeyResult.issues).includes('MISSING_ITEM_BANK'), 'el path declarado sigue sin catálogo');
  assert.ok(codes(wrongKeyResult.issues).includes('UNDECLARED_ITEM_BANK'), 'y el banco entregado no está declarado');
});

test('un banco anónimo (array) se rechaza', () => {
  const docs = electronicsDocs();
  docs['itemBanks'] = [diagnosticCatalog()] as unknown as Record<string, ItemCatalog>;
  const result = validateNotebookContracts(docs);
  assert.equal(result.ok, false);
  assert.ok(codes(result.issues).includes('INVALID_BANKS_MAP'), codes(result.issues).join(','));
});

test('una capacidad sin su path o con el banco equivocado no se satisface', () => {
  // capabilities.assessments se activa en el manifiesto, pero solo existe el banco de diagnóstico.
  const docs = electronicsDocs();
  docs.manifest.capabilities.assessments = true;
  (docs.manifest.capabilities as Record<string, unknown>)['assessment_items_path'] = 'items/assessment.yaml';
  const result = validateNotebookContracts(docs);
  assert.equal(result.ok, false);
  assert.ok(
    result.issues.some((issue) => issue.code === 'MISSING_ITEM_BANK' && issue.path.includes('assessment')),
    codes(result.issues).join(','),
  );
});

test('definition_id duplicado entre catálogos es ambiguo y se rechaza', () => {
  const docs = electronicsDocs();
  docs.manifest.capabilities.assessments = true;
  (docs.manifest.capabilities as Record<string, unknown>)['assessment_items_path'] = 'items/assessment.yaml';
  docs['itemBanks'] = {
    'items/diagnostic.yaml': diagnosticCatalog(),
    'items/assessment.yaml': diagnosticCatalog(),
  };
  const result = validateNotebookContracts(docs);
  assert.equal(result.ok, false);
  assert.ok(codes(result.issues).includes('DUPLICATE_ID'), codes(result.issues).join(','));
});

test('el catálogo se valida con su prefijo de path', () => {
  const docs = electronicsDocs();
  const broken = diagnosticCatalog();
  broken.items[0]!.skill_ids = [];
  docs['itemBanks'] = { 'items/diagnostic.yaml': broken };
  const result = validateNotebookContracts(docs);
  assert.equal(result.ok, false);
  const issue = result.issues.find((candidate) => candidate.code === 'SCHEMA_INVALID');
  assert.ok(issue, codes(result.issues).join(','));
  assert.match(issue.path, /^itemBanks\[items\/diagnostic\.yaml\]/);
});

/* ------------------------------------------------------------------ *
 * Relaciones
 * ------------------------------------------------------------------ */

test('entrypoint debe existir en el catálogo', () => {
  const docs = electronicsDocs();
  docs.manifest.content.entrypoint_resource_id = 'ghost';
  const result = validateNotebookContracts(docs);
  assert.equal(result.ok, false);
  assert.ok(codes(result.issues).includes('ENTRYPOINT_MISSING'));
});

test('referencias de módulos a recursos desconocidos', () => {
  const docs = electronicsDocs();
  const curriculum = docs.curriculum;
  assert.ok(curriculum);
  const module = curriculum.modules[0];
  assert.ok(module);
  module.resource_ids = ['ohms-law', 'ghost-resource'];
  const result = validateNotebookContracts(docs);
  assert.ok(codes(result.issues).includes('UNKNOWN_RESOURCE_REF'));
  const issue = result.issues.find((candidate) => candidate.code === 'UNKNOWN_RESOURCE_REF');
  assert.equal(issue?.document, 'curriculum');
  assert.match(issue?.path ?? '', /^modules\[0\]\.resource_ids\[1\]$/);
});

test('referencias de ítems a recursos y skills desconocidos', () => {
  const docs = electronicsDocs();
  const catalog = diagnosticCatalog();
  const item = catalog.items[0];
  assert.ok(item);
  // Un skill desconocido pero cubierto por su rúbrica pasa el esquema individual:
  // solo la relación con el currículo puede detectarlo.
  item.skill_ids = ['apply-ohms-law', 'understand-current'];
  const criterion = item.rubric.criteria[0];
  assert.ok(criterion);
  criterion.skill_weights = { 'apply-ohms-law': 1, 'understand-current': 1 };
  item.source_refs.push({ ...item.source_refs[0]!, resource_id: 'ghost-resource' });
  docs['itemBanks'] = { 'items/diagnostic.yaml': catalog };

  const result = validateNotebookContracts(docs);
  assert.equal(result.ok, false);
  assert.ok(codes(result.issues).includes('UNKNOWN_SKILL_REF'), codes(result.issues).join(','));
  assert.ok(codes(result.issues).includes('UNKNOWN_RESOURCE_REF'), codes(result.issues).join(','));
});

test('currículo exigido o sobrante según capabilities', () => {
  const full = electronicsDocs();
  const assets = full.assets;
  const banks = full.itemBanks;
  assert.ok(assets !== undefined && banks !== undefined);
  const missing = {
    manifest: full.manifest,
    resources: full.resources,
    assets,
    itemBanks: banks,
  };
  assert.ok(codes(validateNotebookContracts(missing).issues).includes('MISSING_CURRICULUM'));

  const reference = referenceDocs();
  const extraCurriculum = parseYaml(
    readFixture('notebooks/electronics/curriculum/index.yaml'),
    curriculumSchema,
  );
  const result = validateNotebookContracts({
    manifest: reference.manifest,
    resources: reference.resources,
    curriculum: extraCurriculum,
  });
  assert.ok(codes(result.issues).includes('UNDECLARED_CURRICULUM'));
});

test('assets declarados sin manifest y manifest sin assets', () => {
  const full = electronicsDocs();
  const curriculum = full.curriculum;
  const banks = full.itemBanks;
  assert.ok(curriculum !== undefined && banks !== undefined);
  const missing = {
    manifest: full.manifest,
    resources: full.resources,
    curriculum,
    itemBanks: banks,
  };
  assert.ok(codes(validateNotebookContracts(missing).issues).includes('MISSING_ASSETS'));

  const reference = referenceDocs();
  const extraAssets = parseYaml(readFixture('notebooks/electronics/assets/manifest.yaml'), assetsManifestSchema);
  const result = validateNotebookContracts({
    manifest: reference.manifest,
    resources: reference.resources,
    assets: extraAssets,
  });
  assert.ok(codes(result.issues).includes('UNDECLARED_ASSETS'));
});

test('unicidad global de paths y colisiones por case-fold Unicode', () => {
  const duplicate = electronicsDocs();
  duplicate.manifest.content.assets_manifest = duplicate.manifest.content.resources_manifest;
  assert.ok(codes(validateNotebookContracts(duplicate).issues).includes('DUPLICATE_PATH'), 'mismo path dos veces');

  const folded = electronicsDocs();
  const catalog = folded.resources;
  const first = catalog.resources[0];
  assert.ok(first);
  catalog.resources.push({ ...first, id: 'readme-alt', path: 'INDEX.md' });
  const foldedResult = validateNotebookContracts(folded);
  assert.ok(
    codes(foldedResult.issues).includes('PATH_COLLISION'),
    `case-fold debe detectar INDEX.md vs index.md: ${codes(foldedResult.issues).join(',')}`,
  );
});

test('paths no portables se reportan con su código', () => {
  const docs = electronicsDocs();
  const catalog = docs.resources;
  const second = catalog.resources[1];
  assert.ok(second);
  second.path = '../escape.md';
  const result = validateNotebookContracts(docs);
  assert.ok(codes(result.issues).includes('PATH_NOT_PORTABLE'));
});

/* ------------------------------------------------------------------ *
 * LicenseRef (§4.1, CF02)
 * ------------------------------------------------------------------ */

test('metadata.license LicenseRef exige declaration en license_files', () => {
  const docs = electronicsDocs();
  docs.manifest.metadata.license = 'LicenseRef-School-Policy';
  const result = validateNotebookContracts(docs);
  assert.equal(result.ok, false, 'sin license_files el manifiesto no valida');
  assert.ok(result.issues.length > 0);

  const declared = electronicsDocs();
  declared.manifest.metadata.license = 'LicenseRef-School-Policy';
  declared.manifest.metadata.license_files = { 'LicenseRef-School-Policy': 'licenses/school-policy.txt' };
  assert.equal(notebookManifestSchema.safeParse(declared.manifest).success, true, 'declarado sí valida');
  assert.equal(validateNotebookContracts(declared).ok, true, 'y no rompe relaciones');
});

test('LicenseRef en un recurso debe estar declarado en el manifiesto', () => {
  const docs = electronicsDocs();
  const resource = docs.resources.resources[1];
  assert.ok(resource);
  resource.license = 'LicenseRef-Extra-Text';
  const undeclared = validateNotebookContracts(docs);
  assert.equal(undeclared.ok, false);
  assert.ok(codes(undeclared.issues).includes('LICENSE_REF_UNDECLARED'), codes(undeclared.issues).join(','));
  const issue = undeclared.issues.find((candidate) => candidate.code === 'LICENSE_REF_UNDECLARED');
  assert.equal(issue?.document, 'resources');
  assert.match(issue?.path ?? '', /^resources\[1\]\.license$/);

  docs.manifest.metadata.license_files = { 'LicenseRef-Extra-Text': 'licenses/extra.txt' };
  assert.equal(validateNotebookContracts(docs).ok, true, 'declarado en license_files lo resuelve');
});

test('SPDX conocido no necesita license_files', () => {
  const docs = electronicsDocs();
  const resource = docs.resources.resources[0];
  assert.ok(resource);
  resource.license = 'MIT';
  assert.equal(validateNotebookContracts(docs).ok, true);
});

test('LicenseRef declares a portable text file, never an image or other media', () => {
  for (const extension of ['txt', 'TXT', 'tXt', 'png', 'yaml', 'svg', 'txt.png', '']) {
    const docs = referenceDocs();
    docs.manifest.metadata.license = 'LicenseRef-Policy';
    docs.manifest.metadata.license_files = { 'LicenseRef-Policy': `licenses/policy.${extension}` };
    const expected = ['txt', 'TXT', 'tXt'].includes(extension);
    assert.equal(notebookManifestSchema.safeParse(docs.manifest).success, expected, extension);
    const result = validateNotebookContracts(docs);
    assert.equal(result.ok, expected, extension);
    if (!expected) assert.ok(result.issues.length > 0);
  }
});

/* ------------------------------------------------------------------ *
 * Forma de los diagnósticos
 * ------------------------------------------------------------------ */

test('documentos que ni siquiera cumplen su esquema se reportan como SCHEMA_INVALID', () => {
  const docs = electronicsDocs();
  (docs.manifest as unknown as Record<string, unknown>)['surprise'] = true;
  const result = validateNotebookContracts(docs);
  assert.ok(codes(result.issues).includes('SCHEMA_INVALID'));
  assert.equal(result.ok, false);
});

test('los diagnósticos cumplen el esquema ContractIssue', () => {
  const docs = electronicsDocs();
  docs.manifest.content.entrypoint_resource_id = 'ghost';
  const result = validateNotebookContracts(docs);
  assert.ok(result.issues.length > 0);
  for (const issue of result.issues) {
    assert.ok(issue.message.length > 0);
    assert.ok(issue.path.length > 0);
    assert.ok(['manifest', 'resources', 'curriculum', 'assets', 'itemBank'].includes(issue.document));
  }
});

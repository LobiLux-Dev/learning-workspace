/**
 * Validación de relaciones entre los documentos de un Notebook (spec §4, §7.1).
 *
 * Cada documento se valida primero con su esquema estricto; después se comprueban
 * las relaciones que ningún esquema individual puede ver: entrypoint, capabilities
 * contra los bancos de ítems declarados **por path**, referencias de
 * recursos/skills, unicidad global de paths (incluida la colisión por case-fold
 * Unicode), declaraciones `LicenseRef` y unicidad global de `definition_id`.
 *
 * Invariante estructural (CF03): **ningún fallo de esquema puede convertirse en
 * éxito**. El conversor solo omite un diagnóstico de esquema cuando la pasada de
 * paths ya reportó exactamente esa ubicación (`document` + `path` normalizado
 * con notación `a[0].b`); todo lo demás se emite, de modo que `ok: true`
 * implica `issues` vacío *y* `safeParse` de cada documento exitoso.
 *
 * Devuelve diagnósticos en lugar de lanzar: Core los convierte en error estructurado.
 */
import { type ZodType, type output } from 'zod';
import { itemCatalogSchema } from './academic.js';
import { contractIssueSchema, type ContractIssue } from './errors.js';
import {
  assetsManifestSchema,
  curriculumSchema,
  notebookManifestSchema,
  resourceCatalogSchema,
} from './notebook.js';
import { caseFoldPath, portablePathSchema } from './paths.js';
import { isLicenseRef } from './spdx.js';

/** Campos que contienen paths de archivo dentro de un paquete. */
const PATH_FIELDS = new Set([
  'path',
  'relative_path',
  'resources_manifest',
  'assets_manifest',
  'curriculum_path',
  'diagnostic_items_path',
  'assessment_items_path',
]);

export type NotebookContractsInput = {
  /** Manifiesto del Notebook (§4), ya parseado como datos. */
  manifest: unknown;
  /** Catálogo de recursos (`resources/index.yaml`, §4.1). */
  resources: unknown;
  /** Currículo (`curriculum/index.yaml`, §4.1), si capabilities.curriculum es true. */
  curriculum?: unknown;
  /** Manifest de assets (`assets/manifest.yaml`, §4.2), si content.assets_manifest existe. */
  assets?: unknown;
  /**
   * Bancos de ítems **asociados a su path declarado** (§4.1): mapa
   * `{ 'items/diagnostic.yaml': <catálogo parseado>, ... }`. Una colección
   * anónima no satisface una capacidad declarada ni oculta un banco ausente.
   */
  itemBanks?: Readonly<Record<string, unknown>>;
};

export type NotebookContractsResult = {
  ok: boolean;
  issues: ContractIssue[];
};

type ZodIssueLike = { path: PropertyKey[]; message: string };

/** `['resources', 0, 'path']` → `resources[0].path` (misma notación que la pasada de paths). */
function formatIssuePath(parts: readonly PropertyKey[]): string {
  let formatted = '';
  for (const part of parts) {
    if (typeof part === 'number') {
      formatted += `[${part}]`;
    } else if (formatted === '') {
      formatted = String(part);
    } else {
      formatted += `.${String(part)}`;
    }
  }
  return formatted;
}

type PathCandidate = { document: ContractIssue['document']; path: string; value: string };

function convertZodIssues(
  errors: ReadonlyArray<ZodIssueLike>,
  document: ContractIssue['document'],
  pathIssues: readonly PathCandidate[],
  pathPrefix: string,
): ContractIssue[] {
  const issues: ContractIssue[] = [];
  for (const zodIssue of errors) {
    const rawPath = formatIssuePath(zodIssue.path);
    const path = pathPrefix === '' ? rawPath : rawPath === '' ? pathPrefix : `${pathPrefix}.${rawPath}`;
    const field = rawPath.split('.').pop()?.replace(/\[\d+\]$/, '') ?? '';
    // ¿La pasada de paths ya reportó esta misma ubicación? Entonces el
    // diagnóstico más específico (portabilidad, duplicado, colisión) ya existe.
    const covered = pathIssues.some((candidate) => candidate.document === document && candidate.path === path);
    if (covered) continue;
    issues.push({
      // Un fallo de valor sobre un path es un problema de portabilidad; el
      // resto (incluidos invalid_type de 42/null/ausente) es un fallo de esquema.
      code: PATH_FIELDS.has(field) ? 'PATH_NOT_PORTABLE' : 'SCHEMA_INVALID',
      message: zodIssue.message,
      path: path === '' ? document : path,
      document,
    });
  }
  return issues;
}

function parseDocument<S extends ZodType>(
  value: unknown,
  schema: S,
  document: ContractIssue['document'],
  issues: ContractIssue[],
  pathIssues: readonly PathCandidate[],
  pathPrefix = '',
): output<S> | undefined {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const converted = convertZodIssues(result.error.issues, document, pathIssues, pathPrefix);
  if (converted.length === 0) {
    // Red de seguridad (CF03): si por la razón que sea no se emitiera nada,
    // el fallo de esquema sigue siendo un fallo visible, nunca un éxito.
    const first = result.error.issues[0];
    issues.push({
      code: 'SCHEMA_INVALID',
      message: first?.message ?? 'schema validation failed',
      path: first === undefined ? document : formatIssuePath(first.path) || document,
      document,
    });
    return undefined;
  }
  issues.push(...converted);
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function pushPath(candidates: PathCandidate[], document: ContractIssue['document'], location: string, rawValue: unknown): void {
  if (typeof rawValue === 'string') candidates.push({ document, path: location, value: rawValue });
}

/**
 * Valida un conjunto de documentos de Notebook y sus relaciones.
 *
 * `ok` es true solo cuando todos los documentos pasan su esquema y todas las
 * relaciones se cumplen. Un Notebook sin currículo es válido (lectura y
 * materialización), pero entonces no puede atribuirse diagnóstico ni mastery:
 * eso lo decide Core con `CAPABILITY_UNAVAILABLE`.
 */
export function validateNotebookContracts(input: NotebookContractsInput): NotebookContractsResult {
  const issues: ContractIssue[] = [];

  /* ---------------- Pasada de paths (siempre, sobre datos crudos) ----------------
   *
   * Se ejecuta antes que la validación de esquemas para que cada fallo de path
   * tenga un diagnóstico exacto y la conversión de esquema pueda deduplicar sin
   * perder información (CF03).
   */

  const pathCandidates: PathCandidate[] = [];
  const rawManifest = asRecord(input.manifest);
  const rawContent = asRecord(rawManifest?.['content']);
  const rawCapabilities = asRecord(rawManifest?.['capabilities']);
  const rawMetadata = asRecord(rawManifest?.['metadata']);
  if (rawContent !== undefined) {
    pushPath(pathCandidates, 'manifest', 'content.resources_manifest', rawContent['resources_manifest']);
    pushPath(pathCandidates, 'manifest', 'content.assets_manifest', rawContent['assets_manifest']);
    pushPath(pathCandidates, 'manifest', 'content.curriculum_path', rawContent['curriculum_path']);
  }
  if (rawCapabilities !== undefined) {
    pushPath(pathCandidates, 'manifest', 'capabilities.diagnostic_items_path', rawCapabilities['diagnostic_items_path']);
    pushPath(pathCandidates, 'manifest', 'capabilities.assessment_items_path', rawCapabilities['assessment_items_path']);
  }
  if (rawMetadata !== undefined) {
    const licenseFiles = asRecord(rawMetadata['license_files']);
    for (const [licenseRef, licensePath] of Object.entries(licenseFiles ?? {})) {
      pushPath(pathCandidates, 'manifest', `metadata.license_files[${licenseRef}]`, licensePath);
    }
  }
  const rawResources = asRecord(input.resources)?.['resources'];
  if (Array.isArray(rawResources)) {
    rawResources.forEach((entry, index) => {
      pushPath(pathCandidates, 'resources', `resources[${index}].path`, asRecord(entry)?.['path']);
    });
  }
  const rawAssets = asRecord(input.assets)?.['assets'];
  if (Array.isArray(rawAssets)) {
    rawAssets.forEach((entry, index) => {
      pushPath(pathCandidates, 'assets', `assets[${index}].path`, asRecord(entry)?.['path']);
    });
  }

  const byExact = new Map<string, string>();
  const byFolded = new Map<string, string>();
  for (const candidate of pathCandidates) {
    const portable = portablePathSchema.safeParse(candidate.value);
    if (!portable.success) {
      issues.push({
        code: 'PATH_NOT_PORTABLE',
        message: portable.error.issues[0]?.message ?? 'path is not portable',
        path: candidate.path,
        document: candidate.document,
      });
      continue;
    }
    const previousExact = byExact.get(candidate.value);
    if (previousExact !== undefined) {
      issues.push({
        code: 'DUPLICATE_PATH',
        message: `path "${candidate.value}" is already declared at ${previousExact}`,
        path: candidate.path,
        document: candidate.document,
      });
      continue;
    }
    byExact.set(candidate.value, candidate.path);
    const folded = caseFoldPath(candidate.value);
    const previousFolded = byFolded.get(folded);
    if (previousFolded !== undefined) {
      issues.push({
        code: 'PATH_COLLISION',
        message: `path "${candidate.value}" collides with ${previousFolded} after Unicode case folding`,
        path: candidate.path,
        document: candidate.document,
      });
    } else {
      byFolded.set(folded, candidate.path);
    }
  }

  const pathIssues: readonly PathCandidate[] = pathCandidates.filter((candidate) =>
    issues.some((issue) => issue.document === candidate.document && issue.path === candidate.path),
  );

  /* ---------------- Validación de esquemas ---------------- */

  const manifest = parseDocument(input.manifest, notebookManifestSchema, 'manifest', issues, pathIssues);
  const resources = parseDocument(input.resources, resourceCatalogSchema, 'resources', issues, pathIssues);

  const capabilities = manifest?.capabilities;
  const wantsCurriculum = capabilities?.curriculum === true;

  if (input.curriculum === undefined && wantsCurriculum) {
    issues.push({
      code: 'MISSING_CURRICULUM',
      message: 'capabilities.curriculum is true but no curriculum document was provided',
      path: 'content.curriculum_path',
      document: 'manifest',
    });
  }
  if (input.curriculum !== undefined && capabilities !== undefined && !wantsCurriculum) {
    issues.push({
      code: 'UNDECLARED_CURRICULUM',
      message: 'a curriculum document was provided but capabilities.curriculum is false',
      path: 'capabilities.curriculum',
      document: 'manifest',
    });
  }

  const curriculum =
    input.curriculum === undefined
      ? undefined
      : parseDocument(input.curriculum, curriculumSchema, 'curriculum', issues, pathIssues);

  const declaresAssets = manifest?.content.assets_manifest !== undefined;
  if (input.assets === undefined && declaresAssets) {
    issues.push({
      code: 'MISSING_ASSETS',
      message: 'content.assets_manifest is declared but no assets manifest was provided',
      path: 'content.assets_manifest',
      document: 'manifest',
    });
  }
  if (input.assets !== undefined && capabilities !== undefined && !declaresAssets) {
    issues.push({
      code: 'UNDECLARED_ASSETS',
      message: 'an assets manifest was provided but content.assets_manifest is absent',
      path: 'content.assets_manifest',
      document: 'manifest',
    });
  }
  if (input.assets !== undefined) {
    // Solo se valida: sus paths participan en la pasada de unicidad de arriba.
    parseDocument(input.assets, assetsManifestSchema, 'assets', issues, pathIssues);
  }

  /* ---------------- Bancos de ítems por path declarado (§4.1) ---------------- */

  const bankEntries: Array<[string, unknown]> = [];
  if (input.itemBanks !== undefined) {
    const banksRecord = asRecord(input.itemBanks);
    if (banksRecord === undefined || Array.isArray(input.itemBanks)) {
      issues.push({
        code: 'INVALID_BANKS_MAP',
        message: 'itemBanks must be a map of declared capability path to catalog document',
        path: 'itemBanks',
        document: 'itemBank',
      });
    } else {
      for (const key of Object.keys(banksRecord).sort()) {
        bankEntries.push([key, banksRecord[key]]);
      }
    }
  }
  const bankKeys = new Set(bankEntries.map(([key]) => key));

  const declaredBankPaths: Array<{ field: string; value: unknown }> = [
    { field: 'capabilities.diagnostic_items_path', value: rawCapabilities?.['diagnostic_items_path'] },
    { field: 'capabilities.assessment_items_path', value: rawCapabilities?.['assessment_items_path'] },
  ];
  const declaredStrings = new Set<string>();
  for (const declared of declaredBankPaths) {
    const enabled = declared.field.includes('diagnostic')
      ? rawCapabilities?.['diagnostics'] === true
      : rawCapabilities?.['assessments'] === true;
    if (!enabled) continue;
    if (typeof declared.value === 'string') declaredStrings.add(declared.value);
    if (typeof declared.value !== 'string' || !bankKeys.has(declared.value)) {
      issues.push({
        code: 'MISSING_ITEM_BANK',
        message: `declared bank path ${declared.field} has no catalog in itemBanks`,
        path: declared.field,
        document: 'manifest',
      });
    }
  }
  for (const [key] of bankEntries) {
    if (!declaredStrings.has(key)) {
      issues.push({
        code: 'UNDECLARED_ITEM_BANK',
        message: `item bank "${key}" is not declared by any capability path`,
        path: `itemBanks[${key}]`,
        document: 'itemBank',
      });
    }
  }

  const catalogs: Array<{ key: string; catalog: output<typeof itemCatalogSchema> }> = [];
  for (const [key, value] of bankEntries) {
    const parsed = parseDocument(value, itemCatalogSchema, 'itemBank', issues, pathIssues, `itemBanks[${key}]`);
    if (parsed !== undefined) catalogs.push({ key, catalog: parsed });
  }

  /* ---------------- Relaciones entre documentos ---------------- */

  if (manifest !== undefined && resources !== undefined) {
    const resourceIds = new Set(resources.resources.map((resource) => resource.id));
    if (!resourceIds.has(manifest.content.entrypoint_resource_id)) {
      issues.push({
        code: 'ENTRYPOINT_MISSING',
        message: `entrypoint_resource_id "${manifest.content.entrypoint_resource_id}" is not in the resource catalog`,
        path: 'content.entrypoint_resource_id',
        document: 'manifest',
      });
    }
  }

  if (curriculum !== undefined && resources !== undefined) {
    const resourceIds = new Set(resources.resources.map((resource) => resource.id));
    curriculum.modules.forEach((module, index) => {
      module.resource_ids.forEach((resourceId, resourceIndex) => {
        if (!resourceIds.has(resourceId)) {
          issues.push({
            code: 'UNKNOWN_RESOURCE_REF',
            message: `module "${module.id}" references unknown resource "${resourceId}"`,
            path: `modules[${index}].resource_ids[${resourceIndex}]`,
            document: 'curriculum',
          });
        }
      });
    });
  }

  if (resources !== undefined || catalogs.length > 0) {
    const resourceIds =
      resources === undefined ? undefined : new Set(resources.resources.map((resource) => resource.id));
    const skillIds = curriculum === undefined ? undefined : new Set(curriculum.skills.map((skill) => skill.id));

    // definition_id único entre TODOS los catálogos declarados: PrepareItem
    // acepta un id suelto y no puede ser ambiguo.
    const definitionOwner = new Map<string, string>();
    for (const { key, catalog } of catalogs) {
      catalog.items.forEach((item, itemIndex) => {
        const previous = definitionOwner.get(item.definition_id);
        if (previous !== undefined) {
          issues.push({
            code: 'DUPLICATE_ID',
            message: `definition_id "${item.definition_id}" is declared by both ${previous} and ${key}`,
            path: `itemBanks[${key}].items[${itemIndex}].definition_id`,
            document: 'itemBank',
          });
        } else {
          definitionOwner.set(item.definition_id, key);
        }

        if (resourceIds !== undefined) {
          item.source_refs.forEach((ref, refIndex) => {
            if (!resourceIds.has(ref.resource_id)) {
              issues.push({
                code: 'UNKNOWN_RESOURCE_REF',
                message: `item "${item.definition_id}" references unknown resource "${ref.resource_id}"`,
                path: `itemBanks[${key}].items[${itemIndex}].source_refs[${refIndex}].resource_id`,
                document: 'itemBank',
              });
            }
          });
        }
        if (skillIds !== undefined) {
          item.skill_ids.forEach((skillId, skillIndex) => {
            if (!skillIds.has(skillId)) {
              issues.push({
                code: 'UNKNOWN_SKILL_REF',
                message: `item "${item.definition_id}" references unknown skill "${skillId}"`,
                path: `itemBanks[${key}].items[${itemIndex}].skill_ids[${skillIndex}]`,
                document: 'itemBank',
              });
            }
          });
        }
      });
    }
  }

  /* ---------------- LicenseRef declarados (§4.1, CF02) ---------------- */

  const declaredLicenseRefs = new Set<string>(Object.keys(asRecord(rawMetadata?.['license_files']) ?? {}));
  const checkLicenseRef = (value: unknown, document: ContractIssue['document'], location: string): void => {
    if (typeof value === 'string' && isLicenseRef(value) && !declaredLicenseRefs.has(value)) {
      issues.push({
        code: 'LICENSE_REF_UNDECLARED',
        message: `${value} is used but has no entry in metadata.license_files`,
        path: location,
        document,
      });
    }
  };
  checkLicenseRef(rawMetadata?.['license'], 'manifest', 'metadata.license');
  if (Array.isArray(rawResources)) {
    rawResources.forEach((entry, index) => {
      checkLicenseRef(asRecord(entry)?.['license'], 'resources', `resources[${index}].license`);
    });
  }
  if (Array.isArray(rawAssets)) {
    rawAssets.forEach((entry, index) => {
      checkLicenseRef(asRecord(entry)?.['license'], 'assets', `assets[${index}].license`);
    });
  }

  return { ok: issues.length === 0, issues };
}

/** Los diagnósticos devueltos cumplen el esquema `ContractIssue`. */
export function isContractIssue(value: unknown): boolean {
  return contractIssueSchema.safeParse(value).success;
}

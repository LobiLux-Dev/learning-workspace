/**
 * Contratos de Notebook: manifiesto, catálogo de recursos, assets y currículo (spec §4).
 *
 * Toda validación cruzada que solo puede hacerse dentro de un documento (claves duplicadas,
 * cobertura de referencias internas, DAG de prerrequisitos, reglas de capabilities) vive en
 * `superRefine` y queda anotada con `x-runtime-validation` porque JSON Schema no la expresa.
 * Las relaciones entre documentos (entrypoint, assets declarados, IDs de recursos) se validan
 * con `validateNotebookContracts`.
 */
import { z } from 'zod';
import {
  MAX_DESCRIPTION_CHARS,
  MAX_LIST_ITEMS,
} from './constants.js';
import { assetOriginSchema } from './enums.js';
import {
  descriptionTextSchema,
  extensionsSchema,
  licenseRefSchema,
  licenseSchema,
  nameTextSchema,
  packageIdSchema,
  resourceIdSchema,
  schemaVersionSchema,
  semverSchema,
  sha256Schema,
  tagListSchema,
  titleTextSchema,
  uuidV7Schema,
} from './primitives.js';
import { bcp47Schema } from './bcp47.js';
import { portablePathSchema } from './paths.js';
import { isLicenseRef } from './spdx.js';

/* ------------------------------------------------------------------ *
 * Media types del allowlist v0.1 (§4.2)
 * ------------------------------------------------------------------ */

/** Recursos catalogados: texto UTF-8. No se admiten HTML, PDF, SVG, audio ni ejecutables. */
export const resourceMediaTypeSchema = z.enum(['text/markdown', 'text/plain', 'text/yaml', 'application/yaml']);
export type ResourceMediaType = z.output<typeof resourceMediaTypeSchema>;

/** Assets estáticos: PNG, JPEG y WebP (firma y decodificación se comprueban al instalar). */
export const assetMediaTypeSchema = z.enum(['image/png', 'image/jpeg', 'image/webp']);
export type AssetMediaType = z.output<typeof assetMediaTypeSchema>;

/* ------------------------------------------------------------------ *
 * Manifiesto del Notebook (§4)
 * ------------------------------------------------------------------ */

const notebookIdentitySchema = z
  .object({
    package_uid: uuidV7Schema,
    package_id: packageIdSchema,
    name: nameTextSchema,
  })
  .strict();

const notebookReleaseSchema = z.object({ version: semverSchema }).strict();

const licenseTextPathSchema = portablePathSchema.regex(/\.[tT][xX][tT]$/, 'license text must use the .txt extension');

const notebookMetadataSchema = z
  .object({
    description: descriptionTextSchema.optional(),
    authors: z
      .array(z.object({ name: nameTextSchema, email: z.string().max(320).optional() }).strict())
      .max(64)
      .optional(),
    license: licenseSchema,
    /** §4.1/CF02: `LicenseRef-*` → ruta portable del texto de licencia incluido. */
    license_files: z.record(licenseRefSchema, licenseTextPathSchema).optional(),
    tags: tagListSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (isLicenseRef(value.license)) {
      const declared = value.license_files;
      if (declared === undefined || !Object.hasOwn(declared, value.license)) {
        ctx.addIssue({
          code: 'custom',
          path: ['license_files'],
          message: `metadata.license must declare its text in license_files (${value.license})`,
        });
      }
    }
  })
  .meta({
    'x-runtime-validation':
      'Zod exige que toda LicenseRef usada en metadata.license tenga su entrada en license_files con path portable .txt; las LicenseRef de recursos/assets se cruzan en validateNotebookContracts. Existencia y bytes del texto los comprueba F2 contra el snapshot (§4.1).',
  });

const notebookContentSchema = z
  .object({
    entrypoint_resource_id: resourceIdSchema,
    resources_manifest: portablePathSchema,
    assets_manifest: portablePathSchema.optional(),
    curriculum_path: portablePathSchema.optional(),
  })
  .strict();

const notebookCapabilitiesSchema = z
  .object({
    curriculum: z.boolean(),
    diagnostics: z.boolean(),
    assessments: z.boolean(),
    diagnostic_items_path: portablePathSchema.optional(),
    assessment_items_path: portablePathSchema.optional(),
  })
  .strict();

/**
 * `NotebookManifest`: contrato ejecutable del snapshot publicado.
 *
 * Reglas expresadas aquí (no en JSON Schema):
 * - `curriculum_path` existe exactamente cuando `capabilities.curriculum` es true.
 * - `diagnostic_items_path`/`assessment_items_path` existen exactamente cuando su capability
 *   es true (si la capability es false el Notebook no atribuye ese banco).
 * - Los tres paths de manifiesto declarados deben ser distintos entre sí.
 */
export const notebookManifestSchema = z
  .object({
    schema_version: schemaVersionSchema,
     identity: notebookIdentitySchema,
    release: notebookReleaseSchema,
    metadata: notebookMetadataSchema,
    content: notebookContentSchema,
    capabilities: notebookCapabilitiesSchema,
    extensions: extensionsSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    const { content, capabilities } = value;
    if (capabilities.curriculum && content.curriculum_path === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['content', 'curriculum_path'],
        message: 'curriculum_path is required when capabilities.curriculum is true',
      });
    }
    if (!capabilities.curriculum && content.curriculum_path !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['content', 'curriculum_path'],
        message: 'curriculum_path must be absent when capabilities.curriculum is false',
      });
    }
    if (capabilities.diagnostics && capabilities.diagnostic_items_path === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['capabilities', 'diagnostic_items_path'],
        message: 'diagnostic_items_path is required when capabilities.diagnostics is true',
      });
    }
    if (!capabilities.diagnostics && capabilities.diagnostic_items_path !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['capabilities', 'diagnostic_items_path'],
        message: 'diagnostic_items_path must be absent when capabilities.diagnostics is false',
      });
    }
    if (capabilities.assessments && capabilities.assessment_items_path === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['capabilities', 'assessment_items_path'],
        message: 'assessment_items_path is required when capabilities.assessments is true',
      });
    }
    if (!capabilities.assessments && capabilities.assessment_items_path !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['capabilities', 'assessment_items_path'],
        message: 'assessment_items_path must be absent when capabilities.assessments is false',
      });
    }

    const declared: Array<[string, string]> = [['content.resources_manifest', content.resources_manifest]];
    if (content.assets_manifest !== undefined) declared.push(['content.assets_manifest', content.assets_manifest]);
    if (content.curriculum_path !== undefined) declared.push(['content.curriculum_path', content.curriculum_path]);
    const seen = new Map<string, string>();
    for (const [field, path] of declared) {
      const previous = seen.get(path);
      if (previous !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: field.split('.'),
          message: `manifest path collides with ${previous}: ${path}`,
        });
      } else {
        seen.set(path, field);
      }
    }
  })
  .meta({
    'x-runtime-validation':
      'Zod superRefine enforces: curriculum_path ⇔ capabilities.curriculum, item-bank paths ⇔ diagnostics/assessments, and distinct manifest paths. JSON Schema cannot express these cross-field rules.',
  });

export type NotebookManifest = z.output<typeof notebookManifestSchema>;

/* ------------------------------------------------------------------ *
 * Catálogo de recursos (§4.1)
 * ------------------------------------------------------------------ */

export const resourceEntrySchema = z
  .object({
    id: resourceIdSchema,
    path: portablePathSchema,
    media_type: resourceMediaTypeSchema,
    title: titleTextSchema,
    language: bcp47Schema.optional(),
    license: licenseSchema.optional(),
    attribution: z.string().max(MAX_DESCRIPTION_CHARS).optional(),
    extensions: extensionsSchema.optional(),
  })
  .strict();

export type ResourceEntry = z.output<typeof resourceEntrySchema>;

export const resourceCatalogSchema = z
  .object({
    schema_version: schemaVersionSchema,
     resources: z.array(resourceEntrySchema).min(1).max(MAX_LIST_ITEMS),
    extensions: extensionsSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    const ids = new Set<string>();
    const paths = new Set<string>();
    value.resources.forEach((resource, index) => {
      if (ids.has(resource.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['resources', index, 'id'],
          message: `duplicate resource id: ${resource.id}`,
        });
      }
      ids.add(resource.id);
      if (paths.has(resource.path)) {
        ctx.addIssue({
          code: 'custom',
          path: ['resources', index, 'path'],
          message: `duplicate resource path: ${resource.path}`,
        });
      }
      paths.add(resource.path);
    });
  })
  .meta({
    'x-runtime-validation':
      'Zod superRefine enforces unique resource ids and unique resource paths; JSON Schema uniqueItems cannot compare by a property.',
  });

export type ResourceCatalog = z.output<typeof resourceCatalogSchema>;

/* ------------------------------------------------------------------ *
 * Assets (§4.2)
 * ------------------------------------------------------------------ */

export const assetEntrySchema = z
  .object({
    id: resourceIdSchema,
    path: portablePathSchema,
    media_type: assetMediaTypeSchema,
    origin: assetOriginSchema,
    license: licenseSchema.optional(),
    attribution: z.string().max(MAX_DESCRIPTION_CHARS).optional(),
    sha256: sha256Schema,
    extensions: extensionsSchema.optional(),
  })
  .strict();

export type AssetEntry = z.output<typeof assetEntrySchema>;

export const assetsManifestSchema = z
  .object({
    schema_version: schemaVersionSchema,
     assets: z.array(assetEntrySchema).min(1).max(MAX_LIST_ITEMS),
    extensions: extensionsSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    const ids = new Set<string>();
    const paths = new Set<string>();
    value.assets.forEach((asset, index) => {
      if (ids.has(asset.id)) {
        ctx.addIssue({ code: 'custom', path: ['assets', index, 'id'], message: `duplicate asset id: ${asset.id}` });
      }
      ids.add(asset.id);
      if (paths.has(asset.path)) {
        ctx.addIssue({ code: 'custom', path: ['assets', index, 'path'], message: `duplicate asset path: ${asset.path}` });
      }
      paths.add(asset.path);
    });
  })
  .meta({
    'x-runtime-validation':
      'Zod superRefine enforces unique asset ids and unique asset paths; JSON Schema uniqueItems cannot compare by a property.',
  });

export type AssetsManifest = z.output<typeof assetsManifestSchema>;

/* ------------------------------------------------------------------ *
 * Currículo (§4.1)
 * ------------------------------------------------------------------ */

export const moduleEntrySchema = z
  .object({
    id: resourceIdSchema,
    title: titleTextSchema,
    resource_ids: z.array(resourceIdSchema).min(1).max(MAX_LIST_ITEMS),
    skill_ids: z.array(resourceIdSchema).max(MAX_LIST_ITEMS),
    extensions: extensionsSchema.optional(),
  })
  .strict();

export type ModuleEntry = z.output<typeof moduleEntrySchema>;

export const skillEntrySchema = z
  .object({
    id: resourceIdSchema,
    description: z.string().min(1).max(MAX_DESCRIPTION_CHARS),
    prerequisites: z.array(resourceIdSchema).max(MAX_LIST_ITEMS),
    extensions: extensionsSchema.optional(),
  })
  .strict();

export type SkillEntry = z.output<typeof skillEntrySchema>;

/**
 * Encuentra un ciclo de prerrequisitos (incluye autorreferencias) o devuelve `null`.
 *
 * Iterativa (DFS con colores y pila explícita): un catálogo grande con una cadena
 * larga no puede agotar el stack. Devuelve el camino cerrado `a -> ... -> a`
 * (primer y último elemento iguales) recorriendo las habilidades en orden
 * declarado, determinista.
 */
export function findPrerequisiteCycle(
  skills: ReadonlyArray<{ id: string; prerequisites: readonly string[] }>,
): string[] | null {
  const graph = new Map<string, readonly string[]>();
  for (const skill of skills) graph.set(skill.id, skill.prerequisites);

  const visiting = new Set<string>();
  const done = new Set<string>();

  for (const start of graph.keys()) {
    if (done.has(start) || visiting.has(start)) continue;
    const path: string[] = [start];
    const frameIndexes: number[] = [0];
    visiting.add(start);

    while (path.length > 0) {
      const current = path[path.length - 1] as string;
      const nextIndex = frameIndexes[frameIndexes.length - 1] as number;
      const prerequisites = graph.get(current) ?? [];

      if (nextIndex >= prerequisites.length) {
        path.pop();
        frameIndexes.pop();
        visiting.delete(current);
        done.add(current);
        continue;
      }

      frameIndexes[frameIndexes.length - 1] = nextIndex + 1;
      const next = prerequisites[nextIndex] as string;
      // Una referencia a un ID inexistente no forma ciclo: la reporta el validador de catálogo.
      if (!graph.has(next)) continue;
      if (done.has(next)) continue;
      if (visiting.has(next)) {
        const from = path.indexOf(next);
        return [...path.slice(from === -1 ? 0 : from), next];
      }
      visiting.add(next);
      path.push(next);
      frameIndexes.push(0);
    }
  }

  return null;
}

export const curriculumSchema = z
  .object({
    schema_version: schemaVersionSchema,
     modules: z.array(moduleEntrySchema).min(1).max(MAX_LIST_ITEMS),
    skills: z.array(skillEntrySchema).min(1).max(MAX_LIST_ITEMS),
    extensions: extensionsSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    const moduleIds = new Set<string>();
    value.modules.forEach((module, index) => {
      if (moduleIds.has(module.id)) {
        ctx.addIssue({ code: 'custom', path: ['modules', index, 'id'], message: `duplicate module id: ${module.id}` });
      }
      moduleIds.add(module.id);

      const seenResources = new Set<string>();
      module.resource_ids.forEach((resourceId, resourceIndex) => {
        if (seenResources.has(resourceId)) {
          ctx.addIssue({
            code: 'custom',
            path: ['modules', index, 'resource_ids', resourceIndex],
            message: `duplicate resource id in module: ${resourceId}`,
          });
        }
        seenResources.add(resourceId);
      });
      const seenSkills = new Set<string>();
      module.skill_ids.forEach((skillId, skillIndex) => {
        if (seenSkills.has(skillId)) {
          ctx.addIssue({
            code: 'custom',
            path: ['modules', index, 'skill_ids', skillIndex],
            message: `duplicate skill id in module: ${skillId}`,
          });
        }
        seenSkills.add(skillId);
      });
    });

    const skillIds = new Set<string>();
    value.skills.forEach((skill, index) => {
      if (skillIds.has(skill.id)) {
        ctx.addIssue({ code: 'custom', path: ['skills', index, 'id'], message: `duplicate skill id: ${skill.id}` });
      }
      skillIds.add(skill.id);
    });

    value.skills.forEach((skill, index) => {
      skill.prerequisites.forEach((prerequisite, prereqIndex) => {
        if (prerequisite === skill.id) {
          ctx.addIssue({
            code: 'custom',
            path: ['skills', index, 'prerequisites', prereqIndex],
            message: `skill cannot be its own prerequisite: ${skill.id}`,
          });
          return;
        }
        if (!skillIds.has(prerequisite)) {
          ctx.addIssue({
            code: 'custom',
            path: ['skills', index, 'prerequisites', prereqIndex],
            message: `unknown prerequisite skill: ${prerequisite}`,
          });
        }
      });
    });

    if (skillIds.size === value.skills.length) {
      const cycle = findPrerequisiteCycle(value.skills);
      if (cycle !== null) {
        ctx.addIssue({
          code: 'custom',
          path: ['skills'],
          message: `prerequisite cycle: ${cycle.join(' -> ')}`,
        });
      }
    }

    value.modules.forEach((module, index) => {
      module.skill_ids.forEach((skillId, skillIndex) => {
        if (!skillIds.has(skillId)) {
          ctx.addIssue({
            code: 'custom',
            path: ['modules', index, 'skill_ids', skillIndex],
            message: `unknown skill id: ${skillId}`,
          });
        }
      });
    });
  })
  .meta({
    'x-runtime-validation':
      'Zod superRefine enforces unique module/skill ids, known prerequisites, no self-references and an acyclic prerequisite DAG. JSON Schema has no cycle detection.',
  });

export type Curriculum = z.output<typeof curriculumSchema>;

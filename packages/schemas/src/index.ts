/**
 * `@learning-workspace/schemas` — contratos ejecutables de Learning Workspace.
 *
 * Este paquete es la única definición ejecutable de los contratos de la especificación v0.1
 * y la fuente de verdad de sus JSON Schema. No persiste, no ejecuta SQL ni calcula mastery:
 * solo valida y transforma datos contractuales.
 *
 * Superficie principal:
 * - `schemaRegistry`: nombre PascalCase -> esquema Zod (entrada del generador de JSON Schema).
 * - `parseYaml(source, schema)`: YAML 1.2 estricto + validación de esquema.
 * - `validateNotebookContracts(input)`: relaciones entre manifiesto, catálogos y bancos.
 * - `toJsonSchema` / `buildJsonSchemaDocuments`: generación draft 2020-12 determinista.
 * - `canonicalJson` / `snapshotContentDigest`: digestos canónicos de §3.2 y §6.2.
 * - `portablePathSchema`, `assertPortablePath`, `assertNoPortablePathCollisions`,
 *   `caseFoldPath`: reglas portables de rutas (definidas en `./paths.js`).
 */

export * from './constants.js';
export * from './primitives.js';
export * from './bcp47.js';
export * from './spdx.js';
export * from './errors.js';
export * from './enums.js';
export * from './canonical.js';
export * from './yaml.js';
export * from './notebook.js';
export * from './rubric.js';
export * from './portfolio.js';
export * from './academic.js';
export * from './events.js';
export * from './commands.js';
export * from './contracts.js';
export * from './views.js';
export * from './json-schema.js';
export * from './registry.js';
export * from './paths.js';

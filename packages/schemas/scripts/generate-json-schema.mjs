#!/usr/bin/env node
/**
 * Genera los JSON Schema (draft 2020-12) de todos los contratos registrados.
 *
 * - Importa `dist/index.js`: los esquemas Zod son la única fuente de verdad.
 * - Escribe `packages/schemas/generated/<Name>.schema.json` (gitignored).
 * - Salida determinista: claves ordenadas, mismo texto en cada ejecución.
 * - Los invariantes que JSON Schema no puede expresar vienen anotados con
 *   `x-runtime-validation`; este script no los representa como si los validara.
 *
 * Uso: `npm run schemas:generate` (raíz) o `node packages/schemas/scripts/generate-json-schema.mjs`.
 */
import { mkdir, readdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDir, '..');
const outputDir = path.join(packageRoot, 'generated');

const { buildJsonSchemaDocuments, stableJsonStringify } = await import(
  new URL('../dist/index.js', import.meta.url).href
);

const documents = buildJsonSchemaDocuments();
const names = Object.keys(documents).sort();

await mkdir(outputDir, { recursive: true });

const expected = new Set(names.map((name) => `${name}.schema.json`));
const existing = await readdir(outputDir).catch(() => []);
for (const entry of existing) {
  if (entry.endsWith('.schema.json') && !expected.has(entry)) {
    await unlink(path.join(outputDir, entry));
  }
}

for (const name of names) {
  const document = documents[name];
  if (document === undefined) continue;
  await writeFile(path.join(outputDir, `${name}.schema.json`), stableJsonStringify(document, true), 'utf8');
}

process.stdout.write(`generated ${names.length} JSON Schemas in ${path.relative(process.cwd(), outputDir) || '.'}\n`);

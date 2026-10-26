/**
 * Utilidades compartidas por la suite de `packages/schemas`.
 * No termina en `.test.ts`, así que el runner no lo trata como prueba.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));

export const repoRoot = path.resolve(testDir, '../../..');
export const fixturesDir = path.join(repoRoot, 'fixtures/contracts');
export const generatedDir = path.join(repoRoot, 'packages/schemas/generated');

export function readFixture(relativePath: string): string {
  return readFileSync(path.join(fixturesDir, relativePath), 'utf8');
}

export function readFixtureJson<T = unknown>(relativePath: string): T {
  return JSON.parse(readFixture(relativePath)) as T;
}

/** Recorre un directorio de fixtures devolviendo rutas relativas con `/`. */
export function listFixtureFiles(relativeDir: string, extension?: string): string[] {
  const base = path.join(fixturesDir, relativeDir);
  const out: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      const full = path.join(dir, entry);
      const rel = prefix === '' ? entry : `${prefix}/${entry}`;
      if (statSync(full).isDirectory()) walk(full, rel);
      else if (extension === undefined || entry.endsWith(extension)) out.push(rel);
    }
  };
  walk(base, '');
  return out;
}

/** UUIDs sintéticos publicados junto a los fixtures (IDs reales, no placeholders). */
export function fixtureIds(): Record<string, string> {
  return (readFixtureJson<{ ids: Record<string, string> }>('vectors/ids.json')).ids;
}

export type Zodish = {
  safeParse(
    value: unknown,
  ):
    | { success: true; data: unknown }
    | { success: false; error: { issues: ReadonlyArray<{ path: PropertyKey[]; message: string }> } };
};

/** Devuelve los mensajes de error de una validación fallida (o un marcador si fue válida). */
export function failureMessage(schema: Zodish, value: unknown): string {
  const result = schema.safeParse(value);
  if (result.success) return '<unexpected success>';
  return result.error.issues
    .map((issue) => `${issue.path.map((part) => String(part)).join('.')}: ${issue.message}`)
    .join(' | ');
}

/** `true` cuando el esquema acepta el valor; para aserciones cortas. */
export function accepts(schema: Zodish, value: unknown): boolean {
  return schema.safeParse(value).success;
}

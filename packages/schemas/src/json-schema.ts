/**
 * Generación de JSON Schema (draft 2020-12) a partir de los esquemas Zod.
 *
 * Zod 4 es la única fuente: no hay DTOs ni especificaciones paralelas. La generación es
 * determinista (claves ordenadas, sin dependencia del orden de registro) y falla ruidosamente
 * si un esquema usa algo no representable.
 *
 * Límite honesto: JSON Schema no puede expresar reglas cruzadas (DAG, cobertura de anchors,
 * unicidad por propiedad, hashes, transiciones). Esas reglas quedan anotadas en el documento
 * con `x-runtime-validation` y siguen validándose solo en Zod.
 */
import { z, type ZodType } from 'zod';
import { schemaRegistry } from './registry.js';
import { portablePathSchema } from './paths.js';

export const JSON_SCHEMA_TARGET = 'draft-2020-12' as const;

export type JsonSchemaDocument = Record<string, unknown>;

/**
 * `portablePathSchema` está refinado en Zod (spec §3.2.3) y es ajeno a este módulo: aquí se
 * anota en el JSON Schema generado para que nadie crea que `type: string` basta.
 */
const PORTABLE_PATH_ANNOTATION =
  'Las reglas portables (§3.2.3) las aplica Zod con refine: UTF-8 NFC, ≤240 bytes, sin caracteres de control, ":", "\\\\" ni "%", sin segmentos vacíos/./.., sin punto ni espacio final y sin nombres reservados de Windows. Las colisiones por case-fold Unicode se comprueban con assertNoPortablePathCollisions/validateNotebookContracts, no con JSON Schema.';

/** Convierte un esquema Zod a JSON Schema draft 2020-12. Lanza si algo no es representable. */
export function toJsonSchema(schema: ZodType, title?: string): JsonSchemaDocument {
  const generated = z.toJSONSchema(schema, {
    target: JSON_SCHEMA_TARGET,
    io: 'output',
    unrepresentable: 'throw',
    override: ({ zodSchema, jsonSchema }) => {
      if (zodSchema === portablePathSchema) {
        jsonSchema['x-runtime-validation'] = PORTABLE_PATH_ANNOTATION;
      }
    },
  });
  const document = generated as unknown as JsonSchemaDocument;
  if (title !== undefined && document['title'] === undefined) {
    document['title'] = title;
  }
  return document;
}

/** Serialización estable: claves ordenadas, sin dependencia del orden de inserción. */
export function stableJsonStringify(value: unknown, trailingNewline = false): string {
  const text = encode(value);
  return trailingNewline ? `${text}\n` : text;
}

function encode(value: unknown): string {
  if (value === null) return 'null';
  const type = typeof value;
  if (type === 'boolean' || type === 'number') return JSON.stringify(value) ?? 'null';
  if (type === 'string') return JSON.stringify(value);
  if (type !== 'object') return 'null';
  if (Array.isArray(value)) return `[${value.map((item) => encode(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of Object.keys(record).sort()) {
    const item = record[key];
    if (item === undefined) continue;
    parts.push(`${JSON.stringify(key)}:${encode(item)}`);
  }
  return `{${parts.join(',')}}`;
}

/**
 * Documentos JSON Schema de todo el registro, con las claves ordenadas alfabéticamente
 * para que dos ejecuciones produzcan bytes idénticos.
 */
export function buildJsonSchemaDocuments(): Record<string, JsonSchemaDocument> {
  const documents: Record<string, JsonSchemaDocument> = {};
  for (const name of Object.keys(schemaRegistry).sort()) {
    const schema = schemaRegistry[name];
    if (schema === undefined) continue;
    documents[name] = toJsonSchema(schema, name);
  }
  return documents;
}

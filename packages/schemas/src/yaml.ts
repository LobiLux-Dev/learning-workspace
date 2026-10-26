/**
 * Parser YAML 1.2 estricto (spec §4).
 *
 * Reglas aplicadas antes de tocar los esquemas de dominio:
 * - 2 MiB máximo por fuente y sin caracteres de control ni surrogates sin
 *   pareja en la fuente; los escapes que produzcan surrogates inválidos se
 *   rechazan también al recorrer los valores (Unicode inválido, CF04).
 * - YAML **1.2 efectivo**: una directiva `%YAML 1.1` u otra no soportada se
 *   rechaza (una directiva `%TAG` también), porque cambiaría la resolución de
 *   `yes`/`on`/`off` y compañía.
 * - Un único documento (rechaza multidocumento).
 * - Sin aliases (`*ref`) ni merges (`<<`), porque introducen grafo no árbol y
 *   reescritura silenciosa.
 * - Sin tags personalizados ni tags fuera del esquema central de YAML 1.2
 *   (`!!binary`, `!!timestamp`, `!Foo`...).
 * - Claves duplicadas y claves no escalares rechazadas por el parser.
 * - Profundidad acotada (evita agotar el stack con entradas enrarecidas).
 *
 * El parser **no expande ni ejecuta nada**: no interpreta entorno, includes ni
 * comandos. Por eso no se prohíben palabras de contenido (`env`, `include`,
 * `command`...) en los datos: sí se rechazan las claves de defensa de
 * prototipo (`__proto__`, `constructor`, `prototype`) y `<<` (CF04).
 *
 * La validación de dominio se aplica con el esquema Zod que se pase a `parseYaml`.
 */
import { parseAllDocuments, isAlias, isMap, isNode, isScalar, isSeq } from 'yaml';
import type { ZodType, output } from 'zod';
import { MAX_YAML_BYTES, MAX_YAML_DEPTH } from './constants.js';
import type { YamlIssue, YamlIssueCode } from './errors.js';
import { hasLoneSurrogate } from './paths.js';

/** Tags centrales de YAML 1.2 que sí se aceptan cuando aparecen explícitos. */
const ALLOWED_TAGS: ReadonlySet<string> = new Set([
  'tag:yaml.org,2002:str',
  'tag:yaml.org,2002:int',
  'tag:yaml.org,2002:float',
  'tag:yaml.org,2002:bool',
  'tag:yaml.org,2002:null',
  'tag:yaml.org,2002:map',
  'tag:yaml.org,2002:seq',
]);

/** Versión de directiva `%YAML` que sí se acepta (la del contrato es 1.2). */
const SUPPORTED_YAML_VERSION = '1.2';

/**
 * Claves de defensa: prototipo de objeto y el merge `<<` (reescritura
 * silenciosa de nodos). Se rechazan sin resolver ni interpolar; no es una lista
 * de palabras prohibidas: `env`, `include` o `command` son datos inertes
 * válidos en un JSON de `extensions` (CF04).
 */
export const YAML_DANGEROUS_KEYS: ReadonlySet<string> = new Set([
  '<<',
  '__proto__',
  'constructor',
  'prototype',
]);

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const MAX_ISSUES_PER_DOCUMENT = 50;

export type YamlLimits = {
  maxBytes?: number;
  maxDepth?: number;
};

export type YamlSuccess<T> = { ok: true; value: T };
export type YamlFailure = { ok: false; issues: YamlIssue[] };
export type YamlResult<T> = YamlSuccess<T> | YamlFailure;

/** Error lanzado por `parseYaml`; expone todos los diagnósticos. */
export class YamlValidationError extends Error {
  readonly issues: YamlIssue[];

  constructor(issues: YamlIssue[]) {
    super(
      issues
        .map((issue) => `${issue.code}${issue.path ? ` at ${issue.path}` : ''}: ${issue.message}`)
        .join('\n'),
    );
    this.name = 'YamlValidationError';
    this.issues = issues;
  }
}

function issue(code: YamlIssueCode, message: string, path = '', position?: { line: number; column: number }): YamlIssue {
  const base: YamlIssue = { code, message, path };
  if (position !== undefined) {
    return { ...base, line: position.line, column: position.column };
  }
  return base;
}

function positionOf(error: { linePos?: unknown }): { line: number; column: number } | undefined {
  const linePos = error.linePos;
  if (Array.isArray(linePos) && linePos.length > 0) {
    const first = linePos[0] as { line?: number; col?: number } | undefined;
    if (first && typeof first.line === 'number' && typeof first.col === 'number') {
      return { line: first.line, column: first.col };
    }
  }
  return undefined;
}

type StructuralOutcome = { issues: YamlIssue[] };

function walkNode(node: unknown, depth: number, limits: Required<YamlLimits>, outcome: StructuralOutcome): void {
  if (outcome.issues.length >= MAX_ISSUES_PER_DOCUMENT) return;
  if (node === null || node === undefined || typeof node !== 'object') return;
  if (!isNode(node)) return;

  if (isAlias(node)) {
    outcome.issues.push(issue('ALIAS_NOT_ALLOWED', 'aliases are not allowed in contract documents'));
    return;
  }

  const tag = (node as { tag?: unknown }).tag;
  if (typeof tag === 'string' && !ALLOWED_TAGS.has(tag)) {
    outcome.issues.push(issue('TAG_NOT_ALLOWED', `YAML tag is not allowed: ${tag}`));
    // El contenido bajo un tag prohibido no se interpreta; se sigue recorriendo por si hay más problemas.
  }

  if (depth > limits.maxDepth) {
    outcome.issues.push(issue('NESTING_TOO_DEEP', `nesting deeper than ${limits.maxDepth} levels is not allowed`));
    return;
  }

  if (isMap(node)) {
    for (const pair of node.items) {
      const keyNode = pair.key;
      if (!isScalar(keyNode) || typeof keyNode.value !== 'string') {
        outcome.issues.push(issue('NON_SCALAR_KEY', 'mapping keys must be strings'));
      } else if (hasLoneSurrogate(keyNode.value)) {
        outcome.issues.push(issue('VALUE_HAS_LONE_SURROGATE', 'mapping key contains an unpaired surrogate'));
      } else if (YAML_DANGEROUS_KEYS.has(keyNode.value.toLowerCase())) {
        outcome.issues.push(issue('DANGEROUS_KEY', `key "${keyNode.value}" is rejected (prototype/merge safety)`));
      }
      walkNode(pair.value, depth + 1, limits, outcome);
      if (outcome.issues.length >= MAX_ISSUES_PER_DOCUMENT) return;
    }
    return;
  }

  if (isSeq(node)) {
    for (const item of node.items) {
      walkNode(item, depth + 1, limits, outcome);
      if (outcome.issues.length >= MAX_ISSUES_PER_DOCUMENT) return;
    }
    return;
  }

  if (isScalar(node) && typeof node.value === 'string' && hasLoneSurrogate(node.value)) {
    // Cubre escapes como "\ud800" convertidos a texto con surrogate sin pareja.
    outcome.issues.push(issue('VALUE_HAS_LONE_SURROGATE', 'string value contains an unpaired surrogate'));
  }
}

/**
 * Parsea y valida la fuente YAML sin aplicar todavía un esquema de dominio.
 * Lanza `YamlValidationError` si la fuente viola alguna regla del parser estricto.
 */
export function parseYamlDocument(source: string, limits: YamlLimits = {}): unknown {
  const result = safeParseYamlDocument(source, limits);
  if (!result.ok) throw new YamlValidationError(result.issues);
  return result.value;
}

/** Versión no lanzadora de `parseYamlDocument`. */
export function safeParseYamlDocument(source: string, limits: YamlLimits = {}): YamlResult<unknown> {
  const effective: Required<YamlLimits> = {
    maxBytes: limits.maxBytes ?? MAX_YAML_BYTES,
    maxDepth: limits.maxDepth ?? MAX_YAML_DEPTH,
  };
  const issues: YamlIssue[] = [];

  if (Buffer.byteLength(source, 'utf8') > effective.maxBytes) {
    issues.push(issue('SOURCE_TOO_LARGE', `YAML source exceeds ${effective.maxBytes} bytes`));
    return { ok: false, issues };
  }
  if (hasLoneSurrogate(source)) {
    issues.push(issue('SOURCE_HAS_LONE_SURROGATE', 'YAML source contains an unpaired surrogate'));
  }
  if (CONTROL_CHARS.test(source)) {
    issues.push(issue('SOURCE_HAS_CONTROL_CHARS', 'YAML source must not contain control characters'));
  }
  if (issues.length > 0) return { ok: false, issues };

  let documents: ReturnType<typeof parseAllDocuments>;
  try {
    documents = parseAllDocuments(source, {
      uniqueKeys: true,
      merge: false,
      prettyErrors: true,
      strict: true,
      logLevel: 'silent',
    });
  } catch (error) {
    issues.push(issue('YAML_SYNTAX', `YAML parser failed: ${error instanceof Error ? error.message : String(error)}`));
    return { ok: false, issues };
  }

  if (documents.length === 0) {
    issues.push(issue('YAML_SYNTAX', 'document is empty'));
    return { ok: false, issues };
  }
  if (documents.length > 1) {
    issues.push(issue('MULTI_DOCUMENT', `exactly one YAML document is allowed; found ${documents.length}`));
    return { ok: false, issues };
  }

  const document = documents[0];
  if (document === undefined) {
    issues.push(issue('YAML_SYNTAX', 'document is empty'));
    return { ok: false, issues };
  }

  for (const error of document.errors) {
    const code: YamlIssueCode = error.code === 'DUPLICATE_KEY' ? 'DUPLICATE_KEY' : 'YAML_SYNTAX';
    issues.push(issue(code, error.message, '', positionOf(error)));
  }
  if (issues.length > 0) return { ok: false, issues };

  // Directivas: solo YAML 1.2 efectivo y sin reetiquetado `%TAG` (CF04).
  const directives = (document as unknown as {
    directives?: {
      yaml?: { explicit?: boolean | null; version?: string | null } | null;
      tags?: Record<string, string> | null;
    } | null;
  }).directives;
  const yamlDirective = directives?.yaml;
  if (yamlDirective?.explicit === true && yamlDirective.version !== SUPPORTED_YAML_VERSION) {
    issues.push(
      issue(
        'YAML_VERSION_UNSUPPORTED',
        `only %YAML ${SUPPORTED_YAML_VERSION} is supported; found %YAML ${String(yamlDirective.version)}`,
      ),
    );
  }
  const tagPrefixes = directives?.tags;
  if (tagPrefixes !== undefined && tagPrefixes !== null) {
    for (const prefix of Object.keys(tagPrefixes)) {
      if (prefix !== '!!') {
        issues.push(issue('TAG_DIRECTIVE_NOT_ALLOWED', `%TAG directive is not allowed (prefix ${JSON.stringify(prefix)})`));
      }
    }
  }
  if (issues.length > 0) return { ok: false, issues };

  for (const warning of document.warnings) {
    const code: YamlIssueCode = warning.code.startsWith('TAG_')
      ? 'TAG_NOT_ALLOWED'
      : warning.code === 'BAD_DIRECTIVE'
        ? 'YAML_VERSION_UNSUPPORTED'
        : 'YAML_SYNTAX';
    issues.push(issue(code, warning.message, '', positionOf(warning)));
  }
  if (issues.length > 0) return { ok: false, issues };

  const outcome: StructuralOutcome = { issues: [] };
  walkNode(document.contents, 1, effective, outcome);
  if (outcome.issues.length > 0) return { ok: false, issues: outcome.issues };

  try {
    const value = document.toJS() as unknown;
    if (value === null || value === undefined) {
      return { ok: false, issues: [issue('YAML_SYNTAX', 'document has no data')] };
    }
    return { ok: true, value };
  } catch (error) {
    return {
      ok: false,
      issues: [issue('YAML_SYNTAX', `YAML conversion failed: ${error instanceof Error ? error.message : String(error)}`)],
    };
  }
}

/**
 * Parsea YAML estricto y valida el resultado con el esquema indicado.
 * Lanza `YamlValidationError` con todos los diagnósticos (YAML y/o de esquema).
 */
export function parseYaml<S extends ZodType>(source: string, schema: S): output<S> {
  const result = safeParseYaml(source, schema);
  if (!result.ok) throw new YamlValidationError(result.issues);
  return result.value;
}

/** Versión no lanzadora de `parseYaml`. */
export function safeParseYaml<S extends ZodType>(
  source: string,
  schema: S,
  limits: YamlLimits = {},
): YamlResult<output<S>> {
  const parsed = safeParseYamlDocument(source, limits);
  if (!parsed.ok) return parsed;

  const validation = schema.safeParse(parsed.value);
  if (validation.success) return { ok: true, value: validation.data };

  const issues: YamlIssue[] = validation.error.issues.slice(0, MAX_ISSUES_PER_DOCUMENT).map((zodIssue) =>
    issue('SCHEMA_MISMATCH', zodIssue.message, zodIssue.path.map((part) => String(part)).join('.')),
  );
  return { ok: false, issues };
}

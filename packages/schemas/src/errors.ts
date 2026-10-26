/**
 * Catálogos de error de la especificación y diagnósticos internos de contrato.
 *
 * `SpecErrorCode` son los códigos nombrados en la spec (§3.2, §5.4, §6.3, §6.4, §9.2).
 * Los códigos de YAML/contratos son diagnósticos de validación de F0: se devuelven como
 * `ContractIssue`/`YamlIssue` y no se confunden con el error estructurado de una operación.
 */
import { z } from 'zod';
import { MAX_TEXT_CHARS } from './constants.js';
import { uuidV7Schema } from './primitives.js';

/* ------------------------------------------------------------------ *
 * Errores estructurados de operación (spec §9.2)
 * ------------------------------------------------------------------ */

export const SPEC_ERROR_CODES = [
  'ARTIFACT_DIVERGED',
  'CAPABILITY_UNAVAILABLE',
  'DESTINATION_CONFLICT',
  'IDEMPOTENCY_CONFLICT',
  'IDENTITY_CONFLICT',
  'INVALID_TRANSITION',
  'RELEASE_QUARANTINED',
  'REVISION_CONFLICT',
  'TRANSLATION_UNAVAILABLE',
  'UNSUPPORTED_FILESYSTEM',
  'VERSION_CONTENT_CONFLICT',
  'WORKSPACE_BUSY',
] as const;

export const specErrorCodeSchema = z.enum(SPEC_ERROR_CODES);
export type SpecErrorCode = z.output<typeof specErrorCodeSchema>;

/** Errores de operación: código, mensaje seguro, IDs afectados y reintentabilidad. Sin stacks ni secretos. */
export const structuredErrorSchema = z
  .object({
    code: specErrorCodeSchema,
    message: z.string().min(1).max(1000),
    affectedIds: z.array(z.string().min(1).max(200)).max(64).optional(),
    retryable: z.boolean(),
  })
  .strict()
  .meta({ 'x-runtime-validation': 'Zod rejects stacks/secrets only by convention: message is operator text, never provider output' });

export type StructuredError = z.output<typeof structuredErrorSchema>;

/* ------------------------------------------------------------------ *
 * Diagnósticos de validación YAML (F0)
 * ------------------------------------------------------------------ */

/**
 * `DANGEROUS_KEY` cubre únicamente claves de defensa de prototipo (`__proto__`,
 * `constructor`, `prototype`) y el merge `<<` (reescritura silenciosa). No se
 * prohíben palabras de contenido como `env`, `include` o `command`: el parser no
 * expande ni ejecuta nada (CF04).
 */

export const YAML_ISSUE_CODES = [
  'SOURCE_TOO_LARGE',
  'SOURCE_HAS_LONE_SURROGATE',
  'SOURCE_HAS_CONTROL_CHARS',
  'MULTI_DOCUMENT',
  'ALIAS_NOT_ALLOWED',
  'TAG_NOT_ALLOWED',
  'TAG_DIRECTIVE_NOT_ALLOWED',
  'YAML_VERSION_UNSUPPORTED',
  'DUPLICATE_KEY',
  'NON_SCALAR_KEY',
  'NESTING_TOO_DEEP',
  'DANGEROUS_KEY',
  'VALUE_HAS_LONE_SURROGATE',
  'YAML_SYNTAX',
  'SCHEMA_MISMATCH',
] as const;

export const yamlIssueCodeSchema = z.enum(YAML_ISSUE_CODES);
export type YamlIssueCode = z.output<typeof yamlIssueCodeSchema>;

export const yamlIssueSchema = z
  .object({
    code: yamlIssueCodeSchema,
    message: z.string().min(1).max(1000),
    path: z.string().max(500),
    line: z.int().min(1).optional(),
    column: z.int().min(1).optional(),
  })
  .strict();

export type YamlIssue = z.output<typeof yamlIssueSchema>;

/* ------------------------------------------------------------------ *
 * Diagnósticos de relaciones entre catálogos (F0)
 * ------------------------------------------------------------------ */

export const CONTRACT_ISSUE_CODES = [
  'SCHEMA_INVALID',
  'ENTRYPOINT_MISSING',
  'DUPLICATE_ID',
  'DUPLICATE_PATH',
  'PATH_COLLISION',
  'PATH_NOT_PORTABLE',
  'UNDECLARED_ASSETS',
  'MISSING_ASSETS',
  'UNDECLARED_CURRICULUM',
  'MISSING_CURRICULUM',
  'UNDECLARED_ITEM_BANK',
  'MISSING_ITEM_BANK',
  'INVALID_BANKS_MAP',
  'UNKNOWN_RESOURCE_REF',
  'UNKNOWN_SKILL_REF',
  'SKILL_NOT_COVERED',
  'PREREQUISITE_CYCLE',
  'LICENSE_REF_UNDECLARED',
] as const;

export const contractIssueCodeSchema = z.enum(CONTRACT_ISSUE_CODES);
export type ContractIssueCode = z.output<typeof contractIssueCodeSchema>;

export const contractIssueSchema = z
  .object({
    code: contractIssueCodeSchema,
    message: z.string().min(1).max(1000),
    /** Ubicación lógica, p. ej. `curriculum.modules[0].resource_ids[1]`. */
    path: z.string().max(500),
    /** Documento de entrada que originó el problema. */
    document: z.enum(['manifest', 'resources', 'curriculum', 'assets', 'itemBank']),
    detail: z.string().max(1000).optional(),
  })
  .strict();

export type ContractIssue = z.output<typeof contractIssueSchema>;

/* ------------------------------------------------------------------ *
 * Resultados de operación (spec §9.2)
 * ------------------------------------------------------------------ */

/** `OperationResult` = IDs de resultados, estado y error estructurado opcional. */
export const operationResultSchema = z
  .object({
    operationUid: uuidV7Schema,
    status: z.enum(['pending', 'completed', 'failed']),
    resultIds: z.record(z.string().min(1).max(128), z.string().min(1).max(200)).optional(),
    error: structuredErrorSchema.optional(),
  })
  .strict()
  .meta({
    'x-runtime-validation':
      'Zod cannot enforce that failed implies error, completed implies no error, or that resultIds reference existing aggregates (Core checks them transactionally)',
  });

export type OperationResult = z.output<typeof operationResultSchema>;

/** Texto libre de razón/feedback: sin secretos ni cuerpos de proveedor. */
export const reasonTextSchema = z.string().min(1).max(MAX_TEXT_CHARS);

/**
 * Escalares primitivos de los contratos: identificadores, hashes, tiempo, idiomas,
 * licencias y rutas.
 *
 * Cada escalar es la única definición ejecutable de su regla (spec §3.1, §3.2, §4, §7.1)
 * y se exporta también como JSON Schema. Cuando una regla no es expresable en JSON Schema
 * se anota `x-runtime-validation` en el esquema generado.
 */
import { z } from 'zod';
import { valid as semverValid } from 'semver';
import { assertStrictJson, CanonicalJsonError } from './canonical.js';
import { LICENSE_REF_PATTERN, LICENSE_SHAPE_PATTERN, isKnownLicense } from './spdx.js';
import { hasLoneSurrogate } from './paths.js';
import {
  MAX_CONTENT_BYTES,
  MAX_DESCRIPTION_CHARS,
  MAX_EXTENSION_KEY_CHARS,
  MAX_EXTENSION_KEYS,
  MAX_LIST_ITEMS,
  MAX_NAME_CHARS,
  MAX_SHORT_ID_CHARS,
  MAX_TAGS,
  MAX_TEXT_CHARS,
  MAX_TITLE_CHARS,
} from './constants.js';

/* ------------------------------------------------------------------ *
 * Identificadores
 * ------------------------------------------------------------------ */

/** UUIDv7: versión 7 en el tercer grupo, variante RFC 4122 (`8|9|a|b`). Comparación por valor. */
export const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const uuidV7Schema = z
  .string()
  .regex(UUID_V7_PATTERN, 'must be a lowercase UUIDv7')
  .max(36);

/**
 * `package_id`: namespace humano `host/owner/name`, segmentos `[a-z0-9][a-z0-9._-]*` (spec §3.1).
 * No prueba autoría.
 */
export const PACKAGE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*){2}$/;

export const packageIdSchema = z.string().regex(PACKAGE_ID_PATTERN, 'must be host/owner/name').max(200);

/**
 * IDs de recursos, módulos, criterios y habilidades: ASCII `[a-z0-9][a-z0-9-]{0,63}` (spec §3.1).
 * Ámbito = release; no hay equivalencia automática entre paquetes/versiones.
 */
export const RESOURCE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export const resourceIdSchema = z.string().regex(RESOURCE_ID_PATTERN, 'must match [a-z0-9][a-z0-9-]{0,63}');

/** Clave de contexto pedagógico (§7.1): etiqueta estable, no aleatoria. */
export const CONTEXT_KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;

export const contextKeySchema = z.string().regex(CONTEXT_KEY_PATTERN, 'must match [a-z0-9][a-z0-9._-]{0,127}');

/* ------------------------------------------------------------------ *
 * Hashes y versiones
 * ------------------------------------------------------------------ */

/** SHA-256 en hex minúsculo (64 caracteres). */
export const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export const sha256Schema = z.string().regex(SHA256_PATTERN, 'must be 64 lowercase hex characters');

/** Commit Git completo (40 hex). */
export const FULL_COMMIT_PATTERN = /^[0-9a-fA-F]{40}$/;

export const fullCommitSchema = z.string().regex(FULL_COMMIT_PATTERN, 'must be a full 40-hex git commit');

/**
 * SemVer 2.0.0 estricto (spec §3.1: `release.version` obligatorio, no implica compatibilidad).
 * La expresión regular es la oficial; un test contrasta este escalar con `semver.valid`.
 */
export const SEMVER_PATTERN =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*)?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/;

export const semverSchema = z
  .string()
  .regex(SEMVER_PATTERN, 'must be a SemVer 2.0.0 version')
  // Contraste con la implementación de referencia; la validez efectiva es la de la expresión regular
  // (`semver.valid` acepta el prefijo `v` y descarta build metadata, por eso solo se consulta).
  .refine((value) => semverValid(value) !== null, { message: 'must be a SemVer 2.0.0 version' })
  .max(64);

/** Versión de esquema de contrato (`'1.0'`). */
export const schemaVersionSchema = z.literal('1.0');

/* ------------------------------------------------------------------ *
 * Tiempo
 * ------------------------------------------------------------------ */

/** ISO 8601 UTC con milisegundos exactos: `YYYY-MM-DDTHH:mm:ss.sssZ` (spec §6.2). */
export const UTC_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function isValidUtcInstant(value: string): boolean {
  if (!UTC_INSTANT_PATTERN.test(value)) return false;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return false;
  // Rechaza fechas de calendario imposibles (p. ej. 2026-02-31) que el parser normalizaría.
  return new Date(parsed).toISOString() === value;
}

/** Sin caracteres de control C0/DEL salvo tabulador y salto de línea (JSON Schema: `pattern`). */
const NO_CONTROL_CHARS = /^[^\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]*$/;

/** Sin ningún carácter de control, incluidos tabulador y salto de línea. */
const NO_CONTROL_CHARS_STRICT = /^[^\u0000-\u001F\u007F]*$/;

/** Al menos un carácter que no sea whitespace (equivale a `value.trim().length > 0`). */
const NOT_BLANK = /\S/;

export const utcInstantSchema = z
  .string()
  .regex(UTC_INSTANT_PATTERN, 'must be an ISO 8601 UTC instant with milliseconds')
  .refine(isValidUtcInstant, { message: 'must be a real calendar instant in UTC with milliseconds' })
  .max(24)
  .meta({
    'x-runtime-validation':
      'Además del patrón, Zod rechaza fechas de calendario imposibles (p. ej. 2026-02-31T00:00:00.000Z) mediante ida y vuelta por Date: JSON Schema solo ve el patrón.',
  });

/* ------------------------------------------------------------------ *
 * Licencias, medios y textos
 * ------------------------------------------------------------------ */

/**
 * Licencia: vocabulario SPDX reconocido (vigente o deprecado, desde el paquete
 * estático instalado) o `LicenseRef-*` bien formado (§4.1, CF02). Un identificador
 * inventado no se atribuye a SPDX; ser SPDX no prueba derechos de uso.
 */
export const licenseSchema = z
  .string()
  .max(200)
  .regex(LICENSE_SHAPE_PATTERN, 'must be an SPDX id or LicenseRef-*')
  .refine(isKnownLicense, {
    message: 'must be a recognized SPDX identifier (current or deprecated) or a LicenseRef-*',
  })
  .meta({
    'x-runtime-validation':
      'JSON Schema solo ve la forma; Zod contrasta contra las listas estáticas SPDX (vigentes y deprecadas) del paquete instalado. LicenseRef-* además exige texto declarado en metadata.license_files (comprobación cruzada en validateNotebookContracts).',
  });

/** Referencia personalizada `LicenseRef-*` (claves de `metadata.license_files`). */
export const licenseRefSchema = z.string().regex(LICENSE_REF_PATTERN, 'must be a LicenseRef-* identifier');

/** Media type lowercase `type/subtype` (allowlist v0.1 se comprueba al instalar, §4.2). */
export const MEDIA_TYPE_PATTERN = /^[a-z0-9!#$%&'*+.^_`-]{1,127}\/[a-z0-9!#$%&'*+.^_`-]{1,127}$/;

export const mediaTypeSchema = z
  .string()
  .regex(MEDIA_TYPE_PATTERN, 'must be a lowercase type/subtype media type')
  .max(255);

/** Clave de `extensions`: JSON con namespace explícito `dns-like:key` (§4). */
export const EXTENSION_KEY_PATTERN =
  /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*:[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export const extensionKeySchema = z
  .string()
  .regex(EXTENSION_KEY_PATTERN, 'must be a namespaced key: <dns-namespace>:<key>')
  .max(MAX_EXTENSION_KEY_CHARS);

/**
 * Texto de contenido: sin caracteres de control, dentro del límite real de
 * 2 MiB **medido en bytes UTF-8** (2 MiB de caracteres admitiría hasta 6 MiB
 * reales) y con strings Unicode bien formados (sin surrogates sin pareja).
 */
export const contentTextSchema = z
  .string()
  .max(MAX_TEXT_CHARS)
  .regex(NO_CONTROL_CHARS, 'must not contain control characters')
  .refine((value) => Buffer.byteLength(value, 'utf8') <= MAX_CONTENT_BYTES, {
    message: `must fit in ${MAX_CONTENT_BYTES} UTF-8 bytes`,
  })
  .refine((value) => !hasLoneSurrogate(value), { message: 'must not contain unpaired surrogates' })
  .meta({
    'x-runtime-validation':
      'El límite de 2 MiB se mide en bytes UTF-8 y se exige string Unicode bien formado; JSON Schema solo ve maxLength y pattern.',
  });

/**
 * Referencia canónica a la fuente publicada `release + recurso + digest`,
 * compartida por artifacts, ítems e intentos (§5.2, §7.1).
 */
export const sourceRefSchema = z
  .object({
    release_id: uuidV7Schema,
    resource_id: resourceIdSchema,
    digest: sha256Schema,
  })
  .strict();

export type SourceRef = z.output<typeof sourceRefSchema>;

/** Nombre visible (título de paquete, autor). */
export const nameTextSchema = z
  .string()
  .min(1)
  .max(MAX_NAME_CHARS)
  .regex(NOT_BLANK, 'must not be blank');

export const titleTextSchema = z
  .string()
  .min(1)
  .max(MAX_TITLE_CHARS)
  .regex(NOT_BLANK, 'must not be blank');

export const descriptionTextSchema = z.string().max(MAX_DESCRIPTION_CHARS);

export const shortIdTextSchema = z.string().min(1).max(MAX_SHORT_ID_CHARS);

/**
 * Valor JSON acotado y reutilizable (extensions, solución, respuesta).
 *
 * Se valida con el guard de la autoridad canónica ANTES de cualquier recursión
 * sobre el valor: `z.json()` sube hasta reventar el stack (`RangeError`) con
 * entradas muy profundas, y `safeParse` nunca debe lanzar por una entrada
 * inválida. Los ciclos se detectan por identidad y se rechazan.
 */
export const jsonValueSchema = z
  .any()
  .superRefine((value, ctx) => {
    try {
      assertStrictJson(value);
    } catch (error) {
      if (error instanceof CanonicalJsonError) {
        ctx.addIssue({ code: 'custom', message: error.message });
        return;
      }
      throw error;
    }
  })
  .meta({
    description: 'Any JSON value, bounded and validated at runtime',
    'x-runtime-validation':
      'JSON Schema lo describe como cualquier valor (`{}`): la validación real (profundidad ≤ 256, sin ciclos, sin claves de prototipo, arrays densos, objetos planos y strings/claves bien formados) solo la hace Zod con el guard de la autoridad canónica. No se usa JSON Schema como única validación de este campo.',
  });

/**
 * Objeto de extensión: JSON arbitrario bajo claves con namespace. No otorga permisos (§4).
 * Se acepta en todo documento; cualquier otra clave desconocida se rechaza.
 */
export const extensionsSchema = z
  .record(extensionKeySchema, jsonValueSchema)
  .refine((value) => Object.keys(value).length <= MAX_EXTENSION_KEYS, {
    message: `at most ${MAX_EXTENSION_KEYS} extension keys`,
  })
  .meta({
    description: 'JSON under namespaced keys; grants no permissions',
    'x-runtime-validation':
      `JSON Schema limita las claves por patrón, pero Zod impone además un máximo de ${MAX_EXTENSION_KEYS} claves y valida cada valor como JSON acotado: extensions no es un canal de configuración ni de permisos (§4).`,
  });

/** Etiqueta temática lowercase de catálogo. */
export const tagSchema = z.string().regex(/^[a-z0-9][a-z0-9._+-]{0,39}$/).max(40);

export const tagListSchema = z.array(tagSchema).max(MAX_TAGS);

/** Lista genérica acotada (defensa contra archivos enrarecidos). */
export const boundedList = <T extends z.ZodType>(item: T, max = MAX_LIST_ITEMS) => z.array(item).max(max);

/* ------------------------------------------------------------------ *
 * Rutas locales y URLs (entradas administrativas)
 * ------------------------------------------------------------------ */

/** Path de sistema de archivos local (entrada de usuario, no path dentro de un paquete). */
export const localPathSchema = z
  .string()
  .min(1)
  .max(4096)
  .regex(NO_CONTROL_CHARS_STRICT, 'must not contain control characters');

/** Único transporte remoto de v0.1: HTTPS sin credenciales en la URL (§3.2). */
export const httpsUrlSchema = z
  .string()
  .min(1)
  .max(2048)
  .refine(
    (value) => {
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        return false;
      }
      return url.protocol === 'https:' && url.username === '' && url.password === '';
    },
    { message: 'must be an https URL without embedded credentials' },
  )
  .meta({
    'x-runtime-validation':
      'Zod analiza la URL con el parser de WHATWG: exige esquema https y prohíbe credenciales embebidas. JSON Schema solo puede insinuarlo con un patrón y no cubre normalización, hosts raros ni percent-encoding.',
  });

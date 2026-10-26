/**
 * Límites y constantes normativas de la especificación v0.1.
 *
 * Fuente: docs/learning-workspace-spec-v0.1.md (§3.2, §4, §7.1, §11).
 * Estos valores son contrato: los esquemas los aplican en la frontera.
 */

/** Versión de contrato de todos los manifiestos y documentos de dominio. */
export const SCHEMA_VERSION = '1.0';

/** §3.2 / §9.2: YAML y Markdown hasta 2 MiB por archivo; inputs de contenido hasta 2 MiB. */
export const MAX_YAML_BYTES = 2 * 1024 * 1024;
export const MAX_CONTENT_BYTES = 2 * 1024 * 1024;

/** Profundidad máxima de anidamiento aceptable en un documento YAML (anti stack-exhaustion). */
export const MAX_YAML_DEPTH = 32;

/** §3.2: máximo de archivos y tamaños de snapshot. */
export const MAX_SNAPSHOT_FILES = 2_000;
export const MAX_SNAPSHOT_BYTES = 100 * 1024 * 1024;
export const MAX_ASSET_BYTES = 10 * 1024 * 1024;

/** §3.2: límite por archivo de texto del paquete (Markdown, YAML y licencia `.txt`). */
export const MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024;

export const MAX_GIT_CAPTURE_BYTES = 200 * 1024 * 1024;
export const MAX_GIT_CAPTURE_MS = 60_000;

/** §11: cuotas de generación. */
export const MAX_GENERATION_BYTES = 2 * 1024 * 1024;
export const MAX_ARTIFACT_BYTES_PER_ENROLLMENT = 100 * 1024 * 1024;
export const MAX_GENERATION_REQUESTS_PER_SESSION = 10;
export const MAX_GENERATION_REQUESTS_CONCURRENT = 2;
export const GENERATION_TIMEOUT_MS = 60_000;

/** Límites de longitud de texto en contratos (carácteres JS; bytes se limitan al parsear YAML). */
export const MAX_NAME_CHARS = 200;
export const MAX_TITLE_CHARS = 160;
export const MAX_DESCRIPTION_CHARS = 2_000;
export const MAX_TEXT_CHARS = MAX_CONTENT_BYTES;
export const MAX_SHORT_ID_CHARS = 128;
export const MAX_EXTENSION_KEY_CHARS = 128;
export const MAX_EXTENSION_KEYS = 64;
export const MAX_TAGS = 32;
export const MAX_LIST_ITEMS = 10_000;

/** Etiqueta de digest canónico de snapshot (`snapshot-sha256-v1`). */
export const SNAPSHOT_DIGEST_PREFIX = 'learning-snapshot-v1\n';
export const SNAPSHOT_DIGEST_ALGORITHM = 'snapshot-sha256-v1';

/** Algoritmo de identidad de contenido de release. */
export const CONTENT_DIGEST_ALGORITHM = 'sha256';

/**
 * Profundidad máxima de anidamiento en JSON canónico y en valores JSON de contrato.
 * Misma cota que la autoridad de Core: evita agotar el stack y acota entradas hostiles.
 */
export const MAX_CANONICAL_JSON_DEPTH = 256;

/** Longitud máxima de un tag BCP 47 (razonable, no arbitraria: 255). */
export const MAX_BCP47_TAG_CHARS = 255;

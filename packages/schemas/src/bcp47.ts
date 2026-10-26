/**
 * Tags BCP 47 (spec §4.1) sobre el parser mantenido `bcp-47`.
 *
 * Reglas del contrato:
 * - Parseo estricto (`forgiving: false`) con aviso de gramática como rechazo.
 * - **Sin normalización legacy** (`normalize: false`): `i-ami` o `art-lojban`
 *   no se reescriben silenciosamente a otro tag (CF06: normalización controlada).
 * - Sin duplicados: variantes y singletons de extensión deben ser únicos.
 * - Longitud razonable de 255 caracteres (no un límite arbitrario de 35).
 * - El valor admitido debe ser **ya canónico**: se reconstruye desde el AST con
 *   casing canónico (idioma/variantes/uso privado en minúsculas, script
 *   Titlecase, región en mayúsculas) y se exige igualdad exacta con la entrada.
 *   Por eso `es-MX` y `zh-Hant-TW` valen, mientras `ES-mx`, `en-1996-US`,
 *   `en-US-Latn` o `en-u-ca-gregory-US` no (son o inválidos o no canónicos).
 *
 * No se usa `bcp-47-normalize` (CLDR): convertiría `en-US` en `en` y la spec
 * exige conservar distinciones y comparar tags canónicos exactos.
 */
import { parse, stringify } from 'bcp-47';
import type { Schema } from 'bcp-47';
import { z } from 'zod';
import { MAX_BCP47_TAG_CHARS } from './constants.js';

/** Forma léxica de un tag (para que JSON Schema vea algo); la gramática es de Zod. */
export const BCP47_SHAPE_PATTERN = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;

function lower(value: string): string {
  return value.toLowerCase();
}

function titleCase(value: string): string {
  if (value.length === 0) return value;
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function upper(value: string): string {
  return value.toUpperCase();
}

/** Reconstruye el AST con casing canónico sin tocar el orden estructural. */
function recase(ast: Schema): Schema {
  return {
    extendedLanguageSubtags: ast.extendedLanguageSubtags.map(lower),
    extensions: ast.extensions.map((extension) => ({
      singleton: extension.singleton.toLowerCase(),
      extensions: extension.extensions.map(lower),
    })),
    irregular: ast.irregular ?? null,
    language: ast.language === null || ast.language === undefined ? ast.language : lower(ast.language),
    privateuse: ast.privateuse.map(lower),
    region: ast.region === null || ast.region === undefined ? ast.region : upper(ast.region),
    regular: ast.regular ?? null,
    script: ast.script === null || ast.script === undefined ? ast.script : titleCase(ast.script),
    variants: ast.variants.map(lower),
  };
}

/**
 * Valida `tag` y devuelve su forma canónica, o `null` si no es un BCP 47
 * bien formado y canónico. La comparación de la spec es igualdad exacta contra
 * este valor: no existe normalización implícita.
 */
export function canonicalBcp47Tag(tag: string): string | null {
  if (typeof tag !== 'string') return null;
  if (tag.length === 0 || tag.length > MAX_BCP47_TAG_CHARS) return null;

  let warned = false;
  let ast: Schema;
  try {
    ast = parse(tag, {
      forgiving: false,
      normalize: false,
      warning: () => {
        warned = true;
      },
    });
  } catch {
    return null;
  }
  if (warned) return null;

  const hasLanguage = typeof ast.language === 'string' && ast.language.length > 0;
  const hasPrivateUse = ast.privateuse.length > 0;
  const hasGrandfathered = typeof ast.irregular === 'string' || typeof ast.regular === 'string';
  if (!hasLanguage && !hasPrivateUse && !hasGrandfathered) return null;

  const variants = ast.variants.map(lower);
  if (new Set(variants).size !== variants.length) return null;
  const singletons = ast.extensions.map((extension) => extension.singleton.toLowerCase());
  if (new Set(singletons).size !== singletons.length) return null;

  let canonical: string;
  try {
    canonical = stringify(recase(ast));
  } catch {
    return null;
  }
  if (canonical.length === 0 || canonical !== tag) return null;
  return canonical;
}

/** `true` cuando el tag es BCP 47 bien formado y ya está en forma canónica. */
export function isBcp47Tag(tag: string): boolean {
  return canonicalBcp47Tag(tag) === tag;
}

export const bcp47Schema = z
  .string()
  .max(MAX_BCP47_TAG_CHARS)
  .regex(BCP47_SHAPE_PATTERN, 'must be a BCP 47 language tag')
  .refine((value) => isBcp47Tag(value), {
    message: `must be a well-formed canonical BCP 47 tag (max ${MAX_BCP47_TAG_CHARS} chars)`,
  })
  .meta({
    'x-runtime-validation':
      'Zod parsea con bcp-47 en modo estricto sin normalización legacy, exige subtags únicos y compara con la forma canónica exacta (idioma/variantes/uso privado en minúsculas, script Titlecase, región en MAYÚSCULAS). JSON Schema solo ve patrón y longitud.',
  });

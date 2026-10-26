/**
 * Escalares primitivos: identificadores, hashes, tiempo, idiomas, licencias y límites.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { valid as semverValid } from 'semver';
import {
  bcp47Schema,
  canonicalBcp47Tag,
  contentTextSchema,
  extensionKeySchema,
  extensionsSchema,
  fullCommitSchema,
  httpsUrlSchema,
  isBcp47Tag,
  licenseSchema,
  localPathSchema,
  mediaTypeSchema,
  packageIdSchema,
  profilePreferencesSchema,
  resourceIdSchema,
  semverSchema,
  sha256Hex,
  sha256Schema,
  utcInstantSchema,
  uuidV7Schema,
} from '../dist/index.js';
import { accepts, failureMessage, fixtureIds } from './helpers.ts';

test('UUIDv7: acepta solo versión 7 con variante RFC 4122 en minúsculas', () => {
  for (const id of Object.values(fixtureIds())) {
    assert.equal(uuidV7Schema.safeParse(id).success, true, `expected valid uuidv7: ${id}`);
  }
  const valid = '019a3dd5-4a10-7a90-8eef-3174e0386931';
  assert.equal(uuidV7Schema.safeParse(valid).success, true);
  // UUIDv4 (versión 4) no es UUIDv7.
  assert.equal(uuidV7Schema.safeParse('9f6c2e1a-1234-4abc-8def-0123456789ab').success, false);
  // Variante inválida: el nibble del cuarto grupo debe ser 8|9|a|b.
  assert.equal(uuidV7Schema.safeParse('019a3dd5-4a10-7a90-3eef-3174e0386931').success, false);
  assert.equal(uuidV7Schema.safeParse('019A3DD5-4A10-7A90-8EEF-3174E0386931').success, false);
  assert.equal(uuidV7Schema.safeParse('019a3dd5-4a10-7a90-8eef-3174e038693').success, false);
});

test('SemVer: la expresión regular coincide con semver.valid sobre vectores', () => {
  const validVersions = ['1.0.0', '0.0.0', '10.20.30', '1.2.3-alpha.1', '1.0.0-rc.1+meta.2', '1.0.0-a-b'];
  const invalidVersions = ['1.0', '1', 'v1.0.0', '1.0.0-', '01.0.0', '1.0.0-01', '1.0.0.', '1.0.0+'];
  for (const version of validVersions) {
    assert.notEqual(semverValid(version), null, `semver should accept ${version}`);
    assert.equal(accepts(semverSchema, version), true, `schema should accept ${version}`);
  }
  for (const version of invalidVersions) {
    assert.equal(accepts(semverSchema, version), false, `schema should reject ${version}`);
  }
  // `1.0`, `1.0.0-`, `01.0.0`... también los rechaza la librería de referencia.
  for (const version of ['1.0', '1', '1.0.0-', '01.0.0', '1.0.0-01']) {
    assert.equal(semverValid(version), null, `semver should reject ${version}`);
  }
  // Matices conocidos: semver acepta el prefijo `v` y descarta build metadata;
  // la expresión regular del contrato es la que manda y es estricta en ambos casos.
  assert.equal(semverValid('v1.0.0'), '1.0.0');
  assert.equal(accepts(semverSchema, 'v1.0.0'), false);
  assert.equal(semverValid('1.0.0+build.5'), '1.0.0');
  assert.equal(accepts(semverSchema, '1.0.0+build.5'), true);
  assert.match(failureMessage(semverSchema, '1.0'), /SemVer/);
});

test('Instantes UTC: ISO 8601 con milisegundos y calendario real', () => {
  assert.equal(accepts(utcInstantSchema, '2026-10-25T12:00:00.000Z'), true);
  assert.equal(accepts(utcInstantSchema, '1970-01-01T00:00:00.000Z'), true);
  const invalid = [
    '2026-10-25T12:00:00Z', // sin milisegundos
    '2026-10-25T12:00:00.000+00:00', // no es Z
    '2026-02-31T00:00:00.000Z', // día imposible
    '2026-13-01T00:00:00.000Z', // mes imposible
    '2026-10-25T25:00:00.000Z', // hora imposible
    '26-10-25T12:00:00.000Z',
    '2026-10-25 12:00:00.000Z',
  ];
  for (const value of invalid) {
    assert.equal(accepts(utcInstantSchema, value), false, `should reject ${value}`);
  }
});

test('BCP 47: parser estricto, forma canónica exacta y subtags únicos', () => {
  const valid = [
    'en',
    'es',
    'es-MX',
    'en-GB',
    'zh-Hant-TW',
    'sr-Latn-RS',
    'de-DE-u-co-phonebk',
    'zh-cmn-Hans-CN',
    'yue-HK',
    'x-private',
    'eng',
    'es-1234',
    'en-x-a',
    'en-Latn',
    'zh-yue-HK',
    // Grandfathered: se aceptan literales, sin normalización legacy (CF06).
    'art-lojban',
    'i-ami',
    // 39 caracteres: gramática válida, el límite razonable es 255.
    'zh-Hant-CN-abcdefg1-abcdefg2-x-abcdefgh',
  ];
  const invalid = [
    'e',
    'ES-mx',
    'EN-us',
    'es_mx',
    'es mx',
    '-es',
    'es-',
    'es--MX',
    'abcdefghi',
    'es-1',
    'x',
    '',
    'es-MX-x-' + 'a'.repeat(9),
    'zh-Hant-CN-x-' + 'b'.repeat(30),
    // CF06: la máquina manual aceptaba estas mezclas de orden/casing.
    'en-1996-US',
    'en-US-Latn',
    'en-a-foo-Latn',
    'en-u-ca-gregory-US',
    // Subtags duplicados: variantes y singletons de extensión.
    'en-1901-1901',
    'en-u-co-phonebk-u-ca',
    'de-DE-u-ca-u-co',
  ];
  for (const tag of valid) {
    assert.equal(accepts(bcp47Schema, tag), true, `should accept ${tag}`);
  }
  for (const tag of invalid) {
    assert.equal(accepts(bcp47Schema, tag), false, `should reject ${tag}`);
  }

  // La identidad de comparación es la igualdad exacta con la forma canónica.
  assert.equal(canonicalBcp47Tag('es-MX'), 'es-MX');
  assert.equal(canonicalBcp47Tag('ES-mx'), null, 'no se devuelve una forma normalizada: se rechaza');
  assert.equal(canonicalBcp47Tag('en-US'), 'en-US');
  assert.equal(canonicalBcp47Tag('en-us'), null);
  assert.equal(isBcp47Tag('zh-Hant-TW'), true);
  assert.equal(isBcp47Tag('zh-hant-tw'), false, 'script en minúsculas no es canónico');

  // Límite razonable de 255 caracteres, no un 35 arbitrario.
  const build = (target: number): string => {
    const parts = ['en', 'x'];
    while (parts.join('-').length + 3 <= target) parts.push('ab');
    return parts.join('-');
  };
  const near = build(255);
  assert.ok(near.length <= 255 && near.length >= 250, `longitud ${near.length}`);
  assert.equal(accepts(bcp47Schema, near), true, `acepta hasta 255 (${near.length})`);
  const over = `${near}-cd`;
  assert.ok(over.length > 255, `longitud ${over.length}`);
  assert.equal(accepts(bcp47Schema, over), false, 'rechaza pasados de 255');
});

test('IDs de recurso y package_id según §3.1', () => {
  assert.equal(accepts(resourceIdSchema, 'a'), true);
  assert.equal(accepts(resourceIdSchema, 'ohms-law'), true);
  assert.equal(accepts(resourceIdSchema, 'a'.repeat(64)), true);
  assert.equal(accepts(resourceIdSchema, 'a'.repeat(65)), false);
  assert.equal(accepts(resourceIdSchema, 'A'), false);
  assert.equal(accepts(resourceIdSchema, '-lead'), false);
  assert.equal(accepts(resourceIdSchema, 'with_underscore'), false);

  assert.equal(accepts(packageIdSchema, 'github.com/academy-a/electronics-fundamentals'), true);
  assert.equal(accepts(packageIdSchema, 'example.org/reference/notes-handbook'), true);
  assert.equal(accepts(packageIdSchema, 'github.com/academy-a'), false, 'faltan segmentos');
  assert.equal(accepts(packageIdSchema, 'GitHub.com/a/b'), false, 'mayúsculas');
  assert.equal(accepts(packageIdSchema, 'a/b/c/d'), false, 'el contrato de v0.1 es host/owner/name');
  assert.equal(accepts(packageIdSchema, '/a/b'), false);
});

test('SHA-256, commits completos, licencias y media types', () => {
  const digest = sha256Hex(fixtureIds().releaseUid ?? '');
  assert.equal(accepts(sha256Schema, digest), true);
  assert.equal(accepts(sha256Schema, digest.toUpperCase()), false, 'hex minúsculo obligatorio');
  assert.equal(accepts(sha256Schema, digest.slice(0, 63)), false);

  assert.equal(accepts(fullCommitSchema, '0123456789abcdef0123456789abcdef01234567'), true);
  assert.equal(accepts(fullCommitSchema, 'abc123'), false, 'commit corto rechazado');

  // Vocabulario SPDX: reconocidos (vigentes y deprecados) y LicenseRef-*,
  // pero nunca un nombre inventado.
  for (const license of ['CC-BY-4.0', 'MIT', 'Apache-2.0', 'LicenseRef-School-Policy']) {
    assert.equal(accepts(licenseSchema, license), true, `should accept ${license}`);
  }
  // SPDX deprecado sigue siendo vocabulario reconocido (no atribuye derechos).
  assert.equal(accepts(licenseSchema, 'GPL-2.0'), true, 'deprecated SPDX');
  assert.equal(accepts(licenseSchema, 'AGPL-1.0'), true, 'deprecated SPDX');
  for (const license of ['CC BY 4.0', '', 'license ref', 'MyMadeUpLicense-1.0', 'CC-BY-9.9', 'LicenseRef-']) {
    assert.equal(accepts(licenseSchema, license), false, `should reject ${license}`);
  }

  for (const media of ['text/markdown', 'image/png', 'application/yaml']) {
    assert.equal(accepts(mediaTypeSchema, media), true, `should accept ${media}`);
  }
  for (const media of ['TEXT/MARKDOWN', 'text', 'text/', '/markdown', 'text/markdown/extra', 'text/mark down']) {
    assert.equal(accepts(mediaTypeSchema, media), false, `should reject ${media}`);
  }
});

test('extensions: JSON bajo claves con namespace', () => {
  assert.equal(accepts(extensionKeySchema, 'org.example:note'), true);
  assert.equal(accepts(extensionKeySchema, 'com.acme-x.v2:flag_1'), true);
  assert.equal(accepts(extensionKeySchema, 'note'), false, 'sin namespace');
  assert.equal(accepts(extensionKeySchema, 'Org:note'), false, 'namespace en mayúsculas');
  assert.equal(accepts(extensionKeySchema, 'org.example:note:extra'), false);

  assert.equal(accepts(extensionsSchema, { 'org.example:a': { any: ['json', 1, true, null] } }), true);
  assert.equal(accepts(extensionsSchema, { a: 1 }), false);
  assert.equal(accepts(extensionsSchema, { 'org.example:a': undefined }), false, 'undefined no es JSON');

  // CF04: palabras inertes dentro del JSON son contenido, no directivas.
  assert.equal(
    accepts(extensionsSchema, { 'org.example:cfg': { env: 'prod', include: ['a.yaml'], command: 'ls' } }),
    true,
    'claves inertes aceptadas como datos',
  );

  // JSON acotado: safeParse no lanza por ciclos, profundidad hostil ni claves de prototipo.
  const cyclic: Record<string, unknown> = { name: 'loop' };
  cyclic['self'] = cyclic;
  assert.equal(accepts(extensionsSchema, { 'org.example:cfg': cyclic }), false, 'ciclo rechazado sin lanzar');
  let deepValue: unknown = 'leaf';
  for (let index = 0; index < 10_000; index += 1) deepValue = [deepValue];
  assert.equal(accepts(extensionsSchema, { 'org.example:cfg': deepValue }), false, 'profundidad acotada sin RangeError');
  assert.equal(
    accepts(extensionsSchema, { 'org.example:cfg': JSON.parse('{"__proto__": {"polluted": true}}') }),
    false,
    'clave de prototipo rechazada',
  );
  assert.equal(({} as Record<string, unknown>)['polluted'], undefined, 'sin polución de prototipo');

  const many: Record<string, unknown> = {};
  for (let index = 0; index < 65; index += 1) many[`org.example:k${index}`] = 1;
  assert.equal(accepts(extensionsSchema, many), false, 'límite de 64 claves');
});

test('textos: límite de 2 MiB en bytes UTF-8, sin controles ni surrogates', () => {
  assert.equal(accepts(contentTextSchema, 'texto normal'), true);
  assert.equal(accepts(contentTextSchema, 'con\ttabulador y\nsalto'), true);
  assert.equal(accepts(contentTextSchema, 'nul\u0000byte'), false);
  assert.equal(accepts(contentTextSchema, 'del\u007Fchar'), false);
  assert.equal(accepts(contentTextSchema, 'x'.repeat(2 * 1024 * 1024 + 1)), false);
  assert.equal(accepts(contentTextSchema, 'x'.repeat(2 * 1024 * 1024)), true);

  // CF03/CF04: el límite real es de bytes, no de caracteres (2 MiB de 'é' = 4 MiB).
  const accented = 'é'.repeat(1024 * 1024); // 1 MiB de caracteres = 2 MiB de bytes
  assert.ok(accented.length < 2 * 1024 * 1024);
  assert.equal(accepts(contentTextSchema, accented), true, 'exactamente 2 MiB de bytes');
  assert.equal(accepts(contentTextSchema, `${accented}x`), false, 'un byte más y se rechaza');

  // Unicode bien formado: sin surrogates sin pareja.
  assert.equal(accepts(contentTextSchema, 'lone-\uD800'), false, 'surrogate sin pareja');
  assert.equal(accepts(contentTextSchema, 'ok-😀'), true, 'emoji completo');
});

test('rutas locales y URLs administrativas', () => {
  assert.equal(accepts(localPathSchema, '/home/user/pkg'), true);
  assert.equal(accepts(localPathSchema, 'relative/path'), true);
  assert.equal(accepts(localPathSchema, 'with\nnewline'), false);
  assert.equal(accepts(localPathSchema, ''), false);

  assert.equal(accepts(httpsUrlSchema, 'https://example.org/repo.git'), true);
  assert.equal(accepts(httpsUrlSchema, 'https://user:pass@example.org/repo.git'), false, 'sin credenciales');
  assert.equal(accepts(httpsUrlSchema, 'http://example.org/repo.git'), false, 'solo https');
  assert.equal(accepts(httpsUrlSchema, 'file:///etc/passwd'), false);
  assert.equal(accepts(httpsUrlSchema, 'ssh://git@example.org/repo.git'), false);
});

test('preferencias: enteros acotados', () => {
  assert.equal(
    accepts(profilePreferencesSchema, { explanation_detail: 'adaptive', preferred_session_minutes: 25 }),
    true,
  );
  assert.equal(
    accepts(profilePreferencesSchema, { explanation_detail: 'expert', preferred_session_minutes: 25 }),
    false,
    'enum de detalle cerrado',
  );
  assert.equal(
    accepts(profilePreferencesSchema, { explanation_detail: 'adaptive', preferred_session_minutes: 0 }),
    false,
  );
  assert.equal(
    accepts(profilePreferencesSchema, { explanation_detail: 'adaptive', preferred_session_minutes: 1.5 }),
    false,
    'enteros',
  );
  assert.equal(
    accepts(profilePreferencesSchema, { explanation_detail: 'adaptive', preferred_session_minutes: Infinity }),
    false,
    'números finitos',
  );
});

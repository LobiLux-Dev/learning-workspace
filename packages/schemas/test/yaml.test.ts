/**
 * Parser YAML 1.2 estricto §4: aliases, tags, claves duplicadas, multidocumento,
 * directivas, límites de tamaño/profundidad y claves de defensa de prototipo.
 *
 * CF04: datos inertes (`env`, `include`, `command`...) son contenido, no
 * directivas; la forma Unicode NFD de un texto libre se preserva.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import {
  notebookManifestSchema,
  parseYaml,
  parseYamlDocument,
  resourceCatalogSchema,
  safeParseYaml,
  safeParseYamlDocument,
  YAML_DANGEROUS_KEYS,
  YamlValidationError,
  type YamlIssueCode,
} from '../dist/index.js';
import { readFixture } from './helpers.ts';

/** Esquema mínimo para leer un valor suelto sin entrar en el dominio. */
const scalarStringSchema = z.object({ value: z.string() }).strict();

function issueCodes(source: string): YamlIssueCode[] {
  const result = safeParseYamlDocument(source);
  if (result.ok) return [];
  return result.issues.map((issue) => issue.code);
}

function codeOfFixture(name: string): YamlIssueCode[] {
  return issueCodes(readFixture(`invalid/yaml/${name}`));
}

test('ataques YAML del fixture: cada uno con su código', () => {
  assert.ok(codeOfFixture('duplicate-keys.yaml').includes('DUPLICATE_KEY'));
  assert.ok(codeOfFixture('aliases.yaml').includes('ALIAS_NOT_ALLOWED'));
  assert.ok(codeOfFixture('aliases.yaml').includes('DANGEROUS_KEY'), 'el merge key << se rechaza');
  assert.ok(codeOfFixture('custom-tag.yaml').includes('TAG_NOT_ALLOWED'));
  assert.ok(codeOfFixture('binary-tag.yaml').includes('TAG_NOT_ALLOWED'));
  assert.ok(codeOfFixture('multidocument.yaml').includes('MULTI_DOCUMENT'));
  assert.ok(codeOfFixture('deep-nesting.yaml').includes('NESTING_TOO_DEEP'));
  assert.ok(codeOfFixture('dangerous-keys.yaml').includes('DANGEROUS_KEY'), 'claves de prototipo');
  assert.ok(codeOfFixture('non-scalar-key.yaml').includes('NON_SCALAR_KEY'));
});

test('YAML 1.2 efectivo: directiva 1.1 u otra no soportada se rechaza', () => {
  const yaml11 = '%YAML 1.1\n---\nvalue: yes\n';
  const codes = issueCodes(yaml11);
  assert.ok(codes.includes('YAML_VERSION_UNSUPPORTED'), codes.join(','));
  // Y, crucialmente, `yes` en 1.1 sería `true`: el contrato exige 1.2.
  assert.notDeepEqual(issueCodes(yaml11), []);

  const yaml12 = '%YAML 1.2\n---\nvalue: yes\n';
  const parsed = safeParseYamlDocument(yaml12);
  assert.equal(parsed.ok, true, 'YAML 1.2 explícito se acepta');
  if (parsed.ok) assert.deepEqual(parsed.value, { value: 'yes' }, 'yes sigue siendo texto');

  assert.ok(issueCodes('%YAML 2.0\n---\na: 1\n').includes('YAML_VERSION_UNSUPPORTED'));
  assert.ok(
    issueCodes('%TAG ! tag:example.com,2000:\n---\nvalue: 1\n').includes('TAG_DIRECTIVE_NOT_ALLOWED'),
    'sin reetiquetado de tags',
  );
});

test('datos inertes son contenido: no se expande ni se ejecuta nada', () => {
  // 1. El YAML layer acepta palabras de contenido; no son directivas.
  const inertYaml = [
    'schema_version: "1.0"',
    'extensions:',
    '  org.example:config:',
    '    env: production',
    '    include: [other.yaml, more.yaml]',
    '    command: "rm -rf /"',
    '    process: {name: node, pid: 1}',
    '    eval: "process.exit(1)"',
    '',
  ].join('\n');
  const document = safeParseYamlDocument(inertYaml);
  assert.equal(document.ok, true, 'el parser no prohíbe palabras de contenido');
  if (!document.ok) return;

  // 2. El esquema de dominio las acepta: son JSON bajo una clave con namespace,
  //    y por YAML y por objeto inline (JSON) se validan igual.
  const inertExtensions = {
    'org.example:config': {
      env: 'production',
      include: ['other.yaml'],
      command: 'rm -rf /',
      process: { name: 'node' },
      eval: 'process.exit(1)',
    },
  };
  const fixtureYaml = readFixture('notebooks/electronics/notebook.yaml');
  const manifest = parseYaml(fixtureYaml, notebookManifestSchema);
  const viaObject = { ...manifest, extensions: inertExtensions };
  assert.equal(notebookManifestSchema.safeParse(viaObject).success, true, 'objeto inline equivalente');

  assert.match(fixtureYaml, /extensions: \{\}/);
  const yamlWithInert = fixtureYaml.replace(
    'extensions: {}',
    'extensions:\n  org.example:config:\n    env: production\n    command: "rm -rf /"',
  );
  const viaYaml = parseYaml(yamlWithInert, notebookManifestSchema);
  assert.deepEqual(
    { ...viaYaml, extensions: inertExtensions },
    viaObject,
    'YAML y JSON producen el mismo dato',
  );

  // 3. Nada se interpreta: los placeholders quedan literales.
  assert.deepEqual(parseYaml('value: "${HOME} && whoami"\n', scalarStringSchema), { value: '${HOME} && whoami' });
  assert.deepEqual(parseYaml('value: "`touch pwned`"\n', scalarStringSchema), { value: '`touch pwned`' });

  // 4. Una clave de dominio prohibida es un problema del esquema, no del parser.
  const parsedTopLevelCommand = safeParseYamlDocument('command: "ls"\n');
  assert.equal(parsedTopLevelCommand.ok, true, 'el parser acepta la clave');
  const domainReject = safeParseYaml('command: "ls"\n', scalarStringSchema);
  assert.equal(domainReject.ok, false, 'el esquema estricto la rechaza');

  // 5. La lista de defensa es corta: prototipo y merge, nada más.
  assert.deepEqual([...YAML_DANGEROUS_KEYS].sort(), ['<<', '__proto__', 'constructor', 'prototype']);
});

test('límites: 2 MiB, caracteres de control, Unicode inválido y documento vacío', () => {
  const big = `text: ${'a'.repeat(2 * 1024 * 1024)}\n`;
  assert.ok(issueCodes(big).includes('SOURCE_TOO_LARGE'));

  const exact = `text: ${'a'.repeat(2 * 1024 * 1024 - 12)}\n`;
  assert.deepEqual(issueCodes(exact), [], 'exactamente 2 MiB se acepta');

  assert.ok(issueCodes('text: "has\u0000nul"\n').includes('SOURCE_HAS_CONTROL_CHARS'));
  // Surrogate sin pareja en la fuente.
  assert.ok(issueCodes('text: "lone-\uD800"\n').includes('SOURCE_HAS_LONE_SURROGATE'));
  // Surrogate producido por un escape convertido.
  assert.ok(issueCodes('text: "\\ud800"\n').includes('VALUE_HAS_LONE_SURROGATE'));
  assert.ok(issueCodes('').includes('YAML_SYNTAX'));
  assert.ok(issueCodes('# solo comentario\n').includes('YAML_SYNTAX'));
  assert.ok(issueCodes('a:\n\t- 1\n').includes('YAML_SYNTAX'));
  assert.ok(issueCodes('a: [1, 2\n').includes('YAML_SYNTAX'));
  assert.deepEqual(issueCodes('---\nschema_version: "1.0"\n'), [], 'un solo documento con marcador');
});

test('CF04: la forma Unicode NFD del texto libre se preserva (no se normaliza)', () => {
  const nfd = 'e\u0301'; // e + combining acute
  assert.notEqual(nfd, nfd.normalize('NFC'));
  const parsed = safeParseYamlDocument(`description: "${nfd}"\n`);
  assert.equal(parsed.ok, true, 'el YAML NFD es aceptado');
  if (!parsed.ok) return;
  const value = (parsed.value as { description: string }).description;
  assert.equal(value, nfd, 'bytes preservados');
  assert.equal(value.length, 2, 'no se convierte a é precompuesto');

  // El esquema de contenido también lo admite: solo los paths exigen NFC (§3.2).
  const ok = resourceCatalogSchema.safeParse({
    schema_version: '1.0',
    resources: [{ id: 'nota', path: 'notas/lectura.md', media_type: 'text/markdown', title: `Lectura ${nfd}` }],
    extensions: {},
  });
  assert.equal(ok.success, true, 'descripción NFD válida');

  // ... pero un path NFD no es portable.
  const badPath = resourceCatalogSchema.safeParse({
    schema_version: '1.0',
    resources: [{ id: 'nota', path: `notas/leccio\u0301n.md`, media_type: 'text/markdown', title: 'x' }],
    extensions: {},
  });
  assert.equal(badPath.success, false, 'path NFD rechazado por portablePathSchema');
});

test('parseYaml combina parser estricto y esquema de dominio', () => {
  const valid = readFixture('notebooks/electronics/notebook.yaml');
  const manifest = parseYaml(valid, notebookManifestSchema);
  assert.equal(manifest.schema_version, '1.0');

  const withExtra = `${valid}\nsurprise: true\n`;
  const result = safeParseYaml(withExtra, notebookManifestSchema);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.issues[0]?.code, 'SCHEMA_MISMATCH');
    assert.match(result.issues[0]?.message ?? '', /Unrecognized key/);
  }

  // Un problema de YAML se detecta antes que el esquema.
  const duplicated = `${valid}\nidentity:\n  package_uid: "019a3dd5-4a10-7a90-8eef-3174e0386931"\n`;
  const duplicatedResult = safeParseYaml(duplicated, notebookManifestSchema);
  assert.equal(duplicatedResult.ok, false);
  if (!duplicatedResult.ok) {
    assert.equal(duplicatedResult.issues[0]?.code, 'DUPLICATE_KEY');
  }

  // Claves de dominio prohibidas por el esquema, no por el parser.
  const dangerousDomain = `${valid}\ncommand: "ls"\n`;
  const dangerousResult = safeParseYaml(dangerousDomain, notebookManifestSchema);
  assert.equal(dangerousResult.ok, false, 'la clave command sobra en el manifiesto (unknown key)');
  if (!dangerousResult.ok) assert.equal(dangerousResult.issues[0]?.code, 'SCHEMA_MISMATCH');
});

test('YamlValidationError expone todos los diagnósticos', () => {
  try {
    parseYamlDocument(readFixture('invalid/yaml/multidocument.yaml'));
    assert.fail('debió rechazar el multidocumento');
  } catch (error) {
    assert.ok(error instanceof YamlValidationError);
    assert.equal(error.issues[0]?.code, 'MULTI_DOCUMENT');
    assert.match(error.message, /MULTI_DOCUMENT/);
  }

  const issues = safeParseYamlDocument(readFixture('invalid/yaml/aliases.yaml'));
  assert.equal(issues.ok, false);
  if (!issues.ok) {
    assert.ok(issues.issues.length >= 2, 'reporta alias y merge key');
    assert.ok(issues.issues.every((issue) => typeof issue.path === 'string'));
  }
});

test('los documentos válidos del fixture convierten a datos planos', () => {
  const value = parseYamlDocument('a: 1\nb:\n  - x\n  - y\nc: null\nd: true\n');
  assert.deepEqual(value, { a: 1, b: ['x', 'y'], c: null, d: true });

  // Los anchors sin alias no crean grafo: solo el alias se rechaza.
  assert.deepEqual(issueCodes('a: &ancla 1\nb: 2\n'), []);
});

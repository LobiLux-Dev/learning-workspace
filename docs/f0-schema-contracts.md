# F0 — Contratos de `packages/schemas`

**Fecha:** 2026-10-25 · **Ámbito:** `packages/schemas/src/**`, `packages/schemas/test/**`,
`packages/schemas/scripts/**`, `fixtures/contracts/**`. Este documento fija shapes, casing,
límites e invariantes de la capa de contratos tras las correcciones CF03–CF06 de
[f0-compatibility-findings.md](f0-compatibility-findings.md). No modifica norma, no autoriza
F1 y no añade servicios.

## 1. Autoridad y derivación

- **Única fuente de verdad:** los esquemas Zod. No hay DTOs paralelos ni especificación
  manual duplicada. `schemaRegistry` (nombre PascalCase → esquema) es la entrada del
  generador y del registro público.
- **JSON Schema derivado, nunca autoridad:** `npm run schemas:generate` escribe
  `packages/schemas/generated/*.schema.json` (gitignored), draft 2020-12, determinista
  (claves ordenadas; dos corridas seguidas producen bytes idénticos). Hoy: **125 documentos**,
  **87 con `x-runtime-validation`**, **43 con `x-input-audience`**.
- **Anotaciones honestas:**
  - `x-runtime-validation` = invariante que JSON Schema **no** expresa (DAG, cobertura de
    anchors 0..max, `hints_used = servidas + declaradas`, hashes, límites en bytes, reglas
    portables, cálculo de Core…). JSON Schema no se usa jamás como única validación de esos
    campos.
  - `x-input-audience: llm-domain | administrative-local` = audiencia del input (§8.2). Un
    test verifica que ningún input de agente exponga `actor`, `role`, `root`,
    `workspaceRoot`, `approvalToken`, `sql` o `shell`.
- **Dependencias usadas:** `zod@4.6.7`, `yaml@2.9.1`, `semver@7.8.5`,
  `unicode-case-folding@1.1.2` (paths), `json-canonicalize@3.0.1`, `bcp-47@2.1.2`,
  `spdx-license-ids@3.0.24`. Sin red en runtime.

## 2. Casing

| Superficie | Casing | Ejemplo |
|---|---|---|
| Documentos YAML/DTOs de dominio y vistas | `snake_case` | `release_id`, `content_digest`, `score_bps` |
| Inputs de comando (`*Input`) y envelopes `Mutation` | `camelCase` | `learnerUid`, `expectedRevisions`, `idempotencyKey` |
| Nombres de registro/DTOs en `schemaRegistry` | `PascalCase` | `NotebookManifest`, `MasteryView` |
| Códigos de error/diagnóstico | `UPPER_SNAKE` | `INVALID_TRANSITION`, `JSON_CYCLE` |

Un test comprueba que **todo** input (agente y administrativo) usa campos camelCase.

## 3. Formas clave (CF01, CF02, §4.1)

- **`CatalogSourceRef = { resource_id, digest }`** — referencias dentro de un banco
  **publicado**: nunca llevan `release_id`, porque ese UUID solo existe en cada instalación
  local. **`CatalogItemDefinition`** es el ítem del banco con esas refs. `ItemCatalog` usa
  `CatalogItemDefinition`.
- **`ItemDefinition` / `Item` (persistidos o propuesta vinculada)** siguen exigiendo las refs
  **completas** `{ release_id, resource_id, digest }` de Portfolio. El Core futuro fija el
  `release_id` de la inscripción al preparar el ítem y verifica el digest contra el snapshot;
  no acepta un UUID de instalación suministrado por el autor.
- **`metadata.license_files`**: mapa opcional `{ 'LicenseRef-...': 'ruta/portable.txt' }`.
  - `metadata.license` LicenseRef sin entrada → el manifiesto no valida (superRefine).
  - LicenseRef en `resources[].license` o `assets[].license` sin entrada →
    `LICENSE_REF_UNDECLARED` en `validateNotebookContracts`.
  - **F0 no comprueba existencia ni bytes** de ese texto: lo hace F2 contra el snapshot.
- **`validateNotebookContracts({manifest, resources, curriculum?, assets?, itemBanks?})`**:
  - `itemBanks` es un **mapa `{ path declarado: catálogo }`**, no una colección anónima.
    Cada path declarado en `capabilities.*_items_path` exige su catálogo
    (`MISSING_ITEM_BANK`); un banco sin path declarado (`UNDECLARED_ITEM_BANK`) o una
    entrada que no es mapa (`INVALID_BANKS_MAP`) se rechaza; `definition_id` debe ser
    **único entre todos los catálogos** (`DUPLICATE_ID`) para que `PrepareItem` con
    `source=catalog` no acepte un id ambiguo.
  - Además: entrypoint ∈ catálogo, refs de módulos/ítems a recursos y skills existentes,
    unicidad global de paths con colisión por case-fold Unicode, y licencias LicenseRef
    declaradas.
- **Códigos de contrato (18):** `SCHEMA_INVALID`, `ENTRYPOINT_MISSING`, `DUPLICATE_ID`,
  `DUPLICATE_PATH`, `PATH_COLLISION`, `PATH_NOT_PORTABLE`, `UNDECLARED_ASSETS`,
  `MISSING_ASSETS`, `UNDECLARED_CURRICULUM`, `MISSING_CURRICULUM`, `UNDECLARED_ITEM_BANK`,
  `MISSING_ITEM_BANK`, `INVALID_BANKS_MAP`, `UNKNOWN_RESOURCE_REF`, `UNKNOWN_SKILL_REF`,
  `SKILL_NOT_COVERED`, `PREREQUISITE_CYCLE`, `LICENSE_REF_UNDECLARED`.

## 4. Garantía estructural de validación combinada (CF03)

`ok: true` implica, por construcción y no por convención:

1. La **pasada de paths** recorre los datos crudos (manifiesto, recursos, assets,
   `license_files`) y reporta cada path con notación normalizada `a[0].b`.
2. El conversor de errores Zod **solo omite** un diagnóstico si la pasada de paths ya
   reportó exactamente ese `document` + `path`; todo lo demás se emite (`SCHEMA_INVALID` o
   `PATH_NOT_PORTABLE` para campos de path).
3. Si un fallo de esquema no produjera ningún issue emitido ni estuviera cubierto, se emite
   un `SCHEMA_INVALID` de respaldo: un fallo de esquema **nunca** puede convertirse en éxito.

Regresiones cubiertas: `resources_manifest` = 42 / `null` / ausente, paths de recursos y
assets no string, combinaciones de varios fallos, fallos que no son de path, con
`NotebookManifest.safeParse(...) === false` verificado en paralelo.

## 5. YAML estricto (§4, CF04)

`parseYaml(source, schema)` / `safeParseYaml` / `parseYamlDocument` sobre `yaml@2.9.1`:

- **YAML 1.2 efectivo:** directiva `%YAML` distinta de `1.2` → `YAML_VERSION_UNSUPPORTED`;
  directiva `%TAG` → `TAG_DIRECTIVE_NOT_ALLOWED` (cambiaría la resolución de `yes`/`on`…).
- Rechazos: multidocumento (`MULTI_DOCUMENT`), aliases (`ALIAS_NOT_ALLOWED`), merge `<<` y
  claves de prototipo `__proto__`/`constructor`/`prototype` (`DANGEROUS_KEY`), tags fuera del
  esquema central (`TAG_NOT_ALLOWED`), claves duplicadas (`DUPLICATE_KEY`), claves no
  escalares (`NON_SCALAR_KEY`), profundidad > 32 (`NESTING_TOO_DEEP`), fuente > 2 MiB
  (`SOURCE_TOO_LARGE`), caracteres de control en la fuente (`SOURCE_HAS_CONTROL_CHARS`),
  surrogate sin pareja en la fuente (`SOURCE_HAS_LONE_SURROGATE`) o producido por un escape
  (`VALUE_HAS_LONE_SURROGATE`).
- **No se normaliza ni se rechaza texto libre por su forma Unicode:** una descripción NFD se
  acepta y se preserva byte a byte. El **NFC solo se exige en paths portables** (§3.2, hecho
  en `paths.ts`).
- **Sin lista de palabras prohibidas:** `env`, `include`, `command`, `process`… son datos
  inertes válidos (p. ej. dentro de `extensions`). El parser **no expande ni ejecuta** nada:
  `${HOME}` y backticks quedan literales. Prohibir nombres de contenido ≠ impedir ejecución.
- Sin ejecución: el parser solo produce datos; ningún tag habilita módulos ni comandos.

## 6. Autoridad canónica (CF05)

`canonical.ts` es la **única** implementación (Core delega aquí; este módulo no depende de
Core):

- `canonicalJson(value)` = guard estricto + `json-canonicalize@3.0.1` (RFC 8785). El guard
  rechaza, con **`code` y `path` estables**: `JSON_CYCLE`, `JSON_NOT_PLAIN`, `JSON_PROTO_KEY`,
  `JSON_TOO_DEEP` (profundidad > **256**, `MAX_CANONICAL_JSON_DEPTH`),
  `JSON_LONE_SURROGATE` (valores y claves), `JSON_NON_FINITE`, `JSON_UNDEFINED`,
  `JSON_BIGINT`, `JSON_SYMBOL`, `JSON_FUNCTION`, `JSON_SYMBOL_KEY`, `JSON_ACCESSOR`
  (getters **sin ejecutarlos**), `JSON_NON_ENUMERABLE`, `JSON_ARRAY_PROTOTYPE`,
  `JSON_ARRAY_EXTRA_KEY`, `JSON_ARRAY_HOLE`. `CanonicalJsonError { code, path }` y
  `InventoryError { code, path }` son la API pública de error.
- `validateInventoryEntries(value, { requireSorted? })`: claves exactas
  `path,size,sha256`, path portable compartido, sin duplicados ni colisiones por case-fold,
  `size` entero seguro ≥ 0, sha256 hex, **≤ 2000 archivos, ≤ 100 MiB totales, ≤ 2 MiB por
  texto (`.md/.markdown/.yaml/.yml/.txt`), ≤ 10 MiB por imagen (`.png/.jpg/.jpeg/.webp`)**.
  **Conserva el orden de entrada** para que Core exija él mismo el orden estricto
  (`INVALID_INVENTORY_ORDER`); `inventoryBytes` ordena **solo por bytes UTF-8** y serializa
  claves exactamente `path,size,sha256` sin salto final.
- `snapshotContentDigest = SHA256(UTF8("learning-snapshot-v1\n") || inventory_bytes)`,
  usando las constantes normativas (sin literales repetidos). Los vectores publicados
  (incluidos los calculados con `sha256sum` y los de Python) siguen idénticos.
- Códigos de inventario (7): `INVALID_INVENTORY`, `INVALID_PATH`, `PATH_COLLISION`,
  `SNAPSHOT_FILE_LIMIT`, `SNAPSHOT_SIZE_LIMIT`, `FILE_SIZE_LIMIT`,
  `INVALID_INVENTORY_ORDER`.

## 7. BCP 47 (CF06)

`bcp47.ts` sobre `bcp-47@2.1.2`:

- `parse(tag, { forgiving: false, normalize: false, warning })`: gramática estricta,
  **sin normalización legacy** (no se reescriben `i-ami`/`art-lojban`), y **sin
  `bcp-47-normalize`** (que convertiría `en-US` → `en`, prohibido por la spec).
- Subtags únicos (variantes y singletons duplicados rechazados), longitud ≤ **255**
  (no 35 arbitrario), y **igualdad exacta con la forma canónica** reconstruida desde el AST
  (idioma/variantes/uso privado minúsculas, script Titlecase, región MAYÚSCULAS).
- Por eso `es-MX`, `zh-Hant-TW`, `en-x-a` valen; `ES-mx`, `EN-us`, `en-1996-US`,
  `en-US-Latn`, `en-a-foo-Latn`, `en-u-ca-gregory-US` no. `canonicalBcp47Tag(tag)` devuelve
  el tag solo si es canónico y `null` en cualquier otro caso (nunca devuelve una forma
  normalizada para comparar en silencio).

## 8. Licencias SPDX (CF02)

`spdx.ts` carga con `createRequire` (retorno `unknown` + guard en tiempo de ejecución) las
listas estáticas del paquete: **708 vigentes + 26 deprecados**. `licenseSchema` acepta solo
ese vocabulario o `LicenseRef-*` bien formado; un nombre inventado (`MyMadeUpLicense-1.0`)
se rechaza — **no se atribuye a SPDX**. Ser SPDX no prueba derechos de uso.

## 9. Vistas de solo lectura (§9.2)

Todas `strict()`, `snake_case`, compuestas con esquemas existentes, sin métodos ni motor:

| Vista | Shape mínimo | Nota |
|---|---|---|
| `InstalledNotebook` | `release_id, package_uid, package_id, name, version, content_digest, digest_algorithm, state, verification_status, install_path, revision, installed_at` | `package_id` no prueba autoría |
| `VerificationReport` | `release_id, state, verification_status, content_digest, checked_file_count, findings[]` | `VerificationFinding {kind: missing\|extra\|modified, path, expected_sha256?, observed_sha256?, observed_size?}`; **solo informa**, no repara |
| `EnrollmentView` | `enrollment, active_session|null, assignments[]` | Core garantiza ≤1 sesión active |
| `DiagnosticSession` | `session, enrollment_uid, items[], unavailable_reason?` | sin banco: razón explícita, nunca diagnóstico inventado |
| `ServedItem` | `item_uid, enrollment_uid, release_id, assignment_uid, snapshot` | **sin `solution` ni rúbrica** |
| `Hint` | `enrollment_uid, release_id, session_uid, item_uid, ordinal≥1, hint_snapshot, provenance` | `ordinal` lo asigna Core |
| `MasteryState` | `enrollment_uid, skill_id, release_id, score_bps(0..10000\|null), evidence_count, context_count, coverage_gap_bps, label, historical_attempt_count, algorithm_version, through_event_seq` | **no calcula**: forma del resultado de `mastery-rules-v1` |
| `MasteryView` | `enrollment_uid, watermark, stale, rows[]` | lectura pura (§7.3) |
| `RebuildReport` | `enrollment_uid, run_uid, algorithm_version, through_event_seq, row_count, result_digest` | sin `run_uid`/fecha dentro del digest |
| `RecoveryReport` | `enrollment_uid, pending_operations[], failed_operations[], current_session, current_assignment, prepared_item_uids[], ungraded_attempt_uids[]` | no regenera ni reaprueba |
| `DoctorReport` | `ok, findings[]` (`DoctorFinding {severity, code UPPER_SNAKE, message, path?, ids?}`) | solo lectura: no reconcilia, borra ni repara |

## 10. Límites aplicados en la frontera

| Límite | Valor | Dónde |
|---|---|---|
| Fuente YAML | 2 MiB | `parseYaml` |
| Profundidad YAML | 32 niveles | `parseYaml` |
| Texto de contenido | 2 MiB **en bytes UTF-8** + Unicode bien formado | `contentTextSchema` |
| JSON de contrato (extensions/solución/respuesta) | profundidad ≤ 256, sin ciclos, JSON estricto | `jsonValueSchema` (guard de la autoridad, sin `z.json()` recursivo) |
| Input `Mutation` | ≤ 2 MiB agregados de bytes JSON estricto | `mutationEnvelope` |
| Tag BCP 47 | ≤ 255 caracteres | `bcp47Schema` |
| `extensions` | ≤ 64 claves con namespace | `extensionsSchema` |
| Inventario/snapshot | ≤ 2000 archivos, ≤ 100 MiB, texto ≤ 2 MiB, imagen ≤ 10 MiB | `validateInventoryEntries` |
| Listas de contrato | ≤ 10 000 elementos | arrays de catálogos/eventos/vistas |

## 11. Invariantes que siguen siendo de Core (F1 en adelante)

Los esquemas acotan **forma**; esto queda fuera de F0 y se lista aquí a propósito:

- Transiciones de agregados (`INVALID_TRANSITION`), `revision`/CAS (`REVISION_CONFLICT`) e
  idempotencia (`IDEMPOTENCY_CONFLICT`) — el envelope solo exige la forma de
  `idempotencyKey`/`expectedRevisions`.
- Que `expectedRevisions` contenga **cada** agregado afectado (depende de la DB).
- Vinculación de `CatalogSourceRef` → `release_id` local y verificación de `digest` contra
  los bytes del snapshot; verificación de hash de inventario (`ARTIFACT_DIVERGED`).
- Existencia y bytes de los textos de `license_files` (F2) y permisos de copia/traducción.
- Unicidad de una sesión `active` por enrollment; pertenencia de assignments/items/intentos
  al enrollment; orden por `event_seq`; inmutabilidad de hechos.
- Cálculo de `mastery-rules-v1` (ventana 20, etiquetas, readiness), construcción de
  reportes y cualquier permiso/autorización/actor: el `CommandContext` no existe en schemas.
- Concurrencia, bloqueo de workspace, publicación recuperable y cuarentena.

## 12. Qué no toca esta capa

- Sin persistencia, sin SQL, sin motor de scoring, sin clock, sin filesystem: las funciones
  son puras sobre datos.
- **CommonMark:** el parser con AST está implementado en `packages/core` (otro agente, con
  `mdast-util-from-markdown` instalado); no se duplica aquí. Schemas solo acota el formato de
  hrefs de traducción (`markdownHrefSchema`: sin esquemas, queries ni paths absolutos).
- No se edita `paths.ts` (otro agente): se importa y reexporta tal cual
  (`portablePathSchema`, `assertPortablePath`, `assertNoPortablePathCollisions`,
  `caseFoldPath`, `hasLoneSurrogate`).

## 13. Integración cerrada

Los conflictos transitorios de imports/tipado en Core fueron resueltos. Core delega canonicalización y metadatos de inventario en esta autoridad, preservando sus errores públicos; las cuotas también se aplican al conjunto virtual antes de decodificar/analizar. No queda un fallo de build por esos conflictos.

`metadata.license_files` exige una ruta portable terminada en `.txt`, sin distinguir mayúsculas, para cada texto declarado. F0 no acredita existencia ni contenido físico: corresponde a F2.

## 14. Verificación F0 de esta capa

- `tsc -b packages/schemas` y `tsc -p tsconfig.tests.json --noEmit` limpios con
  `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noUnused*`,
  `verbatimModuleSyntax`.
- `npm run schemas:generate` → 125 documentos, bytes idénticos entre corridas.
- `npm test` integrado → **200/200**, incluyendo CF03–CF06, bancos por path, licencias, límites, AJV 2020, vectores, interoperabilidad con Core, DAG profundo y regresiones del spike.
- Resultados finales y límites comprobados: [f0-verification.md](f0-verification.md). No se atribuye a esta capa validación de estado académico persistido ni autorización.

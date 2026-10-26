# Snapshot test vectors — `snapshot-sha256-v1`

**Fecha:** 2026-10-25
**Normativa:** especificación §3.2.4 (digest canónico) y §3.2.3 (rutas portables).
**Implementación:** `packages/core/src/digest.ts` (funciones puras `computeSnapshotDigest`, `parseInventory`, `serializeInventory`, `compareSnapshotPaths`).
**Vectores duplicados en:** `packages/core/test/digest.test.ts`.

Todos los valores de este documento se calcularon fuera de la implementación con
`node:crypto` (`sha256`) sobre los bytes descritos, y se fijaron como literales en
los tests: un cambio en el código que altere cualquiera de ellos hace fallar la
suite. Ningún test deriva su resultado esperado ejecutando la función bajo prueba.

## 1. Reglas de construcción

1. **Prefijo literal:** `learning-snapshot-v1\n` — UTF-8 hex `6c6561726e696e672d736e617073686f742d76310a` (termina en salto de línea `0x0A`, no CRLF).
2. **Inventario:** array JSON compacto UTF-8. Cada fila tiene **exactamente** las claves `path`, `size`, `sha256` en ese orden, sin espacios, sin salto final y sin ninguna otra clave. `size` es la longitud en **bytes** del archivo; `sha256` son 64 hexadecimales minúsculos.
3. **Orden:** las filas se ordenan por los **bytes UTF-8** de `path` (`Buffer.compare`), equivalente a orden por puntos de código Unicode — no por unidades UTF-16.
4. **Digest:** `content_digest = SHA256(UTF8("learning-snapshot-v1\n") || inventory_bytes)`, en hex minúsculo.
5. Las rutas se validan como portables (NFC, ≤ 240 bytes, sin `%`/`:`/`\`, sin colisiones de case-fold) **antes** de calcular nada; entradas inválidas producen error, no un digest.

## 2. Vectores

### V0 — snapshot vacío

| Campo | Valor |
|---|---|
| Entradas | `[]` (ninguna) |
| Bytes de inventario | `[]` (2 bytes: `5B 5D`) |
| `content_digest` | `9c6a5a9b2f046c0a1f97def3e3879f6fcc20ba613988f7cbd0b19f8244374416` |

### V1 — archivo ASCII único

| Campo | Valor |
|---|---|
| Entrada | `path = "index.md"`, bytes = `hello\n` (`68 65 6C 6C 6F 0A`, 6 bytes) |
| `sha256` del archivo | `5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03` |
| Inventario (literal) | `[{"path":"index.md","size":6,"sha256":"5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03"}]` |
| `content_digest` | `ed7e0327da791baa6bf5cb29561bffbed18d6c0963d3e471689e05f3c4f5e503` |

### V2 — orden de entrada, CRLF, UTF-8 y binario

Tres archivos entregados en orden arbitrario (el test los invierte y verifica el
mismo digest). Las rutas lógicas son relativas a la raíz del snapshot.

| path | bytes (descripción) | longitud | `sha256` |
|---|---|---|---|
| `index.md` | `# Índice\n` → hex `2320c38d6e646963650a` | 10 | `db48a003266f09ff3ecfdb7877ff9324e14ab558fbd699a7ccd12c02b5f18dfe` |
| `resources/ohms-law.md` | fixture `fixtures/content/digest/crlf.md` (CRLF, ver §3) | 54 | `b60601910c0082197067fc7a9df6c73b12842b29fc8a160d049c20637d23300c` |
| `assets/circuito-01.png` | PNG 1×1 raster (fixture, ver §3) | 70 | `4ff6ab670a58c14270e034e2090d9a432caa263a14e0a25785386b0c12f880b5` |

Inventario canónico (literal, una sola línea):

```text
[{"path":"assets/circuito-01.png","size":70,"sha256":"4ff6ab670a58c14270e034e2090d9a432caa263a14e0a25785386b0c12f880b5"},{"path":"index.md","size":10,"sha256":"db48a003266f09ff3ecfdb7877ff9324e14ab558fbd699a7ccd12c02b5f18dfe"},{"path":"resources/ohms-law.md","size":54,"sha256":"b60601910c0082197067fc7a9df6c73b12842b29fc8a160d049c20637d23300c"}]
```

| Campo | Valor |
|---|---|
| `content_digest` | `839eed34700a1c4c552a283fe8ba59954293692da53785a5c1f4dbb8b08a9464` |
| SHA-256 del inventario **sin** prefijo (debe diferir) | `f93272cd633ff0508ec309a85ca59a48cc9fdb33669ae6acd3c60d661689ea80` |

Notas: `size` de `resources/ohms-law.md` es 54 (los `\r\n` se conservan: no hay
conversión de fin de línea); `size` de `index.md` es 10 bytes, no 9 caracteres
(`Í` ocupa 2 bytes).

### V3 — ruta NFC UTF-8 y contenido multibyte

| Campo | Valor |
|---|---|
| Entrada | `path = "recursos/óhmica.md"` (NFC: `ó` = `C3 B3`), bytes = `V = I × R\n` → hex `56203d204920c39720520a` (11 bytes) |
| `sha256` del archivo | `e85eb61eb35bb9a2d094821f973b246f1a2015df373fb1f13bd4b6ec3b4dfb2a` |
| Inventario (literal) | `[{"path":"recursos/óhmica.md","size":11,"sha256":"e85eb61eb35bb9a2d094821f973b246f1a2015df373fb1f13bd4b6ec3b4dfb2a"}]` |
| `content_digest` | `dfd32bc5bf2005a2ae030efce37101964ae2a9ab77377a19f51c1b7c8ca55f80` |

La misma ruta descompuesta en Unicode (`o` + U+0301) **no** es aceptada: produce
`INVALID_PATH` (NFC obligatorio), nunca un segundo digest para el mismo nombre visible.

### V4 — colisiones y rechazos (sin digest)

| Entrada | Resultado |
|---|---|
| `["strasse.md", "straße.md"]` | `PATH_COLLISION` — `ß` pliega a `ss` con plegado Unicode completo |
| `["x.md", "x.md"]` | `PATH_COLLISION` (duplicado exacto) |
| `["Notes/Readme.md", "notes/readme.md"]` | `PATH_COLLISION` (solo difieren en mayúsculas) |
| `["\u212A.md", "k.md"]` (K = U+212A) | `INVALID_PATH` (`INVALID_PORTABLE_PATH`) — el signo Kelvin **no** es NFC (`NFC(U+212A) = "K"`), se rechaza en la comprobación NFC **antes** de considerar colisiones |
| `["K.md", "k.md"]` ASCII | `PATH_COLLISION` — es la forma NFC de un nombre Kelvin; el plegado completo sigue aplicándose a nombres válidos |
| `["../escape.md"]` | `INVALID_PATH` |
| `["recursos/o\u0301hmica.md"]` | `INVALID_PATH` (no NFC) |
| `["x?.md"]`, `["x*.md"]`, `["x\|.md"]`, `["x<.md"]`, `["x>.md"]`, `["x\".md"]` | `INVALID_PATH` — caracteres que Windows no admite en nombres de archivo |
| `["COM¹.md"]`, `["LPT².txt"]`, `["conin$"]`, `["CONOUT$.md"]`, `["NUL .txt"]` | `INVALID_PATH` — dispositivos reservados (los superíndices ¹²³ no pliegan a dígitos ASCII) y basename con espacio antes de la extensión |
| Orden de `compareSnapshotPaths("B.md","a.md")` | `< 0` (`0x42 < 0x61`); `compareSnapshotPaths("z.md","ä.md") < 0`; `compareSnapshotPaths("x\uE000.md","x😀.md") < 0` (orden de puntos de código, distinto del orden UTF-16) |

Además, `parseInventory` rechaza: claves distintas de exactamente
`path,size,sha256` (extras o faltantes), `size` no entero seguro o negativo,
`sha256` con mayúsculas o longitud distinta de 64, y cualquier fila fuera del
orden canónico (`INVALID_INVENTORY_ORDER`).

## 3. Límites normativos (pre-checks puros, no validación de release)

`computeSnapshotDigest`, `parseInventory` y `serializeInventory` aplican como
**pre-checks puros** los límites de spec §3.2.3, sin tocar disco ni decodificar
imágenes:

| Límite | Valor constante | Error |
|---|---|---|
| Archivos por snapshot | `MAX_SNAPSHOT_FILES = 2000` | `SNAPSHOT_FILE_LIMIT` |
| Tamaño total | `MAX_SNAPSHOT_BYTES = 104857600` (100 MiB) | `SNAPSHOT_SIZE_LIMIT` |
| Texto Markdown/YAML/licencia | `MAX_TEXT_FILE_BYTES = 2097152` (2 MiB) | `FILE_SIZE_LIMIT` |
| Assets raster | `MAX_ASSET_FILE_BYTES = 10485760` (10 MiB) | `FILE_SIZE_LIMIT` |
| Ruta portable | `MAX_PORTABLE_PATH_BYTES = 240` | `INVALID_PORTABLE_PATH` |
| Fuente Markdown (análisis) | `MAX_MARKDOWN_BYTES = 2097152` (2 MiB) | `MARKDOWN_TOO_LARGE` |

Composición: estos controles validan el snapshot/inventario que estas funciones
reciben o producen. **No** constituyen validación completa de una release —
allowlist de formatos, firmas/decodificación de imágenes, cruces con
manifiestos y límites de transporte (p. ej. 200 MiB / 60 s de captura Git)
pertenecen al instalador (F2). Formatos sin límite por archivo en esta capa
(p. ej. `.bin`) solo los rechaza la allowlist del instalador.

## 4. Bytes exactos de los fixtures

Los fixtures viven en `fixtures/content/` y sus bytes son contrato: las pruebas
los comparan literalmente. En Linux `git` no altera los finales de línea
(`core.autocrlf` sin activar); si un fixture cambia, los vectores de arriba dejan
de coincidir y la suite falla en lugar de aceptar bytes renormalizados.

### `fixtures/content/digest/crlf.md` — 54 bytes, finales CRLF

Contenido (`\r\n` mostrados como tales):

```text
# Vector CRLF\r\n\r\nContenido UTF-8: Índice, Ohm × R.\r\n
```

Hex completo:

```text
2320566563746f722043524c460d0a0d0a436f6e74656e69646f205554462d383a20c38d6e646963652c204f686d20c39720522e0d0a
```

`sha256 = b60601910c0082197067fc7a9df6c73b12842b29fc8a160d049c20637d23300c`.

### `fixtures/content/mini/assets/circuito-01.png` — 70 bytes, PNG raster 1×1

PNG válido (firma + IHDR + IDAT + IEND), sin dependencia de SVG ni sanitizador:

```text
89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489
0000000d49444154789c63f8cfc0f01f00050001ff89993d1d0000000049454e44
ae426082
```

`sha256 = 4ff6ab670a58c14270e034e2090d9a432caa263a14e0a25785386b0c12f880b5`.

### `fixtures/content/mini/` — paquete mínimo para pruebas de cierre de enlaces

| Archivo | Bytes | `sha256` | Finales de línea |
|---|---|---|---|
| `index.md` | 191 | `b74b23d14f971c1e35233c5b8801caebc0a442b111f4b6f7acd9f8323a849782` | LF |
| `resources/ohms-law.md` | 77 | `b94b8d6d1a942867c1dcc6a5da0ad54da517fb5ce2348ff1a9aa6ae6e61ed6c3` | LF |
| `assets/circuito-01.png` | 70 | `4ff6ab670a58c14270e034e2090d9a432caa263a14e0a25785386b0c12f880b5` | n/a (binario) |

`index.md` enlaza `resources/ohms-law.md#ley-de-ohm` (fragmento válido del
encabezado `## Ley de Ohm`), incrusta `assets/circuito-01.png` y contiene un
enlace HTTPS que solo genera advertencia `REMOTE_LINK`; el cierre completo desde
`index.md` son exactamente esos tres archivos.

### `fixtures/content/licenses/CC0-1.0.txt` — dedicación CC0 (texto de licencia)

Dedicación canónica CC0 1.0 Universal (texto SPDX `CC0-1.0.txt`), en ASCII con
finales LF, añadida **fuera** de `mini/` y `digest/` para no alterar los bytes
de los tres fixtures dorados anteriores. Su papel es el de texto de licencia
`LicenseRef-*` de spec §4.1: es allowlistado (`.txt`), inerte y sin
construcciones Markdown estructurales.

| Campo | Valor |
|---|---|
| Bytes | 7048 (ASCII puro, finales LF) |
| `sha256` | `a2010f343487d3f7618affe54f789f5487602331c0a8d03f49e9a7c547cf0499` |

# Fixtures de contratos (F0)

Datos **íntegramente sintéticos** para probar los contratos de `packages/schemas`.
No contienen contenido de terceros, respuestas reales de modelos ni datos personales.

## Estructura

| Ruta | Contenido |
|---|---|
| `notebooks/electronics/` | Paquete con currículo, assets e item bank (fixture «Ohm» de la §14) |
| `notebooks/reference/` | Paquete **sin currículo** ni assets (AC16) |
| `portfolio/` | Exportaciones de perfil, inscripción, assignment y artifact (§5) |
| `academic/` | Rúbrica, ítem, intento, evaluación y decisión (§7) |
| `events/` | Eventos de ejemplo `NotebookInstalled`, `HintServed`, `AttemptSubmitted` (§6.2) |
| `commands/` | Envelopes `Mutation` de agente y administrativos (§9.2) |
| `invalid/yaml/` | YAML hostil: aliases, tags, claves duplicadas, multidocumento, anidamiento, `env`/`include`, claves no escalares, sin NFC |
| `vectors/` | Vectores publicados de JSON canónico RFC 8785 y de `content_digest` (`snapshot-sha256-v1`) |

## Garantías

- **Identificadores**: UUIDv7 reales (versión 7, variante RFC 4122), no placeholders.
- **Hashes**: SHA-256 calculados sobre los bytes reales de cada archivo. El
  `content_digest` de `vectors/snapshot-digest.json` se obtuvo con `sha256sum`
  (coreutils), no con la implementación probada.
- **`circuit-01.png`**: PNG sintético 64×48 generado para este repo (patrón de dos
  tonos, sin procedencia de terceros); su `sha256` del manifest corresponde a esos bytes.
- **Inventario**: `vectors/snapshot-inventory.json` describe exactamente los archivos de
  `notebooks/electronics/` en el orden y formato de §3.2.4 (claves `path,size,sha256`,
  sin salto final). Si se modifica un archivo del fixture, hay que regenerarlo.

## Uso

```bash
node --test packages/schemas/test/*.test.ts   # la suite carga estos archivos desde disco
npm run schemas:generate                      # JSON Schema derivados (gitignored)
```

`invalid/yaml/` **debe** ser rechazado: la suite falla si algún archivo de esa carpeta
llega a aceptarse.

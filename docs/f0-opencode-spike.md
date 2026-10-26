# Spike F0 — Integración real OpenCode V2 (aislado, tipado, con pins estrictos)

**Fecha:** 2026-10-25 (revisión posterior a auditoría)
**Plan:** `docs/implementation-plan.md` §F0
**Spec:** `docs/learning-workspace-spec-v0.1.md` §8.2, §9.1, §11
**Rutas autorizadas tocadas:** `spikes/opencode-v2/**`, este archivo. Ninguna otra (sin cambios en
root, manifests, locks, schemas, CLI ni normativa; sin commits).

> Fixture de datos ficticios únicamente. Proveedor = servidor efímero loopback (sin red externa).
> El gate de divulgación de **producto sigue cerrado**: no existe proveedor real ni integración
> de producto; F1 (grants de un uso) y los agentes pedagógicos quedan fuera.

## 1. Cómo ejecutar

```bash
npm run spike:opencode        # = node spikes/opencode-v2/run.mjs (launcher + runner tipado)
node --test spikes/opencode-v2/test/*.test.ts   # tests de regresión (runtime/env/sandbox/lógica)
npx tsc -p tsconfig.tests.json --noEmit         # typecheck raíz (incluye spikes/**/*.ts)
```

Salida: JSON en stdout y en `spikes/opencode-v2/results/latest.json` con `checks[]`
(`id`, `status: passed|blocked|failed`, `reason`, `details`), `pins`, `versions`, `fixtureProvider`.

**Códigos de salida:** `0` **solo si todos los checks están `passed`**; `1` si hay cualquier
`blocked` o `failed`; `2` si un pin no coincide (integración no iniciada), si el binario Node
fijado no existe o si el runner tiene un error inesperado. Un check `blocked` indica siempre que
la capacidad queda **deshabilitada**: nunca se habilita nada como sustituto para volver verde.

Hooks útiles: `F0_SPIKE_NODE24_BIN` (solo para tests) sobrescribe la ruta del binario Node fijado.

## 2. Versiones exactas verificadas

| Componente | Versión | Evidencia |
|---|---|---|
| Node del spike | `v24.22.1` exacto (host `v26.12.1`) | launcher re-ejecuta con el binario fijado; check `env.versions-exact`/`env.node24-runtime` |
| opencode CLI | `opencode v2.1.3` | `opencode --version` antes de importar el SDK |
| `@opencode/plugin` | `2.1.3` | `node_modules/.../package.json` antes de importar el SDK |
| `@opencode/client` | `2.1.3` | `node_modules/.../package.json` antes de importar el SDK |
| Paquete de proveedor | `@opencode/ai` `2.1.3` (`providers/openai-compatible`) | config fixture + `GET /api/model` |

## 3. Diseño (todo ejecutado de verdad)

### 3.1 Launcher con pins antes del SDK (`run.mjs`)

`run.mjs` ya no contiene lógica del spike: es un guardia pequeño que (1) verifica los cuatro
pines exactos, (2) garantiza el entorno permitido y (3) solo entonces importa `runner.ts`
(TypeScript nativo con *type stripping* de Node 24, sin `tsx`/`ts-node`).

- Si el proceso actual no es Node `24.22.1`, verifica el binario fijado y se **relanza con un
  entorno allowlist** (nunca reenviando el entorno heredado). Si el binario falta o no reporta
  la versión exacta → stderr + `exit 2`, sin importar el runner ni el SDK.
- `verifyPins()` se ejecuta antes de `import("./runner.ts")`: cualquier desajuste de
  Node/CLI/plugin/client → `exit 2` con el detalle `expected=… actual=…` y **sin iniciar
  servidor, cliente, sesiones ni modelo**.

### 3.2 Entorno: allowlist mínimo + regresión con centinelas

`buildAllowlistEnv()` copia **solo** `PATH` (prefijado con el directorio del Node fijado, de
forma idempotente) y claves fijas `LC_ALL`, `LANG`, `TZ`, `NO_COLOR`, `F0_FIXTURE_API_KEY`. Nada
más se hereda: sin `HOME`/`XDG` del llamador, sin credenciales cloud/modelo (`AWS_*`,
`OPENAI_*`, `ANTHROPIC_*`, `GITHUB_TOKEN`…), sin `HTTP(S)_PROXY`/`NO_PROXY`, sin `NODE_OPTIONS`
ni `LD_*`. El mismo allowlist alimenta al proceso runner y al `opencode serve` (que además recibe
`HOME`/`XDG_*` del sandbox).

Regresión ejecutada en la corrida real: el proceso padre se lanza con 6 centinelas
`F0_SENTINEL_*` (valores ficticios) más `HTTPS_PROXY`, `NODE_OPTIONS`, `LD_LIBRARY_PATH`,
`AWS_SECRET_ACCESS_KEY`, `OPENAI_API_KEY` y `ANTHROPIC_API_KEY` reales-pero-ficticios. El check
`env.allowlist-sentinels` reporta **solo booleanos** de dos procesos distintos: el runner
(`process.env`) y `opencode serve` (evidencia `env.sentinel` del plugin dentro de ese proceso).
Resultado: los 6 centinelas ausentes en ambos. Además se escanearon stdout/stderr/JSON y el
sandbox: **cero valores** de centinela en cualquier salida.

### 3.3 Sandbox: `mkdtemp` 0700, sin borrar rutas previas, logs 0600 y password redactada

- `fs.mkdtempSync("/tmp/opencode/f0-spike-")` + `chmod 0700`; **nunca** se reutiliza ni borra un
  directorio preexistente (se eliminó el `rmSync` previo sobre un path calculado por PID).
- Marcador de propiedad `.f0-spike-owned` con token aleatorio: `cleanupSandbox()` solo borra el
  directorio que creó en esta corrida (el test construye un objeto sandbox apuntando a un decoy
  y comprueba que se **rechaza**).
- `--keep-evidence` (flag explícito) conserva el sandbox en 0700; por defecto se borra al final
  y el informe registra `sandboxRemoved: true`.
- Log del serve con apertura `0600`; la línea `server password …` se mantiene en un buffer de
  líneas incompletas y se redacta **antes** de escribir al disco (`[REDACTED]`). El check
  `sandbox.isolation-permissions` comprueba modo 0700/0600, la ausencia de la password en el
  disco y que el decoy preexistente sobrevive a la limpieza (también cubierto por tests).
- Config **global del HOME falso** (`<sandbox>/.config/opencode/opencode.json`) con
  `update: "disable"` y `share: "disabled"` — en V2 el `update` de proyecto se ignora, así que
  se fija a nivel global. La config real del usuario ni se lee ni se escribe.

### 3.4 Proveedor fixture loopback

Servidor `http` efímero en `127.0.0.1` (`/v1/chat/completions`, `/v1/models`), conectado vía
`providers.f0fixture` con `package: "@opencode/ai/providers/openai-compatible"` y
`settings.baseURL` loopback. Cada request registra kind/tools/mensajes. El plugin inyecta
`x-f0-kind` en `http.request` para atribuir cada request a su flujo. Corrida final:
**45 requests → `primary:40, generate:1, compaction:2, title:2`**, 5 `permission.asked`,
10 `session.tool.failed`, 2 `session.compaction.failed`, 4 `session.execution.failed`.

### 3.5 Plugin spike (`plugin/index.ts`, tipado contra contratos compartidos)

- `ctx.tool.transform` → namespace **`f0`**, tool **`f0_probe`** con `{ codemode: false }`.
- El executor lee el **actor de runtime** (`sessionID`, `agent`, `messageID`, `callID`), calcula
  el SHA-256 con la misma función `spikeDigest()` que el runner y los tests, y llama
  `ctx.permission.assert({ action: "learning.approve", resources: ["<operation>:<sha256>"], save: [] … })`.
  `save` solo es no vacío en la sonda **adversarial** de patrones guardados (escenario de
  fixture, no un grant de Core de producto).
- `ctx.permission.hook("evaluate")` correlaciona evaluación↔assert (id + resources) y convierte
  `allow` efectivo en `deny` (§8.2). Un `deny` configurado no llega al hook (es final).
- `ctx.session.hook("context"|"compaction"|"generate"|"title")` aplica el gate y ** lanza
  excepción para detener el dispatch** cuando corresponde.
- Registra `env.sentinel` con **booleanos** de presencia (jamás valores).
- Control (`block.<flujo>`) y evidencia de divulgación (`consent.json`) se releen en cada
  invocación; validación de frontera compartida (`parseControl`/`parseConsent`/`parseEvidence`).

### 3.6 Gate de divulgación (§11), default-deny ejecutable

Sin `consent.json` → rechazo incondicional (`default-deny:no-disclosure-evidence`). Con evidencia
se exige: fixture, propósito `tutor`, no expirada, `providerID` coincidente, `baseURL` actual
loopback y destino listado. Cualquier destino no-loopback se rechaza **aunque esté aprobado en
la evidencia** (`remote-destination-rejected`), y el rechazo ocurre antes de `http.request`
(0 registros de dispatch al host remoto).

## 4. Resultado de la corrida de validación (30 checks)

`summary: { "passed": 30, "blocked": 0, "failed": 0, "total": 30 }`, **exit 0**, ejecutado con
centinelas en el entorno del llamador y con `--keep-evidence` en una corrida adicional
(ambas 30/30; la corrida final sin flag dejó `sandboxRemoved: true`).

| # | Check | Status | Qué se comprobó (evidencia) |
|---|---|---|---|
| 1 | `env.versions-exact` | passed | node=24.22.1, CLI=2.1.3, plugin=2.1.3, client=2.1.3 |
| 2 | `env.node24-runtime` | passed | runtime `v24.22.1` (pinned) |
| 3 | `env.allowlist-sentinels` | passed | 6 centinelas ausentes en runner **y** en `opencode serve` (booleanos) |
| 4 | `sandbox.isolation-permissions` | passed | sandbox 0700, log 0600 con password redactada (1 redacción, password ausente del disco), decoy intacto, limpieza solo del propio dir |
| 5 | `server.isolated-startup` | passed | serve listo con allowlist + HOME/XDG/cwd de sandbox; `.opencode` del workspace intacto |
| 6 | `plugin.recognized` | passed | `GET /api/plugin` → `f0-spike` (source local, state active) **y** agentes config `f0-primary`, `f0-child` visibles |
| 7 | `provider.fixture-loopback-dispatch` | passed | requests reales al fixture loopback vía paquete openai-compatible |
| 8 | `dispatch.kind-attribution` | passed | cabecera `x-f0-kind` presente en requests reales |
| 9 | `tool.f0-registered-codemode-off` | passed | `f0_probe` en el snapshot real de tools + registro con `codemode=false` |
| 10 | `tool.f0-executed-directly` | passed | ejecución real por el agent loop (`F0-PROBE-OK … digest=b594a8b3…`) |
| 11 | `tool.f0-actor-runtime` | passed | actor del executor: `f0-primary` + `sessionID` + `messageID` coincidentes con la sesión API |
| 12 | `approve.ask-sha-correlated` | passed | ask con `<op>:<sha256>` (sha recalculada igual), `evaluate` con `effect=ask` y correlación no nula, `reply once` completa el assert |
| 13 | `approve.reject` | passed | `reply reject` → assert rechazado + tool part en error, sin autorización |
| 14 | `approve.replay-needs-new-ask` | passed | misma operación+input tras `once` → **nuevo** ask (1→2) |
| 15 | `approve.altered-input-needs-new-ask` | passed | input alterado → sha distinta → ask propio |
| 16 | `approve.allow-converted-to-deny` | passed | regla de sesión `allow` → `evaluate` `effectIn=allow` → `deny`; sin ask publicado |
| 17 | `approve.saved-approval-no-bypass` | passed | `reply always` **creó realmente** el patrón (`permission.saved.list` → `learning.approve`/`spike-saved:<sha>`); la 2.ª evaluación resolvió `allow` → convertido a `deny` → assert `rejected` **sin ask y sin autorizar** (el conteo de records solo se usa como corroboración) |
| 18 | `policy.exposure-follows-permissions` | passed | control: allow de `read` lo expone al modelo; retirarlo lo oculta (efecto probado vía `POST /api/session/{id}/permission`) |
| 19 | `deny.shell` | passed | `shell` evalúa `deny`; registrado pero no expuesta; llamada rechazada; sin side effect |
| 20 | `deny.edit` | passed | `edit` evalúa `deny`; tool `write` no expuesta; sin archivo creado |
| 21 | `deny.execute` | passed | `execute` evalúa `deny`; **Code Mode ausente del registro**; llamada rechazada |
| 22 | `deny.subagent-delegation` | passed | `subagent` evalúa `deny`; tool `subagent` no expuesta; delegación rechazada |
| 23 | `child.no-escalation` | passed | hijo `f0-child`: `learning.approve=deny` y `shell=deny` por sonda; assert rechazado **sin evaluate** y sin ask; tools del hijo `["f0_probe"]` |
| 24 | `hook.generate-blocks-dispatch` | passed | bloqueado: 0 requests; libre: 1 request `generate` |
| 25 | `hook.compaction-blocks-dispatch` | passed | bloqueado: 0 `compaction`; libre: 2 `compaction` |
| 26 | `hook.title-blocks-dispatch` | passed | bloqueado: 0 `title`; libre: 1 `title` (gate `hook-block:title`) |
| 27 | `hook.context-blocks-dispatch` | passed | bloqueado: 0 requests (gate `hook-block:context`); libre: 1 `primary` |
| 28 | `disclosure.default-deny-without-evidence` | passed | sin evidencia → 0 requests, `default-deny:no-disclosure-evidence` |
| 29 | `disclosure.remote-destination-rejected` | passed | `f0remote` (`https://remote.example.invalid/v1`) rechazado antes del dispatch: gate + 0 requests + 0 `http.dispatch` al host remoto |
| 30 | `disclosure.fixture-destination-allowed` | passed | con evidencia loopback válida el mismo gate sí despacha (control positivo) |

## 5. Resolución de los hallazgos de la auditoría

1. **Pin aceptado antes y continuaba sin Node 24** → resuelto: `run.mjs` exige
   `24.22.1` exacto (+ CLI/plugin/client 2.1.3) *antes* de importar `runner.ts`; no continúa en
   el host, no se auto-relanza con el entorno heredado y sale `2` con cualquier desajuste
   (test: `test/launcher.test.ts`).
2. **`process.env` filtrado solo `OPENCODE_`** → resuelto: allowlist mínimo (§3.2), sin
   credenciales/proxies/`NODE_OPTIONS`/`LD_*`; regresión con 6 centinelas + claves reales en el
   proceso padre, booleanos en dos procesos, cero valores en salidas.
3. **Sandbox por PID con `rmSync` previo, permisos por defecto y password en el log** →
   resuelto: `mkdtemp` 0700 con token de propiedad, logs 0600, redacción de la password antes
   de escribir, limpieza solo del directorio propio, `--keep-evidence` opcional; decoy y
    redacción verificados en corrida real y en tests.

   La integración añadió regresiones para un token de contraseña dividido entre chunks y una última línea sin newline: el token se aprende solo al completar la línea y nunca se escribe en claro. El launcher usa el ejecutable actual cuando ya coincide con el pin, sin depender del Node temporal en otra máquina.
4. **`plugin.recognized` no exigía agentes** → ahora obtiene `agentIds` siempre y falla si
   `f0-primary`/`f0-child` no aparecen cuando el listado de agentes se usa como evidencia.
5. **Tipado real** → la lógica vive en `runner.ts` + `lib/*.ts` estrictamente tipados
   (sin `any`, sin casts que evaden el tipado; `unknown` + validación de frontera); el espejo
   manual `typed-client.contract.ts` fue eliminado. `tsc -p tsconfig.tests.json --noEmit`
   (que incluye `spikes/**/*.ts`) reporta **0 errores**.
6. **Check de patrón guardado débil** → endurecido como se describe en la fila 17: exige
   patrón persistido real, exige que la 2.ª ejecución **no autorice**, y cualquier autorización
   sin ask dispara re-prueba y `failed` + fallback (§8.2: `effect: deny` + `location.reload`).
7. **Correcciones de afirmaciones** → el digest del fixture es ordenamiento recursivo de claves
   sobre datos ASCII, **no** RFC 8785 completo; el bloqueo del destino remoto es un **gate
   observado** (decisión del hook + ausencia de `http.dispatch` + ausencia de request al
   fixture), **no** un contador independiente de egress ni un namespace de red — este spike no
   tiene monitor de salida de red. El gate de producto permanece cerrado y no existe proveedor
   real.

## 6. Reproducibilidad y validación

- `npx tsc -p tsconfig.tests.json --noEmit` → **0 errores** (incluye el runner, el plugin y los
  tests; hoy además pasa limpio para el resto del workspace).
- `node --test spikes/opencode-v2/test/*.test.ts` → **19/19 pass** (`env`, `sandbox`, `logic`,
  `launcher`). `npm test` raíz incluye estas pruebas.
- Corridas reales V2 posteriores a la corrección: **30/30 passed, exit 0** (una con
  `--keep-evidence`, una por defecto), ambas con centinelas en el entorno del llamador.
- Iteración intermedia fallida documentada: una versión del runner tenía un error propio en el
  polling del ask (optional chaining en la condición del bucle), lo que dejó la sesión sin
  responder y marcó los checks de aprobación como `failed`/`blocked`; se corrigió y volvió a
  ejecutar. **No se ocultó**: los estados `blocked`/`failed` de esa corrida produjeron `exit 1`.
- Salidas escaneadas: ninguna contiene valores de centinela ni la password del serve.

**Cierre adicional de auditoría:** los cuatro checks de hooks exigen ahora gate negativo del flujo con `decision:block` y razón `hook-block:<flujo>`, gate positivo `allow` con consentimiento de fixture válido y los contadores de transporte. Solo cuentan gates nuevos en la ventana correspondiente, no registros antiguos. Ausencia de requests sin evidencia causal del hook queda `blocked`. Se añadieron regresiones para gate ausente, flujo/razón incorrectos y control positivo sin gate; la corrida real posterior volvió a dar **30/30 passed**.

## 7. Limitaciones y no-verificado (explícito)

- **`blocked` = no verificado**, con sufijo "capability remains disabled; nothing was enabled as
  a fallback". En la corrida final no hubo checks bloqueados.
- **Sin F1:** no se crean grants de un uso ni se consumen en el Core; solo se demuestra la
  correlación ask↔evaluate↔assert por SHA.
- **Sin proveedor remoto real:** `f0remote` nunca se contactó (rechazo previo al dispatch).
- **Sin sandbox de SO ni monitor de egress** (§8.1): el aislamiento es por directorios y el
  bloqueo remoto es el gate observado del plugin.
- **Sin agentes pedagógicos ni integración de producto:** `f0-primary`/`f0-child` son fixtures
  neutrales; sin MCP; el gate de divulgación de producto sigue en default-deny.
- **Consentimiento/cuotas §11 a fondo:** solo se prueba el gate de destino/propósito/expiración;
  no hay cuotas de generación ni `DisclosureRecorded` (F6/Core).
- Los resultados viven en `spikes/opencode-v2/results/latest.json`; los sandboxes se eliminan por
  defecto (usar `--keep-evidence` para inspeccionar `evidence.jsonl`).

## 8. Archivos y comandos nuevos

| Ruta | Contenido |
|---|---|
| `spikes/opencode-v2/run.mjs` | Launcher: pins + allowlist + relanzado + import del runner |
| `spikes/opencode-v2/runner.ts` | Runner tipado: sandbox, fixture, serve, checks, informe |
| `spikes/opencode-v2/lib/bootstrap.ts` | Pines, allowlist, verificación de Node fijado |
| `spikes/opencode-v2/lib/contracts.ts` | Tipos compartidos (evidencia, control, consent, informe) |
| `spikes/opencode-v2/lib/logic.ts` | Digest del fixture, validación de frontera, verdicts puros |
| `spikes/opencode-v2/lib/sandbox.ts` | mkdtemp 0700, ownership token, log 0600 con redacción |
| `spikes/opencode-v2/lib/fixture.ts` | Proveedor loopback efímero (typed) |
| `spikes/opencode-v2/plugin/index.ts` | Plugin V2 (tools `f0`, permisos, hooks, gate, sentinel) |
| `spikes/opencode-v2/test/*.test.ts` | 17 tests: env, sandbox, lógica de checks, launcher |
| `spikes/opencode-v2/results/latest.json` | JSON de la última corrida |

Comandos: `npm run spike:opencode`, `node --test spikes/opencode-v2/test/*.test.ts`,
`npx tsc -p tsconfig.tests.json --noEmit`.

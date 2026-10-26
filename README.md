# Learning Workspace

Entorno local-first de aprendizaje, independiente de OpenTutor. Notebooks publicados e inmutables por release; Markdown personal en Portfolio; estado estructurado gobernado por Learning Core/SQLite; OpenCode como interfaz principal futura y Obsidian para leer/editar notas.

## Estado: exclusivamente F0

Este checkout implementa bootstrap, contratos, validadores puros y probes de entorno. **No implementa F1**, migraciones académicas, inscripciones persistidas, instalación de Notebooks, scoring, sesiones de estudio ni agentes pedagógicos funcionales. Los comandos de dominio propuestos en la especificación aún no están disponibles.

El spike OpenCode es un experimento aislado con datos ficticios. No es el adaptador de producción y no habilita acceso a datos personales ni envío a modelos remotos. Que una API compile o registre un hook no demuestra que el permiso o el bloqueo de dispatch funcione: sus resultados distinguen comprobaciones verificadas de capacidades bloqueadas.

El informe JSON de cada corrida se genera en `spikes/opencode-v2/results/latest.json` y se ignora en Git (contiene metadatos efímeros de rutas/sesiones). El diagnóstico revisable está en [el informe del spike](docs/f0-opencode-spike.md).

## Requisitos

- Linux (plataforma inicial de aceptación).
- **Node.js 24.22.1 LTS**, fijado en `.node-version` y `.nvmrc`. Se rechaza cualquier versión distinta, incluidos otros patches 24.x; no es necesario cambiar el runtime global.
- **npm 12.2.1**, fijado en `packageManager`, con lockfile v3.
- Python 3 para el diagnóstico Linux de `renameat2`; no es dependencia del Core ni un publisher de producción.
- OpenCode **2.1.3** para reproducir el spike; plugin/client fijados a **2.1.3**. No se requiere proveedor, cuenta ni credenciales reales.
- Herramientas de compilación nativa si `better-sqlite3` no dispone de binario para la plataforma.

Usa tu gestor de versiones para activar Node (por ejemplo `nvm install && nvm use` si ya utilizas nvm). Comprueba `node --version` y `npm --version`. Si la distribución de Node incluye otra versión de npm, puedes ejecutar `npx --yes npm@12.2.1 <comando>` en lugar de instalarlo globalmente.

## Preparación y verificaciones

Desde la raíz del repositorio, con Node 24 activo:

```bash
npm ci
npm run build
npm run typecheck
npm test
npm run probe:environment
npm run spike:opencode
```

`npm run check` agrupa typecheck, build/tests y probe de entorno. El spike se ejecuta por separado para distinguir las limitaciones de OpenCode de los validadores independientes. Dependencias directas y aprobaciones de scripts nativos están fijadas en `package.json`; las transitivas, en `package-lock.json`. No aprobar indiscriminadamente scripts de nuevas dependencias.

Los tests usan `node:test` del runtime, datos sintéticos y archivos temporales. El probe SQLite crea tablas **de diagnóstico** y las elimina al terminar: no son el esquema ni el estado académico de F1. `.f0-evidence/` contiene temporales ignorados por Git. No se abren bases de datos ni credenciales del usuario.

`.gitattributes` evita conversiones de fin de línea en fixtures: sus bytes (incluidos CRLF y PNG) forman parte de los vectores de digest, independientemente de la configuración global de Git.

## Uso disponible del CLI

Después de `npm run build`:

```bash
npm run learn -- --help
npm run learn -- --version
npm run learn -- f0 schemas
npm run learn -- f0 validate Profile fixtures/cli/profile.yaml
npm run learn -- f0 path resources/ohms-law.md
npm run learn -- f0 capabilities
```

- `schemas`: lista los nombres de esquemas disponibles.
- `validate`: valida YAML/JSON local con parser seguro y el contrato Zod correspondiente; no importa ni persiste el documento. Rechaza campos desconocidos, UTF-8 inválido, archivos no regulares, symlink final y entradas mayores de 2 MiB. Es una lectura local solicitada por el usuario, no una API de confinamiento: no afirma rechazar todos los symlinks de directorios padre ni sustituye la ACL futura del Core.
- `path`: valida una ruta relativa portable **sin normalizar** una ruta insegura ni tocar el archivo.
- `capabilities`: informa explícitamente que persistencia académica, agentes pedagógicos, integración personal y dispatch remoto están deshabilitados.

Salida de validación en JSON. Exit codes: `0` válido, `1` error de lectura/entorno, `2` input/comando inválido. Por ejemplo `f0 path ../secret` falla. `learn init` y `learn study` se rechazan: no hay implementaciones simuladas de fases futuras.

Para registrar las versiones locales sin habilitar capacidades:

```bash
cp workspace.example.yaml workspace.yaml
```

`workspace.yaml` es local e ignorado por Git. Sus flags `false` documentan el bloqueo; cambiarlos no implementa ni activa F6. No hay plugin pedagógico autoload en `.opencode/` en esta fase: el spike prepara su propio entorno aislado.

## Contratos y JSON Schema

```bash
npm run schemas:generate
```

Genera JSON Schema desde los mismos contratos Zod en `packages/schemas/generated/` (regenerable, ignorado por Git). No mantener esquemas manuales paralelos. Las invariantes semánticas —DAG, referencias entre catálogos y relaciones entre valores— deben validarse con Zod y los validadores de conjunto: un JSON Schema estructural por sí solo no acredita esas garantías. Los artefactos generados identifican las comprobaciones que requieren runtime.

La validación no concede autoridad: un DTO válido no representa consentimiento, aprobación ni una transición aceptada del Core. Esos mecanismos pertenecen a fases posteriores.

## Estructura

```text
packages/schemas/       # Zod, YAML seguro, estados/DTOs y generación JSON Schema
packages/core/          # rutas, AST Markdown y hashing determinista; sin persistencia
packages/cli/           # comandos de validación F0, no comandos académicos
fixtures/              # contenido ficticio de prueba
scripts/               # verificación de runtime y capacidades del entorno
spikes/opencode-v2/     # integración experimental aislada, no adaptador productivo
tests/                 # controles del workspace y probes
docs/                  # contratos normativos, ADR, plan y evidencias F0
```

## Límites de seguridad

No ejecutar paquetes educativos. Rechazar rutas peligrosas, configuración activable y contenido activo; tratar instrucciones en Markdown como datos. Los agentes no reciben SQL, escritura de Notebook ni autoridad por campos de un DTO. Los permisos del propietario del host siguen fuera de la barrera del Core; read-only y hashes no constituyen sandbox.

La prueba de `renameat2` acredita disponibilidad del syscall en el filesystem probado; **no** significa que `fs.rename` de Node tenga no-replace ni que esté implementado el protocolo DB/archivos de F3. `fsync` exitoso tampoco demuestra resistencia física a un corte de energía.

Portfolio, snapshots instalados, cachés, backups, SQLite, staging y secretos están ignorados por defecto. No añadir datos personales a fixtures, logs, commits ni al spike. Nunca usar `--auto` para probar aprobación interactiva.

## Fuentes normativas

- [Especificación v0.1](docs/learning-workspace-spec-v0.1.md)
- [Decisiones arquitectónicas](docs/architecture-decisions.md)
- [Plan incremental y F0](docs/implementation-plan.md)
- [Cuestiones externas pendientes](docs/open-questions.md)
- [Puertas de entorno F0 y resultados observados](docs/f0-environment.md)
- [Incompatibilidades F0 reproducidas y aclaraciones justificadas](docs/f0-compatibility-findings.md)
- [Informe consolidado de implementación y verificación F0](docs/f0-verification.md)
- [Contratos y límites implementados en schemas](docs/f0-schema-contracts.md)

La normativa no se modifica para hacer pasar una prueba; una incompatibilidad debe registrarse con evidencia y bloquear la capacidad afectada. No iniciar F1 automáticamente. El repositorio se entrega **sin commit** para revisión del usuario.

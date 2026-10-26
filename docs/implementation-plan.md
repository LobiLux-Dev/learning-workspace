# Learning Workspace — Plan incremental de implementación v0.1

**Estado:** Plan derivado de la especificación refinada; no ejecutado  
**Fecha:** 2026-10-25

Fuente normativa: [especificación](learning-workspace-spec-v0.1.md). Motivación de decisiones: [ADR](architecture-decisions.md). Este archivo define trabajo futuro; ninguna prueba o entrega listada se considera realizada por estar aquí.

## 1. Reglas de ejecución

- Implementar por fases pequeñas con suite offline primero. No comenzar automáticamente por cerrar documentación.
- Reutilizar esquemas únicos, no DTOs divergentes entre Core/CLI/plugin. Validación estricta en cada frontera.
- Tests usan workspaces temporales, paquetes sintéticos y modelos mock. Nunca corromper Portfolio real.
- No introducir servidor nuevo, MCP, embeddings, sandbox o más agentes para resolver problemas del MVP.
- Cada fase incluye errores, reinicios y permisos relevantes; no diferir toda seguridad al final.
- Registrar versiones exactas del entorno/dependencias probadas y resultados reales. Construcción exitosa no prueba permisos ni integración visual con Obsidian.
- Si falla una puerta de integración, bloquear la capacidad afectada. No degradar garantías ni marcar todo MVP completo porque el Core funcione.

## 2. Dependencias

```text
F0 contratos/entorno ─→ F1 persistencia/autoridad ─→ F2 instalación
                              │                       │
                              └───────────────────────┴─→ F3 materiales/sesiones
                                                              │
                                                              └─→ F4 evidencias/mastery
F1 + F2 + F3 + F4 ─→ F5 doctor/backup/cache/CLI completo
F0 smoke V2 + F1 + F3 + F4 + F5 ─→ F6 plugin/agentes/consentimiento
F2 + F3 + F4 + F5 + F6 ─→ F7 aceptación integrada
```

F0 investiga compatibilidad V2 en un spike mínimo autorizado al iniciar implementación, sin datos personales. Esto evita descubrir demasiado tarde que los hooks no bloquean un flujo. F6 completa la integración sobre el dominio ya probado. No trabajo concurrente que edite el mismo contrato sin coordinación.

## F0 — Bootstrap, contratos y puertas de entorno

**Dependencias:** Autorización explícita para comenzar implementación.

**Entregables:**
- Workspace TypeScript Node.js 24 LTS, packages schemas/core/cli; scripts build/typecheck/test; dependencias fijadas y .gitignore seguro.
- Zod + JSON Schema: manifiestos, catálogos, currículo, rúbricas, inputs/DTOs/eventos, errores, estados y enums de la especificación.
- Parser YAML estricto y CommonMark AST; reglas portables de rutas y digest canónico con vectores de prueba publicados.
- Registro de versión patch exacta OpenCode CLI/servicio, `@opencode/plugin` y SQLite/driver; validación de FTS5, backup API y fsync/rename no-replace en Linux.
- Spike sin contenido privado que registre una herramienta V2 directa, lea actor de runtime, aplique permiso, pruebe aprobación ligada a hash y pruebe interrupción de dispatch en context/compaction/generate/title. No confiar en interceptar solo HTTP.

**Aceptación:**
- Contratos rechazan claves desconocidas, YAML duplicado/aliases/tags, ciclos y referencias inválidas.
- Dos inventarios iguales por bytes producen mismo digest sin depender de orden de lectura/mtime.
- V2 reconoce plugin, herramientas directas y `permissions`; shell/edit/execute y delegación no permitida quedan denegados; hijo no puede escalar.
- Si no se puede comprobar aprobación/hook de un flujo, documento de diagnóstico y modo remoto bloqueado; sin workaround inseguro. Cualquier incompatibilidad con el contrato se resuelve antes de F6.

**Criterios:** AC14, AC15 y AC17 parciales; AC16 para esquemas. No afirmar aún MVP seguro.

## F1 — SQLite, journal, autoridad e idempotencia

**Dependencias:** F0.

**Entregables:**
- Migrations versionadas, tablas/índices/FKs compuestas/CHECK/triggers normativos.
- Conexiones WAL/FKs/FULL/busy_timeout; lock de workspace liberable por SO.
- Contextos internos de usuario/agente, facades por rol, grants internos de un uso; inputs LLM sin actor/root/token.
- `operations`, hashes canónicos, CAS de revisiones y commits de hechos+eventos.
- Profile, enrollment y transiciones base; journal por event_seq, no reloj del cliente.

**Aceptación:**
- Manipular actor/rol/root por input es rechazo; grant expirado/usado/hash incorrecto no autoriza.
- Misma clave devuelve IDs originales después de reinicio; otra carga/actor con misma clave falla.
- Dos escritores no crean doble sesión activa ni aceptan una revisión vieja.
- FKs y comprobaciones Core impiden cruces de enrollment/release. Eventos/hechos inmutables no admiten UPDATE/DELETE soportado.
- Fail antes/después de COMMIT no deja hecho sin journal o viceversa.

**Criterios:** AC09, AC10 y AC14 (Core).

## F2 — Instalación, snapshots y verificación

**Dependencias:** F1.

**Entregables:**
- Importador local y Git HTTPS fijado sin checkout/hooks/filtros/config de origen.
- Captura staging, inventario canónico, identidad/conflictos y publicación A/rename/B.
- Validación catálogo/currículo/assets/licencias y cierre de enlaces/fragmentos.
- `notebook add/list/verify/compare`, cuarentena y comparación por IDs/hashes.
- Fixture electrónica raster; fixture referencia sin currículo y paquetes maliciosos.

**Aceptación:**
- Origen local mutable no está enlazado al snapshot; mismo UID/version otro contenido falla.
- Commits distintos con contenido idéntico agregan procedencia, no duplican release.
- Paquete con AGENTS/config/hooks/symlink/submódulo/ejecutable/path colisionado o asset activo falla antes de publicar.
- Falta/extra/hash distinto se informa sin reparación. Una release en cuarentena no sirve nuevas fuentes académicas.
- Instalación fallida emite NotebookInstallFailed; nueva clave/aprobación con mismos bytes pasa failed→pending→ready y emite Retried/Installed una vez. Cuarentena repetida con nueva clave/revisión actual es no-op sin evento/revisión nuevos; clave antigua devuelve original; revisión vieja falla; quarantined nunca se repara en sitio.
- Kill entre staging, A, rename y B se recupera según plan o queda failed explícito, sin sobrescribir conflicto.

**Criterios:** AC01–03, AC11, AC14 (instalación), AC16.

## F3 — Portfolio, materialización y sesiones recuperables

**Dependencias:** F2 y F1.

**Entregables:**
- Artifacts/bundles con procedencia, cuota y paths generados por Core.
- Exact-copy con cierre transitivo y traducción opcional mediante propuesta validada, sin proveedor obligatorio.
- Assignment preparing/assigned/fallo, observaciones de lectura, sesiones y transiciones.
- Detección de edición externa y adopción como nuevo artifact/assignment.
- Recovery de publicaciones y vista de checkpoint; CLI study básico.

**Aceptación:**
- Bytes y enlaces/assets del fixture se conservan al abrir copia, sin frontmatter inyectado ni symlinks.
- Idioma ausente no desencadena traducción; modo sin proveedor devuelve error específico/ofrece original.
- Traducción mock conserva fuente/modelo/digest y no es reviewed por defecto.
- Nota libre no toca DB; material editado no se consume ni sobrescribe. Adopt preserva historia y crea nuevos IDs.
- Pending no es consumible; disco lleno, destino ocupado, staging perdido y restart tienen diagnóstico y recuperación explícitos.
- Lectura nunca genera evidencia ni mueve score.

**Criterios:** AC05, AC06, AC09, AC11 y AC12 (archivos).

## F4 — Ítems, rúbricas, intentos, decisiones y mastery

**Dependencias:** F3.

**Entregables:**
- Preparación persistida de ítem/rúbrica/solución/contexto antes de respuesta, artifacts de ejercicios y contador de pistas.
- Captura de respuesta confirmada, evaluación propuesta, decisión humana y corrección encadenada.
- Replay `mastery-rules-v1`, ventana 20, cobertura, readiness y selección estable.
- Proyecciones con H/digest/algoritmo, rebuild transaccional y detección de staleness.
- CLI diagnose, progress y assessment review; fixtures de Ohm con respuestas correctas/incorrectas y rúbricas completas.

**Aceptación:**
- No modificar rúbrica tras respuesta; criterios faltantes/extras/fuera de rango se rechazan.
- Servir una pista, reiniciar y repetir la misma clave devuelve mismo HintServed/ordinal. Un intento posterior fija served_count + declared_external_hints; replay usa ese snapshot y una pista posterior al intento se rechaza.
- Pending/rejected no cuentan; corrección aceptada sustituye una contribución y sigue auditable.
- Dos aceptaciones concurrentes no crean forks; ítem no duplica intento puntuable.
- 0 evidencias → score NULL; 3 perfectas → insufficient-evidence; ≥5 y ≥3 contextos con ≥8000 → demonstrated.
- Ejemplo exacto: dos criterios iguales, puntuaciones 2/2 y 1/2, una pista → q=6750. Cinco evidencias así producen score=6750 y etiqueta developing con tres contextos.
- Intentos 21+ expulsan más antiguos por submitted_event_seq, no por fecha de corrección. Replay mismo H es idéntico con otro reloj/modelo.
- Kill durante rebuild preserva proyección previa stale y no altera evidencias; readiness no se confunde con lectura.

**Criterios:** AC07–10.

## F5 — Doctor, backups, caché y CLI operativa

**Dependencias:** F1–F4.

**Entregables:**
- Doctor read-only con errores/warnings/IDs y reporte JSON; portfolio verify y session recover.
- Backup API SQLite + inventario de archivos; restore a raíz nueva; verificación y documentación de límites.
- FTS5 en cache DB separada, reconstrucción por reemplazo y memoria determinista por plantilla.
- CLI de §9.3 con selección exacta de enrollment, errores/exit codes, confirmaciones y reintentos.
- `enroll --from` vacío y vinculado tras backup; sin transferencia de dominio.

**Aceptación:**
- Backup con WAL/varios commits, restore y replay pasan verificaciones sin copiar DB viva incorrectamente.
- Editor externo que cambia notas durante backup causa abort, no snapshot «consistente» falso.
- DB ilegible se diagnostica; no se promete arreglarla sin backup. Hash inválido/incompleto/esquema futuro bloquea restore.
- Truncar/borrar cache no altera notas/evidencias; rebuild produce índice útil con fuentes y hashes actuales.
- Doctor no reconcilia, borra ni repara; recover sí ejecuta solo planes aceptados, sin requests LLM repetidos.
- Actualizar fixture a otra release y crear enrollment nuevo deja toda historia v1 intacta y score v2 unobserved.

**Criterios:** AC04, AC10–13.

## F6 — OpenCode V2, dos agentes y privacidad

**Dependencias:** F0 smoke compatible y F1–F5.

**Entregables:**
- Plugin local V2 con facades Core, contextos runtime y permisos por ejecutor; config/agents explícitos.
- `learning-orchestrator` y `tutor` únicamente; resto definido pero no habilitado.
- Consentimientos/revocaciones/disclosures por destino/categoría/fines; mínimo necesario y redacción de logs.
- Hooks de todos los flujos de dispatch y bloqueo efectivo; título local/auxiliares deshabilitados si no pueden protegerse.
- Preflight de versión/config efectiva/allowlist; política ask verificada para aprobación sin guardado de patrones.
- Cambio de proveedor/revocación interrumpe sesión; nueva conversación rehidratada desde Core y consentimiento válido.

**Aceptación:**
- Agente no puede pedir SQL, paths arbitrarios, aprobación fabricada, shell, escritura directa o subagente amplio.
- Tutor no acepta evaluación ni envía respuesta del alumno; orchestrator solo lo solicita por canal interactivo confiable.
- Intento/ítem/evaluación aprobados se ligan a hashes; no aprobación «sí» interpretada por LLM ni reuse de grant.
- Sin grant remoto, ninguna herramienta retorna dato personal a contexto remoto y ningún flujo posterior lo despacha.
- Mock intercepta requests de primary/compaction/generate/title y cambio de destino; prueba real V2 comprueba bloqueo y configuración efectiva, sin enviar datos reales privados.
- No notas/assets por consentimiento genérico de tutoría; logs sin cuerpos/tokens. Expiración/revocación detiene nuevas llamadas, sin prometer borrar envíos previos.
- Reiniciar/cambiar modelo recupera progreso sin contexto; /undo no revierte SQLite. No almacenar secretos en vault/config versionada.

**Criterios:** AC14, AC15, AC17, además de AC07 y AC10 vía adaptador.

## F7 — Vertical slice y aceptación final de v0.1

**Dependencias:** Todas las anteriores.

**Entregables:**
- Recorrido reproducible §14 de la especificación: fixture Ohm, prerrequisitos, copia Obsidian, tres problemas, evaluación/corrección, restart y restore.
- Suite de aceptación AC01–AC17, evidencias de ejecución y matriz de riesgos actualizada.
- Manual de administración local, recuperación, privacidad y límites de seguridad.

**Aceptación:**
- Suite automatizada offline completa y checks build/typecheck/migrations pasan en versiones fijadas.
- Inyección de fallos en cada punto §6.4, writer concurrente, duplicado, corrupción de caché/DB de pruebas y proveedor interrumpido.
- Smoke real de OpenCode con primary/tutor, prompts adversarios de contenido y bloqueo de herramientas; no basta inspeccionar YAML.
- Obsidian manual: abrir bundle copiado, comprobar asset/enlaces/fragmentos, editar nota y detectar divergencia de material. Anotar versión Obsidian probada; Core no depende de ella.
- Reiniciar ambos procesos y continuar solo con enrollment UID. Crear backup, restaurar en raíz nueva, comparar digest de replay y bytes originales.
- Cada AC tiene resultado y evidencia; los no ejecutados se declaran pendientes. Si falta prueba real V2/consentimiento, no declarar MVP integrado completo.

## 3. Matriz mínima de fallos a ejecutar

| Situación | Resultado exigido |
|---|---|
| Kill antes de transacción A | Sin hecho aceptado; staging huérfano informado, no borrado automático |
| Kill después de A y antes de rename | pending con staging válido; recover publica/finaliza sin nueva generación |
| Kill después de rename y antes de B | Destino validado; recover finaliza B y emite eventos una vez |
| Kill después de B/antes de respuesta | Reintento devuelve IDs/resultado guardados |
| Disco lleno/fsync fallido | No ready falso; pending recuperable o failed explícito |
| Destino existente distinto | No sobrescribir; conflicto persistido |
| Staging perdido o corrupto | failed y assignment failed; residuos preservados |
| Dos writers/lock abandonado | Espera limitada/WORKSPACE_BUSY; SO libera tras muerte |
| Misma clave con otra carga/actor | IDEMPOTENCY_CONFLICT, sin efecto |
| Correcciones simultáneas | Una cabeza efectiva, conflicto explícito en la otra |
| Provider cae tras responder/cobrar | Sin doble submit académico ni retry automático; coste externo no exactly-once |
| FTS truncada/memoria borrada | Rebuild de derivados; evidencia y notas intactas |
| Material editado/asset perdido | Doctor reporta y consumo falla; adopt/restauración explícita |
| DB ilegible/FKs alteradas en fixture | Diagnóstico, no reparación; restore solo desde backup válido |
| Consentimiento expira/cambia proveedor | Interrumpir, bloquear dispatch posterior y rehidratar en nueva sesión autorizada |
| Reloj local cambia | Mismo H da replay idéntico; grant expirado nunca revive por input del modelo |

## 4. Cierre de fase documental y comienzo de desarrollo

Los 11 hallazgos tienen resolución normativa en §15 de la especificación y ADR enlazados. No quedan decisiones fundamentales de dominio abiertas. Las puertas de entorno —pin exacto y comprobación runtime V2/driver/filesystem— son entregables de F0, no razones para improvisar otra arquitectura en F6.

Riesgos conocidos no bloquean empezar F0/F1; sí impiden declarar terminadas las capacidades si sus pruebas fallan. No activar envío remoto por defecto ni rebajar el canal de aprobación para desbloquear una demo. Al terminar cada fase se informa resultado real antes de continuar según autorización del usuario.

# F0 — Informe de implementación y verificación

Fecha: 2026-10-25. **Estado: F0 lista para revisión del usuario; comprobaciones técnicas y revisión independiente cerradas dentro del alcance F0.**

## Alcance entregado

- Workspace npm/TypeScript con `packages/schemas`, `packages/core` y `packages/cli`; Git inicializado en `main`, sin commits.
- Esquemas estrictos Zod de manifiestos, catálogos, currículo, rúbricas, entidades, eventos, inputs, envelopes, errores y vistas readonly; **125 JSON Schemas** generados desde la misma autoridad.
- Parser YAML 1.2 sin expansión/ejecución, aliases, merges, tags personalizados, claves duplicadas ni Unicode inválido; presupuesto de bytes/profundidad.
- Rutas portables NFC y colisiones por plegado Unicode completo; CommonMark AST, enlaces/fragmentos y cierre virtual; cuotas antes de decodificar/analizar.
- `snapshot-sha256-v1` y RFC 8785 con una autoridad base compartida en schemas. Core adapta errores públicos y calcula hashes de bytes; no mantiene un serializador paralelo.
- CLI real de validación F0: ayuda, versión, listado de esquemas, validación YAML/JSON, paths y estado de capacidades. No simula comandos de dominio.
- Probes SQLite/backup/FTS5/fsync/no-replace y spike OpenCode V2 aislado, exclusivamente con fixtures y datos ficticios.
- README con instalación, uso, comandos de comprobación y límites. Fixtures protegidos frente a conversión EOL mediante `.gitattributes`.

## Versiones observadas/fijadas

| Componente | Versión |
|---|---|
| Node.js de aceptación | **24.22.1 LTS**, patch exacto |
| npm | **12.2.1** |
| TypeScript | **5.9.3** |
| Zod / YAML | **4.6.7 / 2.9.1** |
| mdast-util-from-markdown | **2.1.0** |
| json-canonicalize | **3.0.1** |
| unicode-case-folding | **1.1.2** |
| semver / bcp-47 | **7.8.5 / 2.1.2** |
| spdx-license-ids | **3.0.24** (identificadores, no autorización legal) |
| better-sqlite3 / SQLite embebida | **13.0.3 / 3.53.4** |
| OpenCode CLI/servicio de fixture | **2.1.3** |
| @opencode/plugin / @opencode/client | **2.1.3 / 2.1.3** |
| AJV (tests de JSON Schema) | **8.20.0** |

Dependencias directas exactas, transitivas e integridades en lockfile v3. `allowScripts` autoriza solamente `better-sqlite3@13.0.3` en el proyecto. No se cambió el Node global 26.12.1; se utilizó Node 24 temporal y se documentó cómo activar el runtime fijado.

## Comprobaciones realmente ejecutadas

| Comando / control | Resultado |
|---|---|
| `tsc -b --clean` + `npm ci` | Exit 0; outputs del compilador borrados y dependencias reinstaladas desde lockfile |
| `npm run build` | Exit 0; tres paquetes y 125 JSON Schemas generados |
| `npm run typecheck` | Exit 0; incluye las llamadas reales del runner V2 TypeScript y los tests |
| `npm test` | **200 tests, 200 pass, 0 fail, 0 skipped** |
| `npm run probe:environment` | Exit 0; siete comprobaciones reales de runtime/SQLite/filesystem |
| `npm run spike:opencode` | Exit 0; **30 passed / 0 blocked / 0 failed**, sandbox propio eliminado |
| `npm audit` | Exit 0; **0 vulnerabilidades reportadas** (no equivale a certificación de seguridad) |
| Dos generaciones consecutivas de JSON Schema | 125 archivos, bytes idénticos |
| Digests calculados independientemente en Python | Tres vectores coinciden con Core y schemas; tests de interoperabilidad incluidos |
| CLI `f0 validate Profile fixtures/cli/profile.yaml` | Exit 0, resultado `valid:true` |
| CLI `f0 capabilities` | Persistencia/mutaciones académicas, agentes pedagógicos e integración personal/remota = **false** |
| Runtime guard | Node 26 real rechazado; 24.22.1 aceptado; tabla de otros patches/majors rechazada por la función guard |
| Git | `HEAD` no existe; ningún commit; fixtures tienen atributo `text: unset` |

El hash agregado de generación (nombres ordenados + newline + bytes de cada JSON) es:
`238cfd26a1223e2831e94a7e9d496baec606adc6872da6769e6ed0fe519f203b`.

Los logs completos locales de la comprobación integrada se escribieron en `/tmp/opencode/learning-workspace-{build,typecheck,tests}.log`, `learning-workspace-environment.json` y `learning-workspace-spike-verification.json`; son evidencia de esta máquina, no requisitos de ejecución. El JSON detallado del último spike está en `spikes/opencode-v2/results/latest.json`, ignorado en Git.

## Aceptación F0 y fronteras

| Entregable/criterio F0 | Evidencia / alcance |
|---|---|
| Toolchain, tres paquetes, scripts y lockfile | Build/typecheck/install aprobados; versiones exactas verificadas |
| Contratos estrictos y referencias/DAG | Tests de schemas y composición; paths inválidos no pueden convertirse en `ok:true`; cadena de 10.000 skills/ciclo sin desbordamiento |
| YAML hostil rechazado | Fixtures de alias/tags/merges/duplicados/directivas/Unicode/profundidad; palabras inertes no se ejecutan ni se prohíben por parecer instrucciones |
| JSON Schema generado desde Zod | 125 schemas, determinismo y controles AJV; invariantes no expresables marcados `x-runtime-validation`, nunca presentados como validados solo por AJV |
| Digest independiente de orden/mtime y fiel a bytes | Vectores fijados CRLF/UTF-8/binario, límites y colisiones, comparación Python y entre APIs |
| Markdown por AST y cierre virtual | Ataques codificados, rutas, fragmentos, slugs únicos, contenido inerte en código y anidamiento profundo; no materializa archivos |
| Puertas SQLite y filesystem | FTS5, WAL/FULL/FKs, API backup, fsync real y syscall no-replace; sin publisher de producto |
| V2: tool directa, actor, permisos, hijo | Engine real con fixture loopback; deny-by-default y aprobación SHA; sin autoridad Core F1 |
| V2: cuatro flujos de dispatch | Gate de bloqueo y control positivo nuevos en cada ventana + contador de requests por flujo; no basta observar cero requests |
| No verificable ⇒ capacidad bloqueada | Runner no devuelve éxito con blocked/failed; producto permanece deshabilitado incluso con todos los checks del fixture aprobados |

**AC14/AC15/AC17 son parciales**, como prevé F0: no hay Core de autorización/persistencia ni agentes pedagógicos reales. **AC16 se acredita en su parte de contrato** (electrónica/referencia sin campos de disciplina/CEFR/idioma obligatorios); lectura de producto y errores de capability reales quedan en sus fases. No se marcan completos criterios de aceptación de F1–F7.

## Correcciones documentadas e invariantes preservadas

Los defectos reproducidos y su justificación están en [f0-compatibility-findings.md](f0-compatibility-findings.md). Solo se aclararon la especificación y ADR-004 después de registrar CF01/CF02: bancos publicados usan refs `resource_id/digest` sin UUID local y LicenseRef declara textos mediante `metadata.license_files`. El plan incremental y open-questions normativos no se modificaron.

La revisión independiente detectó y se cerraron los hallazgos sobre pin exacto, herencia de credenciales, sandbox/logs, evidencia causal de hooks, cuotas del conjunto virtual y extensión de texto LicenseRef. La última regresión acepta `.txt` con casing compatible y rechaza imágenes/otros formatos tanto en el manifiesto como en validación combinada. El dictamen final fue «F0 listo para revisión del usuario», limitado a la fuente revisada y a los checks ejecutados: no certifica F1/F6 ni proveedores/transporte no ensayados.

Se conservan: releases inmutables por contenido, enrollments históricas ancladas a release, Portfolio independiente, datos LLM como propuestas sin autoridad y ausencia de escritura de Notebook. **No se implementó F1:** no hay migrations académicas, tablas de learner/enrollment/events, transacciones de dominio, contexto/grants Core ni progress store. Las únicas DB abiertas son temporales de diagnóstico o las internas del servidor OpenCode aislado con sesiones sintéticas.

## Riesgos y límites abiertos

- El syscall `renameat2(RENAME_NOREPLACE)` se probó mediante Python/ctypes; no existe todavía un binding/publisher Node de producto. `fs.rename` reemplaza destinos y no es un sustituto válido. Su integración pertenece a F2/F3.
- El spike prueba OpenCode 2.1.3 y transporte HTTP a fixture local. No acredita otras versiones, proveedores reales ni WebSocket. El rechazo remoto es gate observado, **no monitor independiente de egress** ni sandbox de SO.
- Consentimiento persistido, consumo de grants, cuotas, ACL de Core, backups del Portfolio real y garantías frente a fallos académicos requieren sus fases; no se sustituyen por flags o prompts.
- Firma/decodificación de imágenes, Git seguro y verificación de archivos físicos del paquete corresponden a F2. `ok` de un validador F0 no significa release instalada/autenticada.
- npm emitió avisos de deprecación de dependencias transitivas del entorno V2. Están fijadas; audit reportó cero vulnerabilidades. Cualquier actualización exige repetir las puertas pertinentes.

No iniciar F1 ni crear commit sin la revisión y luz verde del usuario.

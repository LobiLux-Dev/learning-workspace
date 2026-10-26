# F0 — Puertas de entorno verificadas

Fecha: 2026-10-25. Evidencia obtenida ejecutando `npm run probe:environment` con datos sintéticos. No es verificación de persistencia académica ni del MVP completo.

## Versiones observadas

| Componente | Versión |
|---|---|
| Plataforma | Linux x64 |
| Node de verificación | 24.22.1 LTS |
| Node global encontrado inicialmente | 26.12.1; no se modificó |
| npm | 12.2.1 |
| TypeScript | 5.9.3 |
| better-sqlite3 | 13.0.3 |
| SQLite embebida | 3.53.4 |
| OpenCode CLI encontrado | 2.1.3 |
| @opencode/plugin y @opencode/client fijados | 2.1.3 |

Node 24 se obtuvo en un directorio temporal aislado: `/tmp/opencode/learning-workspace-node24/`. Para reproducir en este entorno mientras siga existiendo:

```bash
export PATH="/tmp/opencode/learning-workspace-node24/node_modules/node/bin:$PATH"
node --version
npm run probe:environment
```

En otra máquina usar el gestor de versiones habitual con `.node-version`/`.nvmrc`; no depender de ese directorio temporal.

## Resultados reales

| Comprobación | Resultado y evidencia |
|---|---|
| Node patch fijado | Passed: `process.versions.node = 24.22.1`; guard exige igualdad exacta con .node-version |
| SQLite WAL, FULL, foreign_keys y busy_timeout | Passed: valores observados `wal`, `2`, `1`, `5000` |
| FTS5 | Passed: tabla virtual real con búsqueda de un documento ficticio |
| Backup con WAL activo | Passed: API `backup()`, apertura readonly de copia, fila sintética conservada e integrity_check `ok` |
| fsync de archivo/directorio | Passed: llamadas reales sobre filesystem del workspace y bytes conservados tras rename |
| Semántica de fs.rename Node | Passed el test negativo: reemplaza destino; **no** es no-replace |
| renameat2 con RENAME_NOREPLACE | Passed: destino existente produce EEXIST y conserva ambas entradas; destino ausente permite publicar directorio |

La prueba del syscall usa `python3` y `ctypes` contra libc, sin instalar herramientas o bindings nuevos. No se usa `exists()+rename` como sustituto de una operación atómica. El probe elimina exclusivamente sus propios temporales; no accede a Portfolio o SQLite del usuario.

## Límites y gates posteriores

- No hay implementación de publisher en Node: el binding de producción y las pruebas de interrupción del protocolo A/rename/B corresponden a F2/F3. Debe conservarse no-replace real; no reemplazarlo por `fs.rename` ni por comprobación previa vulnerable a carreras.
- fsync exitoso acredita soporte de llamada, no comportamiento de controladores físicos ante corte de energía.
- Esta prueba usa el filesystem local donde se ejecuta. No habilita SQLite en red o carpetas sincronizadas ni compatibilidad con otros SO.
- Las tablas `probe`/`probe_fts` y backups son exclusivamente efímeros de diagnóstico. No se han creado migrations, learners, enrollments, events ni mecanismos de autoridad de F1.
- CLI/servicio/plugin/permisos/dispatch OpenCode se evalúan en un spike separado. La versión de CLI por sí sola no acredita su compatibilidad.
- `better-sqlite3@13.0.3` tiene aprobación de script de instalación fijada por versión; no se aprobaron scripts arbitrarios o comodines.

Los comandos deben volver a ejecutarse si cambia versión de Node/driver, arquitectura o filesystem. No trasladar estos resultados a un entorno diferente como garantía.

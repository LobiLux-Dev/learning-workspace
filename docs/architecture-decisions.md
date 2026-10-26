# Learning Workspace — Decisiones arquitectónicas

**Fecha:** 2026-10-25  
**Estado:** Aceptadas para el diseño v0.1; implementación y pruebas pendientes.

La autoridad normativa de contratos y estados es [learning-workspace-spec-v0.1.md](learning-workspace-spec-v0.1.md). Este registro explica las alternativas elegidas; no introduce un segundo esquema independiente. Una modificación que contradiga una decisión requiere ADR sucesor, cambios coherentes en especificación y pruebas. El [plan incremental](implementation-plan.md) define cuándo comprobarla.

## ADR-001 — Core local, SQLite y adaptadores delgados

**Motivación:** El estado debe sobrevivir pérdida de contexto/modelo sin infraestructura distribuida.

**Decisión:** TypeScript, Node.js 24 LTS, `schemas`, `core` y `cli`; SQLite local con `better-sqlite3`, WAL y backup API. CLI y plugin OpenCode invocan el Core en proceso, con contextos diferentes. No servicios propios, MCP, vector DB ni acceso SQL para agentes. Linux y un learner por workspace son el alcance inicial. Versiones exactas de dependencias se fijan durante bootstrap y no mediante suposiciones documentales.

**Consecuencias:** Persistencia y tests offline simples; el Core es reusable. El disco debe ser local y las dependencias nativas deben comprobarse en la plataforma objetivo. No se promete sincronización ni aislamiento entre usuarios locales.

## ADR-002 — Autoridades explícitas, no sincronización YAML/DB

**Motivación:** Obsidian y Core pueden producir visiones incompatibles si ambos editan estado estructurado.

**Decisión:** SQLite gobierna entidades estructuradas; Markdown gobierna notas libres; snapshots gobiernan contenido publicado. YAML de perfil/enrollment/assignment es exportación regenerable, nunca input automático. Artifacts combinan bytes personales y baseline/procedencia en SQLite. Cambios externos se detectan y se adoptan como revisión nueva, no se aceptan silenciosamente.

**Consecuencias:** No reconciliador bidireccional ni «última escritura gana». El usuario puede editar notas sin herramienta, pero modificar un material gestionado bloquea su uso académico hasta resolver divergencia. El backup necesita DB y archivos.

## ADR-003 — Releases por snapshot con identidad y digest independientes de Git

**Motivación:** Directorios locales no tienen commit; tags y versiones pueden reutilizarse con contenido diferente.

**Decisión:** `package_uid` permanente, namespace fijado y `release_id` local. SemVer obligatorio; `UNIQUE(package_uid,version)`. Inventario canónico `snapshot-sha256-v1` sobre todos los bytes/rutas aceptados; commit opcional como procedencia. Igual UID/versión/digest reutiliza release; contenido diferente se rechaza. Copia local independiente; extracción de árbol Git fijado sin checkout/hooks/filtros/submódulos.

**Consecuencias:** Misma semántica de verificación local y Git; no se depende de fechas/permisos. Digest prueba integridad, no identidad del autor. Renombrar namespace y firmas se posponen. Un autor debe publicar nueva versión para cambiar bytes.

## ADR-004 — Contenido inerte y catálogo independiente de disciplina

**Motivación:** Un paquete educativo no debe convertirse en un proyecto ejecutable ni imponer un esquema de idiomas.

**Decisión:** Catálogo explícito de `resource_id → path`, `media_type`, idioma BCP 47 opcional. Currículo DAG opcional. Recursos, habilidades y módulos se referencian por IDs dentro de release. Allowlist pequeña: Markdown/YAML/texto de licencia e imágenes raster estáticas; rechazar scripts, HTML/SVG y configuraciones/instrucciones activables. No iniciar OpenCode dentro de un paquete.

**Consecuencias:** Se puede validar electrónica o un Notebook de referencia sin CEFR/idioma. Markdown con bloques de código es permitido como texto. Algunas colecciones existentes necesitarán conversión; se evita introducir sanitización compleja o ejecución de ejercicios en MVP.

**Precisión F0 (CF01/CF02):** los bancos publicados identifican fuentes propias por resource_id/digest, sin UUID de release local; Core las vincula a la inscripción al preparar el ítem. `metadata.license_files` permite satisfacer la declaración de textos LicenseRef. Estas precisiones responden a las incompatibilidades reproducidas en [f0-compatibility-findings.md](f0-compatibility-findings.md), no habilitan nuevas capacidades ni cambian la arquitectura.

## ADR-005 — Copia exacta mediante bundle de dependencias

**Motivación:** Mover solo un Markdown rompe enlaces relativos; reescribirlos deja de ser copia exacta.

**Decisión:** Copiar cierre transitivo preservando rutas desde raíz del Notebook en un bundle por material, con bytes idénticos y metadatos externos. No symlinks/hardlinks ni reescritura en `exact-copy`. `..` es legal solo dentro de enlace Markdown que resuelva dentro de raíz; nunca en path de API/inventario. Traducción usa bundle distinto, permite reescribir enlaces validados y conserva fuentes/hashes. Traducción de dependencias Markdown queda fuera del MVP.

**Consecuencias:** Portabilidad y verificación claras a cambio de duplicación limitada por cuotas. Si el cierre no cabe, se rechaza; no se publica una copia rota. Idioma desconocido requiere elección, nunca traducción automática por inferencia.

## ADR-006 — Publicación recuperable, no falsa transacción filesystem/DB

**Motivación:** SQLite no puede hacer commit atómico de archivos Markdown.

**Decisión:** Staging durable + fsync; transacción A con plan/IDs pending; rename atómico sin reemplazo; transacción B con ready y eventos. Reconciliación basada en hashes, sin regenerar con LLM. Staging no es caché. Todo destino nuevo usa IDs para evitar sobrescrituras. Un lock local de workspace serializa publicaciones y escrituras; no mantenerlo durante red/LLM.

**Consecuencias:** Fallos tienen estados observables; readers solo consumen ready. Más simple que una cola distribuida, pero exige pruebas de cada ventana de fallo y filesystem con las garantías declaradas. Edición externa deliberada no forma parte de atomicidad.

## ADR-007 — Journal y hechos inmutables, no event sourcing total

**Motivación:** Se necesita replay de mastery sin duplicar todo el dominio ni diseñar un framework de eventos.

**Decisión:** Ítems, rúbricas, intentos, evaluaciones y decisiones son hechos append-only. Eventos se escriben con hechos/transiciones en la misma transacción y se ordenan por `event_seq`. Las proyecciones se reconstruyen de hechos + decisiones + journal. No prometer reconstrucción de toda la DB desde eventos. Triggers evitan UPDATE/DELETE de historia a través de acceso soportado.

**Consecuencias:** Replay sencillo y auditable, sin payloads duplicados gigantes. Migrations de hechos requieren cautela. Los triggers no protegen frente a propietario host que modifica la DB deliberadamente.

## ADR-008 — Idempotencia persistente y consistencia relacional

**Motivación:** CLI y agentes pueden reintentar tras desconexión o trabajar con una revisión obsoleta.

**Decisión:** Toda mutación lleva clave UUID persistente por workspace y hash de comando/input; mismo contenido/actor/ámbito devuelve mismos IDs. Conflicto no tiene efectos. Revisiones CAS en agregados mutables; FKs compuestas impiden cruces de enrollment/release. Invariantes de cadenas/DAG/JSON se validan bajo lock y se auditan con doctor. No purgar claves en v0.1.

**Consecuencias:** Un reintento no duplica hechos ni aprobaciones; un error terminal necesita nueva clave. No se promete exactly-once de facturación de proveedores. Se añade registro operations pequeño en lugar de middleware distribuido.

## ADR-009 — Rúbrica fijada, propuestas y revisión humana

**Motivación:** Validar JSON no demuestra que una evaluación sea pedagógicamente correcta.

**Decisión:** Persistir ítem, contexto, solución y rúbrica/digest antes de responder. Criterios explícitos con rangos enteros y pesos por skill. Un intento puntuable por ítem; variantes nuevas para nueva evidencia. Toda evaluación que contribuye a mastery exige decisión humana aceptada. Corrección crea evaluación que sustituye cabeza aceptada del mismo intento/rúbrica; no suma evidencia. El LLM no puede aceptar su propuesta ni inventar respuesta del alumno.

**Consecuencias:** Trazabilidad y límites honestos de calidad. Revisión manual añade fricción al MVP, preferible a introducir calibración o automatización injustificada. Usuario-alumno no equivale a experto independiente; esa limitación se muestra.

## ADR-010 — Mastery `mastery-rules-v1` determinista y conservador

**Motivación:** Se exige recuperación reproducible, no un score llamado probabilidad sin calibración.

**Decisión:** Media racional por criterio/habilidad, penalización fija por pistas, ventana de 20 intentos y score en basis points. Sin dependencia del reloj, dificultad autodeclarada ni confianza LLM. Mínimo cinco evidencias y tres contextos para `demonstrated`, además de score ≥8000. Cobertura separada, no intervalo estadístico. Readiness usa prerrequisitos demonstrated; diagnóstico los puede explorar sin falsear readiness. Algoritmo/parámetros/H identifican replay.

**Consecuencias:** Tests exactos, correcciones reproducibles y tres aciertos no bastan para dominio. El algoritmo no está calibrado científicamente; variación de contextos necesita revisión del ítem. BKT, olvido y scheduling temporal se aplazan, no la fórmula inicial.

## ADR-011 — Actualizar crea nueva inscripción sin transferencia

**Motivación:** Reasignar release a una inscripción invalida referencias históricas y mezcla significado de skills.

**Decisión:** Instalar otra release no cambia enrollment. `enroll --from` crea relación nueva, vacía y vinculada, después de backup. No se transfieren evidencias, scores ni materiales; la anterior sigue accesible. Comparación por IDs/hashes no infiere equivalencias de títulos.

**Consecuencias:** Rollback = elegir inscripción anterior, no borrar eventos. La continuidad pedagógica entre versiones queda manual, pero no requiere resolver migraciones semánticas para empezar.

## ADR-012 — Seguridad por API y herramientas, no sandbox prometida

**Motivación:** Core no intercepta comandos host que no lo invocan; prompts no son ACL.

**Decisión:** Core con contexto de autoridad interno derivado de runtime confiable. Plugin con allowlist por rol, denegación de shell/escritura/lectura genéricos y delegación restringida. Aprobación en canal confiable, ligada a hash, un uso y cinco minutos; no tokens del modelo. Notebooks read-only por permisos/convenio y hash, no protección contra propietario host. Sandbox de SO solo para futuras necesidades de amenaza mayor.

**Consecuencias:** Garantía comprobable sin infraestructura innecesaria. Perfil mal configurado falla cerrado; no se ofrece como seguro un OpenCode con plugins arbitrarios. El administrador sigue pudiendo modificar su disco y datos ya divulgados no pueden retirarse.

## ADR-013 — Plugin nativo OpenCode V2, integración versionada

**Motivación:** Campos V1 y wrappers genéricos no constituyen contrato vigente de permisos V2.

**Decisión:** Plugin local con `@opencode/plugin`, `Plugin.define`, `ctx.tool.transform`, herramientas directas `codemode: false` y `ctx.permission.assert` en cada ejecutor. Usar `permissions`, `shell`, `subagent`; no legacy `.opencode/tools/`. Dos agentes habilitados (primary/tutor), resto formal pero deshabilitado. Verificar políticas efectivas de hijos/ancestros/sesión y pin exacto CLI/servicio/plugin durante bootstrap. Snapshots OpenCode desactivados en perfil; undo conversacional no revierte Core.

**Consecuencias:** No hace falta MCP o servicio propio. Compatibilidad de herramientas, aprobación y hooks exige smoke test real, no solo docs. Si una versión no puede imponer el contrato, adaptador bloqueado mientras CLI/Core permanecen utilizables.

## ADR-014 — Consentimiento por destino y categoría, sin prometer offline remoto

**Motivación:** Local-first no evita que proveedor reciba texto, respuestas, compactaciones o títulos.

**Decisión:** Sin consentimiento no se exponen datos personales a modelo remoto. Grants por destino/modelo/fines/categorías, expiran al terminar sesión o 24 h por defecto. Notas/assets privados fuera por defecto. Verificar en herramientas y antes de dispatch de todos los flujos V2; si un flujo no puede bloquearse, deshabilitarlo o bloquear modo remoto. Revocación/cambio de destino interrumpe sesión y requiere contexto rehidratado en sesión nueva. Registrar disclosures mínimos, no cuerpos duplicados. El chat pegado por usuario y otros procesos están fuera de garantía.

**Consecuencias:** Se puede usar offline o con modelo local; switching de modelos no reenvía historial de forma inadvertida. Auditoría no es borrado remoto ni cifrado propio. El usuario debe conocer que historial OpenCode y backups también son privados.

## ADR-015 — Recuperación y backup incluidos; caché siempre prescindible

**Motivación:** No se puede posponer backup y a la vez prometer recuperación de una DB corrupta.

**Decisión:** Backup SQLite mediante API bajo lock, copia de Portfolio/snapshots y manifest hasheado. Restore siempre a workspace nuevo; no sobrescritura. `doctor` diagnostica sin reparar. FTS5 en cache SQLite separada, memoria de plantilla versionada; rebuild reemplaza solo derivados. Notas no se indexan sin opt-in.

**Consecuencias:** Pérdida de caché no pierde progreso. Corrupción de DB sin backup sigue siendo pérdida potencial real. Editores externos deben pausarse para backup consistente. Cifrado, sync, retención/GC y exportaciones avanzadas se aplazan; backup mínimo y pruebas de restore son obligatorios.

## Correspondencia con los 11 hallazgos

| Hallazgo | ADR |
|---|---|
| Límite real del Core y autoridad | 012, 013 |
| Fuentes de verdad/modificación externa | 002 |
| Consistencia DB/archivos | 006, 008, 015 |
| Rúbricas/replay/mastery | 007, 009, 010 |
| Identidad release/directorio local | 003 |
| Catálogo/idioma | 004 |
| Copia/enlaces/assets | 005 |
| Relaciones/transiciones | 008, 009 |
| Actualizaciones históricas | 011 |
| Privacidad/divulgación | 014 |
| OpenCode V2 | 013 |

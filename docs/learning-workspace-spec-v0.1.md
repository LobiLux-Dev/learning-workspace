# Learning Workspace — Especificación técnica v0.1

**Estado:** Contrato de diseño cerrado para el MVP; implementación pendiente  
**Fecha:** 2026-10-25  
**Ámbito:** TypeScript, CLI local, OpenCode V2 y Obsidian  
**Relación con OpenTutor:** Independiente de su código y base de datos.

Este documento es normativo: «debe» indica requisito de v0.1. Los ejemplos son contratos de datos, no código implementado. Los identificadores ilustrativos deben sustituirse por UUIDv7 válidos y los hashes por SHA-256 reales. Las decisiones y su motivación están en [architecture-decisions.md](architecture-decisions.md); la ejecución y sus puertas de aceptación, en [implementation-plan.md](implementation-plan.md). No se inicia implementación automáticamente por cerrar este diseño.

**Aclaraciones F0 (2026-10-25):** referencias publicadas de bancos de ítems y declaración de textos LicenseRef precisadas tras comprobar las incompatibilidades CF01/CF02 en [f0-compatibility-findings.md](f0-compatibility-findings.md). No se modifica identidad de release ni se implementa persistencia por estas aclaraciones.

## 1. Propósito, invariantes y alcance operativo

Learning Workspace es un entorno local de aprendizaje. OpenCode es su interfaz conversacional principal; el CLI permite administración, aprobación y recuperación sin LLM. Obsidian permite leer Markdown y editar notas personales. El Core valida el dominio y persiste sus cambios. No se requieren servicios de red propios, Obsidian, un proveedor concreto ni memoria de conversación para recuperar el estado.

Invariantes:
1. Notebook es la autoridad del contenido educativo publicado; cada release instalada es un snapshot inmutable. Autoría y publicación son flujos separados, fuera del MVP.
2. Nombre visible no es identidad. `package_uid` es permanente; `package_id` es un namespace humano, no una prueba de autoría.
3. Una inscripción tiene un único learner y una única release durante toda su vida. Actualizar instala otra release; continuar en ella crea otra inscripción.
4. Portfolio es independiente: contiene notas, materiales, evidencias y estado personal. Nunca modifica el contenido fuente.
5. SQLite es la autoridad de los datos estructurados. Intentos, rúbricas fijadas, evaluaciones, decisiones de revisión y eventos aceptados no se sobrescriben.
6. El LLM propone contenido o evaluaciones. No ejecuta SQL, no elige su autoridad y no escribe directamente estado académico.
7. Mastery, índices, checkpoints de proyección y memorias son derivados reconstruibles. Leer no aporta mastery.
8. Contenido descargado y respuestas de modelos son datos no confiables. No habilitan herramientas, instrucciones, configuraciones ni ejecución.
9. Toda mutación pública lleva clave de idempotencia. Los cambios con archivos usan el protocolo recuperable de §6.
10. El esquema base es agnóstico a disciplina. Idioma es metadato opcional de un recurso, no un nivel pedagógico obligatorio.
11. Operaciones destructivas requieren usuario, ámbito, confirmación y backup. Borrado de historial, garbage collection y eliminación de releases no se exponen en v0.1.

MVP: un usuario local, un learner activo por workspace, varias inscripciones, disco local y Linux como plataforma de aceptación inicial. No SQLite sobre carpetas sincronizadas o sistemas de archivos de red. Otros SO se añaden tras verificar rutas, bloqueos y durabilidad. El Core no depende de OpenCode; su adaptador sí.

## 2. Componentes, directorios y fuentes de verdad

```text
learning-workspace/
├── .opencode/
│   ├── agents/                       # definiciones confiables, suministradas por el proyecto
│   └── plugins/learning/index.ts      # adaptador V2; único acceso de agentes al Core
├── opencode.jsonc                    # configuración de aprendizaje controlada por usuario
├── notebooks/<release_id>/           # snapshot; sin .git, symlinks ni configuración ejecutable
├── portfolio/
│   ├── exports/profile.yaml          # exportación regenerable; no se importa automáticamente
│   ├── enrollments/<enrollment_uid>/
│   │   ├── materials/<material_uid>/ # bundle de copia o traducción
│   │   ├── generated/<artifact_uid>/ # ejercicios, suplementos y explicaciones
│   │   ├── notes/                    # Markdown libre del alumno
│   │   └── assets/<artifact_uid>/
│   ├── .staging/<operation_uid>/     # duradero hasta publicar; NO es caché
│   └── data/learning.sqlite
├── cache/                            # FTS, exportaciones auxiliares y memoria derivada
├── backups/                          # backups consistentes; privados, fuera del vault recomendado
├── workspace.yaml                    # configuración local no secreta
└── AGENTS.md                         # instrucciones confiables del workspace
```

El vault recomendado es `portfolio/enrollments/`; SQLite, staging, backups y configuración quedan fuera. Se permiten otros vaults por decisión del usuario, pero Obsidian no debe editar archivos gestionados. Los enlaces se resuelven por reglas del Core, no por búsqueda de nombres de Obsidian. El acceso directo a Notebooks desde un vault es opcional y solo de lectura por convenio; no proporciona aislamiento frente a Obsidian o al propietario del disco.

| Información | Autoridad | Modificación externa |
|---|---|---|
| Contenido publicado | Bytes del snapshot de release + digest registrado | Divergencia: cuarentena lógica; no aceptar nuevos trabajos desde esa release |
| Perfil, enrollments, sesiones, assignments, ítems, intentos, evaluaciones, consentimientos y eventos | SQLite | No edición SQL soportada; integridad detectada por `doctor` no equivale a protección contra manipulación deliberada |
| Notas personales | Markdown en `notes/` | Permitida; no produce progreso ni evaluación |
| Bytes de materiales y assets personales gestionados | Archivos publicados en Portfolio | Comparar hash antes de usar; no sobrescribir ni adoptar silenciosamente |
| Identidad, procedencia, estado y hash esperado de esos archivos | SQLite | Cambios solo mediante Core |
| YAML de perfil/inscripción/assignment | Exportaciones SQLite | Editarlos no cambia estado; regeneración solo explícita y sin tratarlo como importación |
| Mastery, FTS y memoria | Proyecciones de datos persistentes | Se descartan y reconstruyen; jamás sustituyen evidencias |
| Configuración de runtime | `workspace.yaml` y configuración OpenCode confiable | Cambiarla requiere reiniciar/revalidar el adaptador; secretos fuera del workspace |

No hay sincronización bidireccional YAML/SQLite. `init` crea el perfil en SQLite; `profile set` valida cambios y regenera la exportación por el protocolo de archivos. Un `learner_uid` no se cambia por edición del perfil.

Archivos gestionados modificados externamente: `doctor` informa `modified` o `missing`; la lectura como fuente académica falla con `ARTIFACT_DIVERGED`. `portfolio adopt <artifact_uid>` autorizado por usuario captura los bytes actuales como **nuevo artifact** `user-provided`, enlazado con `derived_from`, y los publica en otro directorio. No modifica el hash esperado, la procedencia o las referencias del original. Un material sustituto requiere un assignment nuevo con `supersedes_assignment_uid`; el anterior y sus intentos se conservan. Nunca se restaura encima de cambios del usuario: recuperar bytes esperados crea otra copia o requiere restauración explícita con backup.

## 3. Identidad, instalación y release verificable

### 3.1 Identificadores

- UUIDv7 para entidades locales y `package_uid`; se comparan por valor, no por nombre.
- `package_id`: ASCII minúsculo, formato `host/owner/name`, segmentos `[a-z0-9][a-z0-9._-]*`. En v0.1, UID y namespace quedan fijados en la primera instalación aprobada. Cambio de cualquiera desde un origen conocido: `IDENTITY_CONFLICT`, sin actualización implícita. Renombrar namespace queda fuera del MVP.
- `release.version`: SemVer obligatorio para v0.1; no implica compatibilidad pedagógica.
- `release_id`: UUID local asignado al aceptar el snapshot. Identidad de contenido: `(package_uid, version, content_digest)`. Restricción `UNIQUE(package_uid, version)`; misma versión y digest se reutiliza, misma versión con digest distinto se rechaza `VERSION_CONTENT_CONFLICT`, incluso con otro commit.
- Un mismo digest observado desde otro origen agrega procedencia; no duplica la release. Commits y URLs pertenecen a registros de origen, no son su identidad.
- IDs de recursos, módulos, criterios y habilidades: ASCII `[a-z0-9][a-z0-9-]{0,63}`. Su ámbito es la release; no equivalencia automática entre paquetes o versiones.

### 3.2 Snapshot y digest canónico `snapshot-sha256-v1`

1. Local: copiar archivos desde la ruta elegida por el usuario a staging privado, sin enlaces ni hardlinks al origen. Git: obtener el árbol de un commit completo fijado, sin checkout de trabajo, hooks, submódulos, Git LFS, filtros ni código del paquete. HTTPS es el único transporte remoto de v0.1; sin credenciales en URLs, protocolos `file/ext/ssh`, redirecciones a redes privadas ni helpers arbitrarios. Deshabilitar configuración Git global/sistema para la operación; ejecutar binario confiable con argumentos separados, nunca interpolar shell. Credenciales solo por canal externo confiable. La importación local cubre repos privados no accesibles por este transporte.
2. En importación local solo `.git/` se excluye como metadato de transporte. Todo otro archivo se incluye o causa rechazo; no omitir archivos desconocidos en silencio. El commit Git no incluye `.git/`. Rechazar submódulos, entradas simbólicas, ficheros especiales y ejecutables marcados. Una copia local que cambia durante captura aborta si difieren hashes/estadísticas de las dos lecturas; la autoridad aceptada sigue siendo el snapshot capturado, no el directorio mutable.
3. Rutas de archivo relativas POSIX, UTF-8 NFC, máximo 240 bytes, segmentos portables sin controles, `:`, `\\`, `%`, nombres reservados de Windows, punto/espacio final o segmentos vacíos, `.`/`..`. Rechazar colisiones por case-fold Unicode. No normalizar dos nombres diferentes al mismo destino. Máximo 2.000 archivos, 100 MiB por snapshot, Markdown/YAML 2 MiB por archivo y assets 10 MiB. Límite de captura Git temporal: 200 MiB, 60 segundos; cancelar sin publicar si excede. Ajustes de límites solo por usuario, registrados en configuración.
4. Crear inventario de **todos** los archivos aceptados: `[{path,size,sha256}]`, orden por bytes UTF-8 de `path`. Serializar JSON compacto UTF-8 con claves exactamente `path,size,sha256`, hashes hex minúsculos, sin espacios ni salto final. `content_digest = SHA256(UTF8("learning-snapshot-v1\n") || inventory_bytes)`. Tamaños son bytes; no convertir saltos de línea, frontmatter ni Unicode del cuerpo. No incluir permisos, fechas, staging ni inventario generado por el instalador. Guardar inventario en SQLite, fuera del árbol hasheado.
5. Validar manifiestos, dependencias de archivos y enlaces sobre staging. Tras consentimiento de instalación se publica `notebooks/<release_id>/` por §6 y se registra inventario, origen y digest. El directorio es de solo lectura por convenio y permisos POSIX sin escritura, no una sandbox contra su propietario.

`verification_status`: `verified` significa integridad y contrato comprobados, **no autoría confiable**. Un autor puede publicar sus propios hashes falsamente; solo firmas/trust externa resolverían autenticidad. Estados de release: `pending` durante publicación, `ready` tras B, `failed` si no se publica, `quarantined` si diverge después de ready. Solo ready admite nuevo consumo; los datos históricos siguen consultables en cuarentena. Verificar archivos extra, ausentes y diferentes; no reparar automáticamente. Reinstalar la misma release exige bytes idénticos al inventario y publicación recuperable; no reemplazar evidencia personal. Un registro failed reserva su UID/versión/digest; una nueva operación puede recuperar exclusivamente esos mismos bytes hacia ready, sin aceptar contenido diferente bajo esa versión.

La cuarentena es terminal en v0.1: no reparar ni sobrescribir un snapshot divergente. `notebook add` sobre esa release devuelve `RELEASE_QUARANTINED`; recuperar mediante backup verificado a workspace nuevo o instalar otra versión. Recuperar failed no es reparar ready/quarantined: solo reanuda publicación nunca aceptada como disponible, con aprobación nueva y el inventario idéntico.

## 4. Contrato Notebook `schema_version: '1.0'`

Los esquemas de `schemas` son la única definición ejecutable y generan JSON Schema. Validación estricta de campos desconocidos excepto `extensions`, que contiene JSON bajo claves con namespace y no otorga permisos. YAML 1.2, sin tags personalizados, objetos ejecutables ni aliases; claves duplicadas son error. No interpolación de entorno, includes ni expansión de comandos.

```yaml
schema_version: '1.0'
identity:
  package_uid: '019a3dd5-4a10-7a90-8eef-3174e0386931'
  package_id: 'github.com/academy-a/electronics-fundamentals'
  name: 'Electronics Fundamentals'
release:
  version: '1.0.0'
metadata:
  description: 'Fundamentos de circuitos'
  authors: [{name: 'Academy A'}]
  license: 'CC-BY-4.0'
  tags: [electronics, fundamentals]
content:
  entrypoint_resource_id: 'overview'
  resources_manifest: 'resources/index.yaml'
  assets_manifest: 'assets/manifest.yaml'
  curriculum_path: 'curriculum/index.yaml'
capabilities:
  curriculum: true
  diagnostics: false
  assessments: false
extensions: {}
```

`resources_manifest` es obligatorio; `assets_manifest` es opcional si no hay assets. `curriculum_path` existe exactamente cuando `curriculum: true`. `diagnostics`/`assessments` indican bancos de ítems revisados por autor; si son `true`, deben incluir `capabilities.diagnostic_items_path`/`capabilities.assessment_items_path` con catálogos que cumplen las reglas de contenido/rúbrica de §7 y el formato publicado de §4.1. Cada path declarado debe tener su catálogo disponible; no basta presentar cualquier banco para satisfacer ambas capacidades. Si son `false`, el tutor puede proponer ítems en Portfolio pero no atribuirlos al Notebook. Un Notebook sin currículo permite lectura/materialización; diagnóstico, mastery y selección adaptativa devuelven `CAPABILITY_UNAVAILABLE`. No se inventan habilidades para simular compatibilidad.

### 4.1 Catálogo de recursos y currículo

```yaml
# resources/index.yaml
schema_version: '1.0'
resources:
  - id: 'overview'
    path: 'index.md'
    media_type: 'text/markdown'
    title: 'Introducción'
  - id: 'ohms-law'
    path: 'resources/ohms-law.md'
    media_type: 'text/markdown'
    title: 'Ley de Ohm'
    language: 'es-MX'
extensions: {}
```

`language` BCP 47 es opcional; ausencia = desconocido, nunca inferencia automática. Recurso desconocido puede copiarse a petición expresa, sin prometer idioma. Idiomas diferentes requieren elección del usuario entre fuente y traducción. El match por defecto es igualdad del tag canónico; no asumir `es` = `es-MX`. Se exige licencia de paquete; overrides de licencia/atribución en recursos o assets son opcionales. `LicenseRef-*` necesita texto de licencia incluido y ruta declarada; sin derechos suficientes para copiar/traducir se bloquea la operación, no se infieren del modelo.

Para licencias personalizadas, `metadata.license_files` es un mapa opcional `{LicenseRef-ID: 'licenses/ID.txt'}`. Toda LicenseRef usada en paquete, recursos o assets debe tener entrada; sus paths son relativos portables. F0 valida declaraciones y referencias; F2 comprueba existencia y bytes del texto en el snapshot. Un identificador SPDX reconocido o una declaración LicenseRef no prueba derechos ni autenticidad.

Un banco publicado contiene `schema_version`, `items` y `extensions`. Cada `CatalogItemDefinition` tiene `definition_id`, enunciado, habilidades, contexto, solución, rúbrica, procedencia y `source_refs` del propio Notebook con forma **`{resource_id, digest}`**, nunca `release_id`: ese UUID solo existe en cada instalación local. El autor puede calcular el digest del recurso publicado sin conocer al estudiante o su workspace. Al preparar el ítem, el Core verifica esos recursos/hashes y fija el `release_id` de la inscripción en las referencias completas de Portfolio (`{release_id, resource_id, digest}`); no acepta IDs locales del autor. Las propuestas ya vinculadas a una inscripción también usan refs completas. Los bancos se validan asociados a sus paths declarados, no como una colección anónima que pueda ocultar un banco ausente.

```yaml
# curriculum/index.yaml
schema_version: '1.0'
modules:
  - id: 'dc-basics'
    title: 'Circuitos de corriente continua'
    resource_ids: ['ohms-law']
    skill_ids: ['understand-voltage', 'understand-resistance', 'apply-ohms-law']
skills:
  - id: 'understand-voltage'
    description: 'Interpretar diferencia de potencial'
    prerequisites: []
  - id: 'understand-resistance'
    description: 'Interpretar resistencia eléctrica'
    prerequisites: []
  - id: 'apply-ohms-law'
    description: 'Resolver relaciones entre V, I y R'
    prerequisites: ['understand-voltage', 'understand-resistance']
extensions: {}
```

Unicidad por catálogo, rutas únicas de recurso, referencias válidas, DAG sin autorreferencias. No exigir idioma, CEFR ni metadatos de una disciplina. Cambiar significado de un ID requiere nuevo ID; la herramienta de comparación solo detecta diferencias de contenido, no garantiza equivalencia semántica.

### 4.2 Formatos, assets y contenido inerte

Allowlist v0.1: Markdown UTF-8, YAML UTF-8, texto de licencia `.txt`, PNG, JPEG y WebP estáticos (validar firma y decodificación, máximo 20 megapíxeles). No PDF, SVG, HTML, audio, ejecutables, archivos de configuración ni archivos comprimidos en paquetes v0.1; ampliar formatos exige revisión posterior. Bloques de código Markdown son texto permitido, nunca ejecución. El fixture usa PNG en vez de SVG para evitar sanitizador activo en MVP.

```yaml
# assets/manifest.yaml
schema_version: '1.0'
assets:
  - id: 'circuit-01'
    path: 'assets/circuit-01.png'
    media_type: 'image/png'
    origin: 'author-provided'
    license: 'CC-BY-4.0'
    sha256: '<64-hex>'
```

Todo asset debe estar inventariado y en manifest. Rechazar HTML crudo, imágenes remotas, embeds activos y esquemas `javascript:`, `data:`, `file:`, `obsidian:` o similares. HTTPS en enlaces ordinarios se permite solo como texto navegable con advertencia; no se descarga automáticamente. Se rechazan wikilinks/embeds de Obsidian en contenido publicado v1; las notas personales sí pueden usarlos, sin procesarlos como instrucciones.

Rechazar, en cualquier nivel y sin depender de mayúsculas, `.opencode`, `.obsidian`, `.gitmodules`, `.gitattributes`, `AGENTS.md`, `CLAUDE.md`, `opencode.json(c)`, `SKILL.md` y scripts/configuraciones fuera de allowlist. Nunca iniciar OpenCode, cargar plugins, hacer import de módulos o explorar como proyecto dentro de un Notebook. Se leen recursos por herramientas del Core; sus textos no se añaden a fuentes de instrucciones. Esto reduce prompt injection, pero no garantiza que un modelo ignore instrucciones maliciosas: la autoridad debe seguir limitada aunque las obedezca.

## 5. Portfolio: contratos, estados y materialización

### 5.1 Perfil e inscripción

Ejemplos de **exportaciones** SQLite, no archivos editables de entrada:

```yaml
schema_version: '1.0'
learner_uid: '019a3dda-cc44-73c0-989a-2e14c65d13e1'
preferred_instruction_language: 'es-MX'
preferences:
  explanation_detail: 'adaptive'
  preferred_session_minutes: 25
```

```yaml
schema_version: '1.0'
enrollment_uid: '019a3ddb-3c68-7c34-9677-048ac9a7d1f8'
learner_uid: '019a3dda-cc44-73c0-989a-2e14c65d13e1'
release_id: '<uuid>'
notebook:                         # vista obtenida por JOIN; no campos mutables duplicados
  package_uid: '019a3dd5-4a10-7a90-8eef-3174e0386931'
  version: '1.0.0'
  content_digest: '<64-hex>'
status: 'active'
previous_enrollment_uid: null
```

No duplicar `package_uid` en `enrollments`: se obtiene de `release_id`. Los eventos sí capturan package/release/digest como procedencia histórica.

### 5.2 Assignment y artifact

```yaml
schema_version: '1.0'
assignment_uid: '<uuid>'
enrollment_uid: '<uuid>'
release_id: '<uuid>'
source_resource_id: 'ohms-law'
source_digest: '<64-hex>'
material_uid: '<uuid>'
objective_skill_ids: ['understand-voltage', 'understand-resistance', 'apply-ohms-law']
status: 'assigned'
supersedes_assignment_uid: null
```

`prepareAssignment` primero crea assignment `preparing`; solo pasa a `assigned` cuando su artifact principal y dependencias están `ready`. Fuente y objetivos deben pertenecer a la release inscrita. Un recurso sin currículo permite lista de objetivos vacía. Un assignment tiene una materialización primaria; suplementos son artifacts relacionados, no modos alternativos de una misma copia.

Artifact: `artifact_uid`, `enrollment_uid`, `kind` (`material|exercise|supplement|asset|export`), `mode?` (`exact-copy|translation` solo para material), `relative_path`, inventario de archivos y hashes, `origin`, `source_refs[]`, `derived_from?`, `language?`, `provider_ref?`, `model_ref?`, `generation_request_uid?`, `license`, `attribution`, `review_status` (`not-required|unreviewed|reviewed`), `state` (`pending|ready|failed`). `origin`: `copied-from-notebook|translated|ai-generated|user-provided|external`. Nunca atribuir suplementos o traducciones al autor como aprobados por él. `reviewed` requiere decisión de usuario y no es garantía de precisión. Hashes, origen, path y source refs son inmutables una vez `ready`; problemas de integridad se registran aparte y no cambian el hash esperado.

### 5.3 Copia exacta y enlaces

Para `exact-copy` se publica un bundle privado por material, preservando **rutas relativas desde la raíz del Notebook**:

```text
materials/<material_uid>/
├── index.md                         # si forma parte del cierre de dependencias
├── resources/ohms-law.md            # bytes idénticos
└── assets/circuit-01.png             # bytes idénticos
```

El documento principal es `materials/<material_uid>/resources/ohms-law.md`. Su cierre transitivo de enlaces locales incluye Markdown enlazado y assets, deduplicados por ruta, más los textos LicenseRef efectivos necesarios para conservar sus términos; no copiar el paquete completo por defecto. Un enlace puede contener `..` **solo como referencia Markdown** si, resuelto desde el documento, permanece dentro de la raíz del bundle/release; nunca se acepta en un path de API o de inventario. Decodificar URLs una vez, rechazar escapes ambiguos/dobles y revalidar contención. Admitir enlaces relativos CommonMark, referencias y fragmentos locales; queries locales no se admiten. Validar destino existente y fragmento mediante slug de encabezado CommonMark: texto plano en minúsculas, espacios a `-`, quitar puntuación salvo `-`/`_`, duplicados sufijados `-1`, `-2`. Exportar esta regla como contrato de parser y comprobarla en fixtures; sin dependencia del slug de Obsidian. Fragmentos inválidos son error de validación.

No symlinks ni hardlinks. No reescribir enlaces, frontmatter o saltos de línea en copia exacta. Metadatos solo en SQLite; exportación sidecar fuera del árbol copiado. Verificar igualdad byte a byte del documento y de cada dependencia antes de marcar `ready`. Si el cierre excede cuotas se aborta antes de asignar; no se publica copia rota ni se etiqueta una adaptación como exacta.

`translation`: conservar `source_resource_id`, release/digest e inventario fuente; salida nueva, procedencia de generación y licencia. El modelo devuelve cuerpo Markdown y mapa explícito de enlaces, nunca paths de destino. El Core publica bundle separado, copia dependencias exactas, permite reescribir enlaces y valida de nuevo cierre y fragmentos. En v0.1 solo se traduce el recurso principal; Markdown relacionado se copia sin traducir y se informa. Ninguna traducción automática tiene `reviewed` por defecto. Si no hay proveedor/consentimiento, devolver `TRANSLATION_UNAVAILABLE` y ofrecer lectura del original; no bloquear el resto del aprendizaje.

### 5.4 Estados y transiciones

Toda transición verifica actor, pertenencia, estado previo e integridad en la misma transacción de su evento. Transición no listada = error `INVALID_TRANSITION`. Cada agregado mutable lleva `revision` entero, iniciado en 1; comando exige entrada por ID en `expectedRevisions` y hace compare-and-swap. Artifacts pending y publications son estados internos del protocolo, no admiten UPDATE arbitrario por agente.

| Agregado | Transiciones permitidas | Condición |
|---|---|---|
| Release | creación → `pending`; `pending` → `ready` o `failed`; `failed` → `pending`; `ready` → `quarantined` | A emite NotebookInstallStarted; B emite NotebookInstalled; fallo emite NotebookInstallFailed. Reintento desde failed exige nueva operación/aprobación, inventario idéntico, CAS y NotebookInstallRetried; después mismo protocolo. Quarantined es terminal |
| Enrollment | creación → `active`; `active` ↔ `paused`; `active` o `paused` → `archived` | Solo usuario cambia estado; pausar/archivar exige no tener sesión activa; archive es terminal |
| Assignment | creación → `preparing`; `preparing` → `assigned` o `failed`; (`assigned`, `opened`, `read_declared`) → `practicing`; `assigned` → `opened` o `read_declared`; `opened` → `read_declared`; `practicing` → `completed`; (`preparing`, `assigned`, `opened`, `read_declared`, `practicing`, `failed`) → `cancelled` | `completed` exige al menos un intento persistido y confirmación del alumno; no significa dominio. `failed`, `cancelled`, `completed` terminales salvo `failed` → `cancelled`; reintento de fallo crea assignment nuevo |
| Session | creación → `active`; `active` → `paused` o `finished`; `paused` → `active` o `finished` | Enrollment activo; máximo una sesión `active` por enrollment; finish no elimina intentos pendientes de evaluar |
| Artifact | creación → `pending`; `pending` → `ready` o `failed` | Publicación por §6; estado final no se reescribe |
| Assessment | creación → propuesta `pending`; decisión nueva `accepted` o `rejected` | Decisión terminal por evaluación; nueva corrección no edita la anterior |

Abrir/leer repetidamente es observación idempotente sin regresión de estado. Se puede practicar sin declarar lectura. No se admiten intentos nuevos en assignment terminal ni enrollment no activo. Se pueden registrar/revisar evaluaciones de intentos existentes aunque la sesión haya terminado o inscripción esté pausada/archivada; historia y proyección siguen siendo corregibles. El estado `pending/accepted/rejected` de assessment es una vista de su decisión append-only, no UPDATE del contenido original.

`quarantineNotebook` solo cambia ready a quarantined y emite NotebookQuarantined una vez con causa/hashes observados. Otra cuarentena sobre quarantined con revisión actual es no-op: operation completed, sin incremento de revisión ni otro evento de transición; reporte actual conserva el diagnóstico. Sobre pending/failed se rechaza INVALID_TRANSITION. Misma clave devuelve resultado original, incluso tras cambios posteriores; clave nueva con revisión vieja falla REVISION_CONFLICT. Verificar repetidamente no crea releases, no reinicia publicación ni levanta cuarentena. Reintentar una instalación ya ready con mismos bytes solo reutiliza release/origen bajo idempotencia, sin NotebookInstalled adicional ni cambio de estado.

## 6. Persistencia, archivos, eventos y recuperación

### 6.1 SQLite y concurrencia local

SQLite con `foreign_keys=ON` por conexión, WAL, `synchronous=FULL`, `busy_timeout=5000`; transacciones cortas `BEGIN IMMEDIATE` para mutaciones. Un bloqueo exclusivo del workspace serializa operaciones de escritura del Core, publicaciones, reconciliación y backups; el SO libera el bloqueo al morir un proceso. No ejecutar LLM/red durante una transacción o mientras se mantiene ese bloqueo: generación produce propuestas primero, commit después. Lectores pueden coexistir. Un segundo escritor espera hasta 5 s y devuelve `WORKSPACE_BUSY`, sin repetir efectos externos.

Tablas normativas (columnas de auditoría, NOT NULL, CHECK y versiones de esquema deben materializarse en migrations):

| Tabla | Claves y contenido mínimo |
|---|---|
| `notebooks` | `package_uid PK`, `package_id UNIQUE`, nombre |
| `notebook_releases` | `release_id PK`, `package_uid FK`, `version`, `digest`, `digest_algorithm`, `inventory_json`, `install_path UNIQUE`, `state`, `revision`, `UNIQUE(package_uid,version)` |
| `release_origins` | `origin_uid PK`, `release_id FK`, `source_type` (`local` o `git`), `source_url_or_path`, `resolved_commit NULL`, `installed_at`; commit obligatorio solo para Git |
| `learners` | `learner_uid PK`, preferencias JSON validadas, `revision`; v0.1 una fila |
| `enrollments` | `enrollment_uid PK`, `learner_uid FK`, `release_id FK`, `previous_enrollment_uid FK NULL`, `status`, `revision`, `UNIQUE(enrollment_uid,release_id)` |
| `resources` | PK `(release_id,resource_id)`, `path`, `digest`, `language NULL`, metadata; `UNIQUE(release_id,path)` |
| `modules`, `skills` | PK `(release_id,module_id)` / `(release_id,skill_id)`, metadatos |
| `module_resources`, `module_skills`, `skill_prerequisites` | Claves compuestas dentro de la misma release; dos FKs de skill para cada arista |
| `assignments` | `assignment_uid PK`, `enrollment_uid`, `release_id`, `resource_id`, `source_digest`, `material_uid FK NULL` mientras preparing, `status`, `revision`, `supersedes_assignment_uid NULL`; `UNIQUE(assignment_uid,enrollment_uid,release_id)` |
| `assignment_skills` | PK `(assignment_uid,skill_id)`, `enrollment_uid`, `release_id`; FKs compuestas a assignment y skill |
| `sessions` | `session_uid PK`, `enrollment_uid FK`, `kind` (`study` o `diagnostic`), `status`, tiempos, `revision`, `UNIQUE(session_uid,enrollment_uid)`; índice UNIQUE parcial por enrollment WHERE status='active' |
| `items` | `item_uid PK`, `enrollment_uid`, `release_id`, `assignment_uid NULL`, `context_key`, `item_snapshot_json`, `rubric_snapshot_json`, `rubric_digest`, `provenance_json`, `created_event_seq`; `UNIQUE(item_uid,enrollment_uid,release_id)` |
| `item_skills` | PK `(item_uid,skill_id)`, `enrollment_uid`, `release_id`; FKs compuestas a item y skill |
| `attempts` | `attempt_uid PK`, `session_uid`, `enrollment_uid`, `release_id`, `assignment_uid NULL`, `item_uid`, snapshots de ítem/rúbrica/respuesta, `served_hint_count`, `declared_external_hints`, `hint_through_event_seq`, `hints_used`, contexto, `submitted_at`, `submitted_event_seq UNIQUE`; UNIQUE de item por enrollment (un intento puntuable por ítem) |
| `assessments` | `assessment_uid PK`, `attempt_uid FK`, `supersedes_assessment_uid FK NULL`, `rubric_digest`, `criteria_scores_json`, feedback, evaluador/proveedor/modelo, `confidence_in_evaluation NULL`, `recorded_event_seq UNIQUE`; inmutables |
| `assessment_decisions` | `decision_uid PK`, `assessment_uid FK UNIQUE`, `decision` (`accepted` o `rejected`), razón, actor, `event_seq UNIQUE`; append-only |
| `artifacts` | `artifact_uid PK`, `enrollment_uid FK NULL` solo para export global, `kind`, `mode NULL`, `relative_path UNIQUE`, inventario/hashes, procedencia/licencia/revisión, `state`, `operation_uid FK`; `UNIQUE(artifact_uid,enrollment_uid)` |
| `artifact_observations` | `observation_uid PK`, `artifact_uid FK`, estado (`missing`, `modified`, `ok`), hashes observados, instante; no cambia baseline |
| `operations` | `operation_uid PK`, clave de idempotencia UNIQUE por workspace, tipo, hash input canónico, estado (`pending`, `completed`, `failed`), plan de publicación JSON, resultado/error JSON, actor |
| `learning_events` | `event_seq INTEGER PRIMARY KEY AUTOINCREMENT`, `event_uid UNIQUE`, agregado/tipo, `aggregate_revision`, `schema_version`, payload JSON, actor runtime, `operation_uid FK`, `occurred_at`, `recorded_at`; UNIQUE `(aggregate_type,aggregate_uid,aggregate_revision)` |
| `mastery_states` | PK `(enrollment_uid,skill_id)`, `release_id`, `score_bps NULL`, `evidence_count`, `context_count`, `coverage_gap_bps`, `label`, `algorithm_version`, `through_event_seq` |
| `projection_runs` | `run_uid PK`, enrollment, algoritmo/parámetros, `through_event_seq`, digest de resultado, fecha |
| `consent_grants` | `grant_uid PK`, learner/enrollment, proveedor/endpoint/modelo, categorías, fines, expiración y evento; inmutables |
| `consent_revocations`, `disclosures` | Revocaciones append-only; disclosures con grant, destino, fin, refs/hashes/categorías y fecha; sin cuerpos privados duplicados |

Restricciones obligatorias adicionales:
- FKs compuestas `(enrollment_uid,release_id)` desde assignments/items/attempts/mastery hacia enrollment; `(release_id,resource_id)` hacia resources; `(assignment_uid,enrollment_uid,release_id)` desde ítems/intentos; `(session_uid,enrollment_uid)` desde intentos; `(item_uid,enrollment_uid,release_id)` desde intentos. Ninguna FK opcional permite eludir comprobaciones si el ID está presente.
- `material_uid` debe pertenecer al mismo enrollment: FK compuesta con artifact. `supersedes_assignment_uid` debe apuntar a assignment del mismo enrollment. Su grafo es acíclico y no altera el reemplazado. `previous_enrollment_uid` debe ser del mismo learner y package, nunca de la misma release; se verifica en Core bajo bloqueo.
- Un intento usa el assignment del ítem (ambos NULL para diagnóstico sin assignment), habilidades no vacías y rúbrica del ítem fijado. Solo datos válidos y explícitos de respuesta del alumno se registran; el modelo no puede inventar respuestas en su nombre.
- Correcciones apuntan al mismo intento, rúbrica y evaluación efectiva aceptada; no autorreferencias ni forks aceptados. Solo una propuesta pendiente por intento; `UNIQUE` parcial de `supersedes_assessment_uid` entre correcciones **aceptadas**, implementado mediante tabla/trigger de decisión. Al aceptar se comprueba de nuevo la cabeza bajo bloqueo; una cabeza raíz aceptada como máximo por intento. Propuestas rechazadas no bloquean nuevas propuestas.
- JSON válido + validación Zod estricta; CHECK para enums, enteros, rangos y `hints_used >= 0`. IDs publicados y contenido de intentos/items/assessments/decisiones/eventos tienen triggers que rechazan UPDATE/DELETE. Configuración, estados y proyecciones tienen APIs distintas; no `ON DELETE CASCADE` en historia.
- FKs no expresables en SQL simple (JSON, DAG, cadenas) se validan por Core en la transacción y se auditan por `doctor`. Índices en todas las referencias de consulta y orden por `event_seq`, no timestamps.

### 6.2 Eventos y fuente de reconstrucción

No event sourcing general: tablas de hechos inmutables son la autoridad de ítems, intentos y evaluaciones; eventos son el journal ordenado de aceptación y cambios. Una misma transacción registra hecho/estado y evento. No se promete reconstruir toda SQLite desde eventos: sí las proyecciones desde **hechos + decisiones + journal**. Los payloads contienen IDs, versión de contrato y los valores de transición; no duplican blobs completos ya preservados en tablas de hechos.

Sobre JSON: claves canónicas por RFC 8785 para hashes de inputs/rúbricas; strings UTF-8, números finitos, timestamps UTC ISO 8601 con milisegundos. `occurred_at` puede venir del alumno como dato; `recorded_at`, actor, secuencia y revisión los asigna Core. `event_seq` es el único orden autoritativo de replay. `idempotency_key` vive en operations y se relaciona por `operation_uid`; una operación puede emitir varios eventos.

Tipos v0.1: `ProfileCreated`, `ProfileChanged`, `NotebookInstallStarted`, `NotebookInstallRetried`, `NotebookInstallFailed`, `NotebookInstalled`, `NotebookQuarantined`, `EnrollmentCreated`, `EnrollmentStatusChanged`, `AssignmentCreated`, `AssignmentStatusChanged`, `MaterialPrepared`, `ArtifactRegistered`, `ArtifactFailed`, `ArtifactAdopted`, `ReadingDeclared`, `ResourceOpened`, `SessionStarted`, `SessionPaused`, `SessionResumed`, `SessionFinished`, `ItemPrepared`, `HintServed`, `AttemptSubmitted`, `AssessmentProposed`, `AssessmentAccepted`, `AssessmentRejected`, `AssessmentCorrected` (solo al aceptar corrección), `ConsentGranted`, `ConsentRevoked`, `DisclosureRecorded`. No `NotebookVersionActivated` sobre inscripción.

Eventos de instalación incluyen release_id, package_uid, versión, digest/inventario de referencia y operation_uid; fallo agrega error estructurado, nunca secretos del origen. Started/Retried se registran en A al crear pending; Installed o Failed al finalizar el plan. Cada transición incrementa revisión de release una vez. Cuarentena incluye hashes observados y razón, sin modificar baseline.

`HintServed` tiene payload `enrollment_uid`, `release_id`, `session_uid`, `item_uid`, `ordinal` entero positivo por ítem, `hint_snapshot` de texto servido y procedencia. Core asigna ordinal consecutivo bajo bloqueo; el mismo ítem solo puede recibir pistas antes de su intento, en una sesión activa del enrollment. La clave de idempotencia devuelve el mismo evento/pista, sin incrementar contador. `hint_snapshot` se guarda en el journal porque no hay tabla de pistas autoritativa separada. Al enviar intento, Core cuenta todos los HintServed de ese ítem en cualquier sesión de su enrollment anteriores al envío y fija `hints_used = served_count + declared_external_hints`; declaración externa es entero no negativo. El intento conserva ambos sumandos, `hints_used` y el límite de secuencia usado. Una pista posterior al intento se rechaza; otra explicación posterior es suplemento no puntuable. El replay usa el valor fijado del intento, no recalcula desde futuras conversaciones.

### 6.3 Idempotencia

Toda mutación acepta UUID `idempotency_key`, persistida antes de publicar archivos. Input hash = comando + input canónico, sin clave, timestamp de recepción ni token de aprobación. Misma clave/input/actor/ámbito devuelve resultado guardado y mismos IDs; si pending devuelve operation y puede reconciliarse; si failed devuelve el error guardado. Misma clave con contenido/actor/ámbito diferente: `IDEMPOTENCY_CONFLICT`, sin efectos. Claves no se purgan en MVP. Nuevo intento de una operación fallida requiere clave nueva y, cuando aplica, nuevo artifact/assignment. Autorización y ámbito se revalidan también al consultar resultado: conocer la clave no concede acceso. Una operación administrativa ya aprobada puede finalizar por recuperación sin un nuevo token, exclusivamente con su plan persistido e inmutable.

Para comandos solo DB, operation `completed`, eventos y resultado se guardan en una transacción. Desconexión tras COMMIT no duplica efecto al reintentar. Conflictos de revisión devuelven `REVISION_CONFLICT` con revisión actual, sin aceptar el comando.

### 6.4 Protocolo de publicación recuperable

Un único protocolo sirve para snapshots, bundles y exportaciones. Destinos nuevos con IDs, nunca sobrescribir archivos de usuario; exportaciones usan nuevo archivo versionado y un puntero regenerable. Staging está en el mismo filesystem que su destino; si no, rechazar `UNSUPPORTED_FILESYSTEM`.

1. Preparar bytes en `portfolio/.staging/<operation_uid>/` (para Notebooks, staging hermano en `notebooks/.staging/`), calcular inventario, validar rutas/links, fsync archivos y directorio. Sin modificación de SQLite todavía. Si cae aquí, staging huérfano se informa; puede limpiarse solo por usuario, nunca es una publicación aceptada.
2. Bajo bloqueo, transacción A: consumir aprobación si aplica, insertar operation `pending` con plan/inventario/hashes y IDs reservados; insertar artifact `pending` y assignment `preparing` si corresponde. Para instalación, release aún no visible como `ready`. COMMIT. El plan no contiene instrucciones ejecutables ni destinos arbitrarios.
3. Renombrar atómicamente el directorio al destino reservado con semántica no-replace. No seguir symlinks en ningún componente; verificar contención real desde raíz confiable y permisos de padres. fsync directorios origen/destino. Si destino ya existe, aceptar solo si todos sus bytes coinciden con el plan; de lo contrario `DESTINATION_CONFLICT`, sin tocarlo.
4. Transacción B: revalidar inventario final, marcar objetos `ready`, assignment `assigned`, operation `completed`, registrar eventos finales y resultado. `MaterialPrepared` solo existe tras publicación comprobada. Lectores no consumen `pending`. Si hay varios archivos, se publica el bundle completo, no archivos aislados.
5. Al arrancar y en `session recover`, reconciliar pending bajo bloqueo: staging válido → publicar; destino idéntico → finalizar B; ninguno o hash inválido → operation `failed`. En plan de artifact emitir ArtifactFailed y assignment failed si corresponde; en instalación marcar release failed y emitir NotebookInstallFailed, sin inventar artifact. No regenerar con LLM, no volver a aprobar el plan pending, no sobrescribir conflictos. Preservar residuos para diagnóstico. Si destino y staging existen, validar destino y preservar staging para limpieza explícita.

No hay atomicidad DB+filesystem: hay aceptación visible al finalizar B y recuperación determinista de ventanas intermedias. Cambios externos durante publicación están fuera de garantía frente a atacante con el mismo usuario (§8), pero se detectan por hash antes del consumo. En un reinicio tras B solo se devuelve el resultado persistido.

## 7. Ítems, evaluaciones y mastery determinista

### 7.1 Ítem y rúbrica antes de responder

Un ítem persistido antes del intento contiene: `item_uid`, enrollment/release/assignment opcional, enunciado, `skill_ids`, `context_key`, `source_refs` (release/resource/digest), soluciones/criterios esperados, `rubric_snapshot`, procedencia (`author-provided|user-provided|ai-generated` y proveedor/modelo/request si aplica). Mostrar enunciado no revela solución. No aceptar URLs o paths como sustituto del snapshot. `context_key` etiqueta el contexto pedagógico, no el número aleatorio del problema; aprobación humana de ítem generado confirma esa etiqueta y rúbrica. Ítems de un banco de autor ya revisado no necesitan aprobación individual. Una respuesta nueva al mismo ítem puede guardarse como nota, no como nuevo intento puntuable; para reintentar se crea variante nueva explícita.

```yaml
schema_version: '1.0'
rubric_id: 'ohm-item'
version: '1.0.0'
criteria:
  - id: 'relation'
    description: 'Selecciona y despeja correctamente la relación V = I·R'
    max_points: 2
    anchors:
      - {points: 0, description: 'Relación incorrecta o ausente'}
      - {points: 1, description: 'Relación correcta sin despeje correcto'}
      - {points: 2, description: 'Relación y despeje correctos'}
    skill_weights: {'apply-ohms-law': 1}
  - id: 'result'
    description: 'Calcula valor y unidad conforme al resultado esperado del ítem'
    max_points: 2
    anchors:
      - {points: 0, description: 'Resultado incorrecto sin procedimiento válido'}
      - {points: 1, description: 'Procedimiento correcto con error de cálculo o unidad'}
      - {points: 2, description: 'Valor dentro de tolerancia y unidad correctos'}
    skill_weights: {'apply-ohms-law': 1}
```

Cada criterio tiene `max_points` entero 1..100, anchors para todos los enteros 0..max, y al menos un peso entero 1..100 para habilidades de ese ítem. Todas sus habilidades tienen al menos un criterio. Snapshot y SHA-256 canónico de rúbrica se fijan antes de la respuesta; criterios ni dificultad se cambian después para acomodar la evaluación. Snapshot de solución incluye unidades, tolerancia cuando procede y justificación esperada, como JSON extensible de contenido sin ejecución. El esquema no exige números ni unidades a otras disciplinas.

### 7.2 Intento y evaluación

Intento: IDs de §6, `item_snapshot`, `rubric_snapshot`, `answer_snapshot` (texto/JSON/refs a artifact ready y hasheado), `submitted_at`, `hints_used` entero, contadores/seq de pistas de §6.2, `context_key` del ítem y procedencia de captura. El alumno confirma la respuesta; el Core valida estructura, no su verdad. En OpenCode, envío de intento requiere permiso interactivo ligado a hash de respuesta. Pistas se cuentan por Core si se sirven por herramienta; pistas externas declaradas se añaden, sin prometer detección de asistencia fuera del sistema.

Evaluación propuesta: `attempt_uid`, `rubric_digest`, puntuación entera por **todos y solo** los criterios, justificación por criterio con referencias a la respuesta, feedback, actor evaluador, proveedor/modelo o `human`, `confidence_in_evaluation` opcional 0..1. El Core valida rango, esquema y vínculos; esto no prueba corrección pedagógica.

En v0.1 **toda evaluación que cuenta requiere aceptación del usuario**, también las propuestas LLM; no introducir calibración ni aprobación automática. Propuesta pendiente no altera mastery. Rechazo persiste decisión y razón. Corrección crea otro assessment con `supersedes_assessment_uid`; al aceptarla sustituye la contribución anterior, no la suma. La evaluación anterior sigue aceptada históricamente, pero ya no es cabeza efectiva. No hay revocación destructiva: para retirar efecto se registra corrección aceptada con puntuación y razón explícitas. La aplicación muestra que revisión por alumno no equivale a validación por experto independiente.

### 7.3 Algoritmo `mastery-rules-v1`

Entrada fija: enrollment, versión de algoritmo/parámetros y `through_event_seq = H` capturado al iniciar replay. Solo intentos enviados ≤ H y evaluaciones con decisión aceptada ≤ H. Para cada intento, elegir la cabeza aceptada de su cadena a H. Cada intento aporta como máximo una evidencia por habilidad; no contar criterios como intentos distintos. Lectura, confianza del evaluador y cantidad de notas no participan.

Para intento `i`, habilidad `s`, con criterios relacionados `C`:

```text
raw(i,s) = sum(weight(c,s) * points(c) / max_points(c)) / sum(weight(c,s))
hint_factor(i) = (10 - min(hints_used(i), 3)) / 10
q(i,s) = floor(10000 * raw(i,s) * hint_factor(i))
```

Calcular fracciones con aritmética racional entera, no sumar floats dependientes de orden. Para cada habilidad seleccionar los **20 intentos elegibles más recientes** por `submitted_event_seq` (no fecha de la evaluación). `score_bps = floor(sum(q)/n)`, escala 0..10000; sin evidencias, NULL. `evidence_count = n`, `context_count` = claves de contexto distintas de esa ventana; además mostrar total histórico de intentos por consulta, sin usarlo en fórmula. `coverage_gap_bps = 10000 - min(10000,2000*n)` es un indicador de cobertura, **no intervalo estadístico ni incertidumbre calibrada**. No se almacena una probabilidad ficticia.

Etiquetas: `unobserved` si n=0; `insufficient-evidence` si n<5 o context_count<3; en otro caso `needs-practice` si score<6000, `developing` si 6000..7999, `demonstrated` si ≥8000. Tres respuestas perfectas no etiquetan dominio demostrado. `demonstrated` es evidencia operativa bajo estas reglas, no certificado de dominio general.

`readiness` es derivado separado: habilidad disponible si no tiene prerrequisitos o todos están `demonstrated`. Diagnóstico puede probar una habilidad no ready; estudio normal no omite prerrequisitos salvo override del usuario registrado con razón. Selección: módulos en orden declarado y habilidades en orden topológico con desempate por ID; elegir primera ready no demonstrated, priorizando `needs-practice`, luego `insufficient-evidence/unobserved`, luego `developing`, y menor score dentro de prioridad (NULL antes que números). Si ninguna está disponible devolver motivo, no inventar currículo. Usuario siempre puede elegir lectura no puntuable.

Sin decaimiento temporal, pesos de dificultad ni BKT en v0.1. Esto evita reconstrucciones dependientes del reloj. Repasos MVP: lista determinista de habilidades observadas no demonstrated; para demonstrated se ofrece repaso manual, sin scheduler temporal. Parámetros forman parte de `mastery-rules-v1`; cambiarlos requiere nueva versión y ejecución explícita, nunca reescribir evaluaciones.

Rebuild calcula tabla temporal para H, verifica invariantes y reemplaza filas del enrollment en una transacción junto con `projection_runs`; fallo preserva proyección anterior. Comparar digest canónico excluyendo `run_uid`/fecha; resultados deben ser idénticos al mismo H. Un comando que acepta evaluación marca proyección stale por secuencia. `getMastery` es lectura pura y devuelve filas, watermark y `stale`; el CLI `progress` solicita `rebuildProjections` con clave de idempotencia si es necesario antes de mostrar resultados actuales. Si falla muestra error/staleness, nunca presenta caché obsoleta como actual. Memoria MVP es plantilla determinista de estas proyecciones con refs, no resumen LLM obligatorio.

## 8. Modelo de amenazas, autoridad y agentes

### 8.1 Qué se protege y qué no

Adversarios considerados: paquete malicioso, prompt injection, output LLM inválido, agente que intenta exceder su rol, rutas manipuladas, reintentos concurrentes, fallos/interrupciones y caché corrupta. Se confía en usuario administrador, binarios/dependencias instalados, SO, plugin del proyecto y su configuración validada. Plugins, MCP y agentes globales ajenos al proyecto no se consideran confiables por defecto: el perfil de aprendizaje debe auditarlos y no admitirlos sin aprobación del usuario.

Garantía del Core: todo acceso a través de API/herramientas valida autoridad, IDs, transiciones y rutas; no hay API de escribir Notebook ni SQL arbitrario para agentes. OpenCode bloquea shell, escritura genérica, lectura libre y delegación no autorizada en el perfil de aprendizaje. Si un proceso evita ambas capas y usa permisos del propietario del disco, el Core **no puede impedir su escritura**. No se garantiza integridad frente a usuario/host comprometido, plugins maliciosos ejecutados con su UID, cambios concurrentes deliberados de symlinks o exfiltración de texto que el usuario pegó en un chat remoto.

No sandbox de SO en MVP. POSIX read-only, hashes y cuarentena reducen accidentes/detectan divergencia, no equivalen a montaje inmutable. Una instalación que requiera resistir procesos genéricos debe usar otra identidad/montaje read-only fuera del MVP. Las pruebas distinguen rechazo por Core, rechazo por OpenCode y límite de host; no atribuyen al Core el bloqueo de shell externo.

### 8.2 Contexto confiable y aprobación

`CommandContext` es un objeto interno, no un JSON aceptado del modelo: actor, rol, learner/enrollment autorizados, workspace canónico, session ID runtime y autorización de usuario opcional. CLI crea contexto `local-user`; plugin toma `context.agent` y `context.sessionID` del ejecutor V2, los cruza con lista confiable y sesión vinculada al enrollment. `actor`, rol, root, SQL, paths de destino y approval tokens no existen en schemas de inputs LLM. Core no exporta constructores de contexto al catálogo de herramientas; esto es encapsulación de proceso, no defensa contra código host malicioso.

Acciones con aprobación: instalar/reinstalar, crear inscripción, cambiar estado de enrollment, aceptar ítems generados, enviar respuesta en nombre del alumno, aceptar/rechazar/corregir evaluación, adoptar artifact, consentir divulgación y restaurar backup. CLI muestra operación y hash e impone confirmación interactiva; modo no interactivo exige `--confirm <operation_hash>` suministrado explícitamente por usuario. El agente no tiene shell para ejecutar ese modo.

En OpenCode, herramienta confiable llama `ctx.permission.assert` con `action: learning.approve`, `resources: ["<operation>:<sha256-input>"]`, detalles legibles y `save: []`. El plugin registra `ctx.permission.hook("evaluate", ...)`: para esa acción exige efecto efectivo `ask`, nunca `allow`; si observa allow lo convierte en deny y remite al CLI. Un deny configurado sigue siendo final. Correlaciona la evaluación ask con esa invocación antes de crear grant; assert sin evaluación ask comprobada no autoriza. Prohibir otros hooks capaces de cambiar esta decisión en el perfil; comprobar en el smoke de la versión fijada que un patrón guardado no evita el hook/ask, y si lo evita deshabilitar aprobación desde OpenCode. No usar un LLM para decidir permisos. No confundir `question` ni texto «sí» transmitido por el LLM con aprobación confiable. Tras assert, adaptador crea grant interno opaco de un uso, vinculado a actor, workspace, IDs, operación e input hash, válido 5 minutos usando reloj monotónico del proceso. Core lo consume bajo bloqueo en la transacción de aceptación; nunca retorna el grant al modelo. Reinicio invalida grants no usados; una operation pending ya aceptada conserva autorización solo de su plan. Doble consumo se rechaza; reintento idempotente ya completado devuelve su resultado sin consumir otra aprobación. No confiar en un `approvalToken` inventado o enviado por el modelo.

### 8.3 Matriz de agentes

Todos: lectura solo mediante herramientas de dominio filtradas, cero SQL, shell, edit/write/patch, web libre, imports o ejecución genérica. El rol no permite aprobación por sí mismo. «Proponer» no incluye aceptar; la aceptación ocurre únicamente por §8.2. Las acciones administrativas requieren usuario incluso si un agente prepara el reporte.

| Agente | Responsabilidad y herramientas de dominio permitidas | Habilitado v0.1 |
|---|---|---|
| `learning-orchestrator` (primary) | Leer estado/catálogo permitido; crear/gestionar sesión/assignment; materializar copia; servir ítems; solicitar aprobación de ítem, intento y evaluación; consultar/reconstruir proyecciones; delegar solo tutor | Sí |
| `tutor` (subagent) | Leer recurso/assignment/estado mínimo; explicar; proponer ítem, pista, traducción, suplemento o evaluación. Registrar propuestas/pistas servidas en ámbito vinculado; no enviar respuestas ni aceptar evaluaciones | Sí |
| `curriculum-analyst` | Leer currículo, proponer análisis; no escribir hechos académicos | No |
| `diagnostic` | Proponer ítems de diagnóstico y rúbricas; no crear dominio estimado | No |
| `exercise-generator` | Proponer ítems inéditos con fuente/rúbrica; no aceptar sus resultados | No |
| `assessment` | Leer intento/rúbrica concedidos; proponer evaluación; no decidir aceptación | No |
| `mastery-analyst` | Leer proyecciones y explicar límites; no modificar fórmula ni score | No |
| `review-scheduler` | Leer cobertura y recomendar; no cambiar evidencia | No |
| `knowledge-curator` | Proponer nota; persistir nota nueva vía herramienta con aprobación, nunca sobreescribir nota del alumno | No |
| `asset-manager` | Proponer/registrar assets permitidos en Portfolio, con validación/licencia/cuotas y aprobación | No |
| `notebook-manager` | Listar/verificar/comparar; solicitar instalación por usuario; sin herramienta de edición de release | No; CLI cubre administración |
| `memory-manager` | Consultar/reconstruir resúmenes derivados; no cambiar evidencias | No; Core usa plantilla |

OpenCode conversation no es una sesión académica: su ID es procedencia, `session_uid` vive en SQLite. Un nuevo modelo/agente comienza con `getEnrollment(enrollment_uid)` y sesión persistida, no con un resumen como autoridad. Los ítems preparados y propuestas pendientes sobreviven cambio de modelo.

## 9. OpenCode V2 y API de dominio

### 9.1 Integración soportada

Objetivo: API **OpenCode V2 (2.x)**; sin sintaxis V1 nueva. Durante la primera fase se fija la versión patch exacta de CLI/servicio y `@opencode/plugin` probada en lockfile y `workspace.yaml` (`integration.opencode_version`); no se afirma compatibilidad universal con futuras 2.x. Una versión distinta bloquea mutaciones del adaptador hasta pasar smoke tests o aprobación explícita de compatibilidad; CLI/Core siguen disponibles. La elección del patch instalado es verificación de entorno, no un cambio de arquitectura.

Integrar con plugin local `.opencode/plugins/learning/index.ts`, `Plugin.define`, registro `ctx.tool.transform` y `ctx.permission.assert` **en cada ejecutor** antes de acceso. Las herramientas personalizadas no comprueban permisos automáticamente por existir. Usar namespace `learning`, herramientas `codemode: false` para exponerlas directamente y poder denegar `execute`; no depender del formato legacy `.opencode/tools/`. No MCP, SDK embebido ni servicio propio en MVP. El plugin llama al Core en proceso; código del adaptador es confiable y no interpreta comandos del Notebook.

Configuración base ilustrativa V2 (la implementación debe generar la allowlist exacta según rol):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "default_agent": "learning-orchestrator",
  "snapshots": false,
  "permissions": [
    { "action": "*", "resource": "*", "effect": "deny" },
    { "action": "question", "resource": "*", "effect": "allow" },
    { "action": "learning.read", "resource": "*", "effect": "allow" },
    { "action": "learning.propose", "resource": "*", "effect": "allow" },
    { "action": "learning.session", "resource": "*", "effect": "allow" },
    { "action": "learning.approve", "resource": "*", "effect": "ask" },
    { "action": "subagent", "resource": "tutor", "effect": "allow" }
  ],
  "agents": {
    "tutor": {
      "description": "Tutor sin autoridad para aceptar evidencia",
      "mode": "subagent",
      "permissions": [
        { "action": "*", "resource": "*", "effect": "deny" },
        { "action": "learning.read", "resource": "*", "effect": "allow" },
        { "action": "learning.propose", "resource": "*", "effect": "allow" }
      ]
    }
  }
}
```

`learning.read/propose/session` no son permisos nativos de OpenCode: los declara y comprueba el plugin, y el Core vuelve a verificar rol/ámbito. `resource` es ID de enrollment y operación, nunca path elegido por modelo; `*` en ejemplo no otorga acceso entre inscripciones porque Core filtra el contexto vinculado. La definición Markdown del primary debe añadir su política explícita. Última regla coincidente gana; agente hijo usa su propia política, no un subconjunto implícito de su padre. No habilitar agentes globales o builtins amplios mediante delegación. Configuración fusionada de ancestros, usuario, sistema, agentes y sesión se inspecciona en preflight; si no puede asegurarse la política requerida, adaptador no sirve datos personales ni muta. El propietario puede elegir salir del perfil; eso queda fuera de garantía de sesión segura.

`snapshots: false` evita atribuir undo de OpenCode a transacciones académicas y reduce copias locales del Portfolio. `/undo` puede cambiar conversación, nunca revierte SQLite ni aceptación: correcciones pasan por Core. Git ignora Portfolio, Notebooks instalados, cache, staging, backups y secretos por defecto. Un usuario que ya versionó esos archivos debe retirarlos explícitamente; `.gitignore` no borra historia ni snapshots previos.

### 9.2 Contratos públicos

Esquemas de comandos estrictos y DTOs se versionan en `schemas`. Interfaces siguientes describen operaciones, no implementación:

```ts
type Mutation<T> = {
  idempotencyKey: string;
  expectedRevisions?: Record<string, number>; // obligatorio por cada agregado mutable existente afectado
  input: T;
};
type EnrollmentRef = { enrollmentUid: string };
type ReleaseRef = { releaseId: string };

interface LearningCore {
  listNotebooks(): Promise<InstalledNotebook[]>;
  installNotebook(cmd: Mutation<InstallInput>): Promise<OperationResult>;
  verifyNotebook(ref: ReleaseRef): Promise<VerificationReport>;
  createEnrollment(cmd: Mutation<CreateEnrollmentInput>): Promise<Enrollment>;
  getEnrollment(ref: EnrollmentRef): Promise<EnrollmentView>;
  setEnrollmentStatus(cmd: Mutation<EnrollmentStatusInput>): Promise<Enrollment>;
  startSession(cmd: Mutation<StartSessionInput>): Promise<Session>;
  setSessionStatus(cmd: Mutation<SessionStatusInput>): Promise<Session>;
  prepareAssignment(cmd: Mutation<PrepareAssignmentInput>): Promise<OperationResult>;
  observeAssignment(cmd: Mutation<AssignmentObservationInput>): Promise<Assignment>;
  prepareItem(cmd: Mutation<PrepareItemInput>): Promise<Item>;
  serveHint(cmd: Mutation<ServeHintInput>): Promise<Hint>;
  submitAttempt(cmd: Mutation<SubmitAttemptInput>): Promise<Attempt>;
  proposeAssessment(cmd: Mutation<AssessmentInput>): Promise<Assessment>;
  decideAssessment(cmd: Mutation<AssessmentDecisionInput>): Promise<AssessmentView>;
  completeAssignment(cmd: Mutation<CompleteAssignmentInput>): Promise<Assignment>;
  getMastery(ref: EnrollmentRef): Promise<MasteryView>;
  rebuildProjections(cmd: Mutation<RebuildInput>): Promise<RebuildReport>;
  recoverSession(cmd: Mutation<EnrollmentRef>): Promise<RecoveryReport>;
  doctor(): Promise<DoctorReport>;
}
```

Son métodos de un facade ya vinculado al `CommandContext`, no endpoint sin autenticación. Roles tienen facades de subconjunto. Administración de perfil, grants/consentimientos, export, artifacts y backup usa facades de usuario separadas; no se añaden al catálogo LLM salvo aprobación explícita prevista. `prepareItem` para autor valida catálogo; para generación exige aprobación de snapshot completo. `serveHint` registra el evento HintServed y fija contadores conforme a §6.2; la API recibe sessionUid, itemUid y propuesta de pista o pista ya preparada, nunca un ordinal elegido por modelo. `observeAssignment` admite solo `opened|read_declared|practicing`, nunca `completed` ni cambio de mastery.

Inputs mínimos:
- `InstallInput`: `source` unión `{type:local,path}` solo usuario o `{type:git,url,commit}`; aprobación interna vinculada al snapshot ya capturado.
- `CreateEnrollmentInput`: learnerUid, releaseId, previousEnrollmentUid opcional.
- `StartSessionInput`: enrollmentUid, kind; `SessionStatusInput`: sessionUid, targetStatus; revisiones en el envelope expectedRevisions.
- `PrepareAssignmentInput`: enrollmentUid, resourceId, objectiveSkillIds, mode, targetLanguage opcional, translationProposal opcional con generación/procedencia; Core elige paths/IDs.
- `PrepareItemInput`: enrollmentUid, assignmentUid opcional, source item del banco o snapshot/rúbrica/contexto/procedencia aprobados.
- `SubmitAttemptInput`: sessionUid, itemUid, answerSnapshot, declaredExternalHints; no actor, evaluación ni skill IDs sobrescritos.
- `AssessmentInput`: attemptUid, rubricDigest, criteriaScores, feedback, supersedesAssessmentUid opcional. Proveedor/modelo y actor vienen de runtime; CLI humano indica su origen humano por contexto.
- `AssessmentDecisionInput`: assessmentUid, decision, reason; aprobación sobre contenido de evaluación y cabeza esperada.
- `RebuildInput`: enrollmentUid, algorithmVersion fijada; Core captura H. `RecoveryReport` incluye operations pendientes/fallidas, sesión/assignment actual, ítems preparados e intentos sin evaluar.

Revisiones esperadas son un mapa por ID cuando un comando toca varios agregados mutables. Nuevo agregado no necesita revisión previa. Inputs de contenido grandes están limitados a 2 MiB y son datos, no programas. `OperationResult` = operationUid, status pending/completed/failed, IDs de resultados, error estructurado opcional. Errores incluyen `code`, mensaje seguro, IDs afectados y `retryable`; nunca stack/secretos. Consultas `get*`, `list*`, `verifyNotebook` y `doctor` son lectura pura. `notebook verify` del CLI obtiene reporte y, si detecta divergencia, ejecuta por facade administrativa una mutación idempotente `quarantineNotebook` con revisión esperada, causa e inventario observado, registrando NotebookQuarantined. El consumo de fuente comprueba integridad aunque esa cuarentena aún no esté persistida. Doctor no cuarentena, reconcilia ni reconstruye; solo informa. Rebuild es siempre comando explícito del adaptador/CLI, no side effect de una consulta.

### 9.3 CLI v0.1

```bash
learn init
learn profile show|set
learn notebook add <local-path>
learn notebook add <https-url> --commit <full-sha>
learn notebook list
learn notebook verify <release-id>
learn notebook compare <release-a> <release-b>
learn enroll <release-id> [--from <enrollment-id>]
learn enrollment pause|resume|archive <enrollment-id>
learn study --enrollment <id>
learn diagnose --enrollment <id>
learn progress --enrollment <id>
learn assessment review <assessment-id>
learn doctor
learn cache rebuild
learn memory rebuild --enrollment <id>
learn portfolio verify
learn portfolio adopt <artifact-id>
learn session recover --enrollment <id>
learn consent grant|revoke|list
learn backup create|verify|restore
```

`study` ofrece menú determinista para preparar/copiar, declarar lectura, empezar/pausar/terminar sesión, servir ítems locales, responder y revisar. Propuestas de tutor se consumen por OpenCode; CLI puede importar propuesta JSON validada y aprobada para pruebas, no ejecutarla. `diagnose` es sesión `kind=diagnostic` que permite ítems de cualquier skill; si no hay banco/propuestas devuelve explicación y no inventa un diagnóstico. Toda selección exige IDs exactos; sin `--enrollment` y con varias inscripciones falla pidiendo elección. CLI presenta operation/idempotency key al iniciar una mutación y permite `--idempotency-key` para reintentos. Salida JSON por `--json`; códigos 0 éxito, 1 error operativo/integridad, 2 input/permiso/ambigüedad. Operación pending retorna referencia y no se reporta como completada.

## 10. Actualizaciones, backups y recuperación

### 10.1 Actualizar sin alterar historia

`notebook add` instala una versión nueva por §3 sin activar nada en enrollments existentes. `notebook compare` produce `unchanged|modified|removed|new` por IDs y hashes de recurso/currículo; no acepta `renamed-with-mapping` automático en MVP. Mapeos semánticos, transferencia de mastery y migraciones de evidencias quedan fuera.

Para continuar: usuario crea backup y `enroll <new-release> --from <old-enrollment>`. Core valida mismo learner/package y crea nueva inscripción vacía, vinculada por `previous_enrollment_uid`. La anterior no se pausa ni archiva automáticamente; esos son comandos separados. No copiar scores, intentos o materiales; notas previas son consultables por enlace explícito. Rollback consiste en volver a elegir la inscripción anterior, no deshacer o borrar eventos de la nueva. No existe `NotebookVersionActivated` ni UPDATE de release en enrollment.

### 10.2 Backup y restore mínimos, incluidos en MVP

No aplazar backup mientras se promete recuperación. Bajo bloqueo de workspace y con todas las publicaciones reconciliadas o registradas fallidas, usar API de backup SQLite, copiar snapshots y archivos del Portfolio a directorio nuevo y producir inventario SHA-256 + versión de esquema y `event_seq` H. Configuración no secreta se incluye; secretos y caché no. Fsync y marcar backup completo solo después de verificar DB (`integrity_check`, FKs) e inventario. No copiar solo `.sqlite` mientras WAL está activo. Notas editadas por Obsidian requieren cerrar/pausar edición; comprobar hashes antes y después y abortar si cambian. No se garantiza snapshot consistente de editores externos que escriben concurrentemente.

Restore: usuario cierra Core/OpenCode/editores, selecciona backup verificado, confirma ámbito y hace copia de seguridad del estado actual si es legible. Restaurar a **workspace nuevo**, nunca encima del actual, validar con doctor y seleccionar explícitamente la nueva raíz. Backup incompleto, esquema futuro o hash diferente bloquea restore. No subir versión de esquema destructivamente; migrations incrementales, versionadas, con backup previo y rollback mediante workspace restaurado. No prometer recuperar DB corrupta sin backup; archivos supervivientes pueden recuperarse manualmente sin reconstruir historial inventado.

### 10.3 Doctor, caché y recuperación de sesión

`doctor` es no destructivo: integridad SQLite/FKs, versión de esquema, constraints de dominio, inventarios completos, paths, faltantes/extra/divergentes, operations pendientes, proyecciones stale, permisos de host y preflight OpenCode si disponible. Distingue ERROR (integridad/seguridad), WARNING (caché ausente, notas cambiadas durante backup, traducción no revisada) e INFO. Si SQLite no se abre, informa límite y backup disponible; no intenta reescribirla.

`session recover` reconcilia §6, devuelve sesión pausada/activa y checkpoint reconstruido de assignments/items/intentos/evaluaciones. No reenvía automáticamente requests al proveedor ni vuelve a registrar respuestas. Una llamada LLM perdida puede repetirse con request UID nuevo y coste explícito; no se promete exactly-once de facturación externa. Core no mantiene aprendizaje solo en contexto de OpenCode.

`cache/` contiene SQLite separada de FTS5, fragmentos con hash/ref y memoria de plantilla. `cache rebuild` crea índice nuevo, valida y cambia por rename bajo bloqueo; corrupción o borrado no afecta datos personales. Por defecto indexar solo recursos permitidos y materiales ready; notas requieren opt-in local específico. No embeddings v0.1. `memory rebuild` reconstruye mastery y plantilla con refs sin reevaluar intentos; fallo preserva versión previa. No usar memoria stale para decisiones de estado.

## 11. Privacidad, divulgación y límites de generación

Persistencia local-first **no implica inferencia offline**. Sin consentimiento, CLI/Core y fixtures funcionan sin red; OpenCode solo puede utilizar proveedor local validado o permanecer sin contenido personal. Antes de arrancar conversación con proveedor remoto se muestra que prompts, respuestas, resultados de herramientas, títulos y compactaciones pueden ir a ese proveedor y persistir en su infraestructura y en el historial local de OpenCode.

Consentimiento explícito por usuario, guardado en SQLite, con learner/enrollment, proveedor, endpoint, modelo (o familia explícitamente aprobada), fines `tutor|translate|generate-item|evaluate`, categorías `public-resource|learner-answer|academic-state|personal-note|asset`, expiración (por defecto fin de sesión académica o 24 h, lo que ocurra antes). Cambio de proveedor/endpoint/modelo fuera de alcance requiere nueva aprobación. Notas y assets personales excluidos por defecto, incluso con consentimiento de tutoría. Aprobar un proveedor en OpenCode no equivale a consentir divulgar Portfolio.

El adaptador comprueba grant antes de devolver cada dato al contexto, aplica mínimo necesario y registra `DisclosureRecorded` con refs/hashes, categorías y destino, no otro cuerpo privado. No se incluyen UUID de learner, paths absolutos, secretos o notas en payload remoto si no son necesarios. Los hooks V2 de `context`, `compaction`, `generate`, `title` deben comprobar destino/grant y fallar antes de dispatch; no se puede proteger un contexto ya divulgado simplemente ocultando herramientas. Auxiliares se resuelven a destino aprobado o se bloquean (título local determinista; memoria Core por plantilla). No depender de interceptar solo HTTP: no cubriría otros transportes. La compatibilidad de hooks para bloqueo debe probarse contra la versión fijada; si un flujo no se puede bloquear, se deshabilita ese flujo o el modo remoto completo, sin fallback inseguro.

Al revocar, expirar consentimiento o cambiar a destino no aprobado: interrumpir la sesión OpenCode vinculada, bloquear nuevas respuestas de herramientas y siguientes dispatch; continuar en sesión nueva con contexto rehidratado y redacción apropiada. No reenviar historial a otro modelo sin nuevo consentimiento sobre el historial. Esto no retira datos ya enviados, ni controla contenido pegado por usuario o herramientas externas al perfil. El Core no promete borrar registros del proveedor.

Registros técnicos sin cuerpos de respuestas, tokens, prompts completos, notas o secretos; auditoría guarda IDs, hashes, decisiones y proveedor/modelo/versiones disponibles. Respuestas y feedback necesarios sí viven en tablas de evidencia privadas, no logs. Secretos en almacén OpenCode/variables fuera del vault. Backups, historial OpenCode y cachés son datos privados; cifrado en reposo depende de disco/usuario en MVP, no se afirma cifrado propio.

Generación MVP solo texto/Markdown e import de imágenes estáticas permitidas; máximo 2 MiB por propuesta, 10 MiB por asset y 100 MiB de artifacts gestionados por enrollment. Cuota comprobada bajo bloqueo contando pending+ready. Máximo 10 solicitudes de generación por sesión y 2 simultáneas por workspace; timeout 60 s; sin reintento automático de generación. Configuración de usuario puede reducir/ampliar cuotas conscientemente; registrar request UID, fin y proveedor antes de entregar datos. No implementar generación audio/imágenes, fetch de assets remotos ni workers. Propuestas excedidas o inválidas se rechazan sin alterar el estado académico.

## 12. Alcance y decisiones aplazadas

### Incluido en v0.1

- Repo TypeScript con `packages/schemas`, `packages/core`, `packages/cli` y adaptador OpenCode local; un proceso por operación, sin servidor nuevo.
- Runtime Node.js 24 LTS; SQLite embebida con driver que exponga backup y FTS5; usar `better-sqlite3` fijado en lockfile y comprobado en Linux. Zod para contratos, parser YAML seguro y parser CommonMark con AST para enlaces (sin regex como parser).
- Instalación local y Git HTTPS fijado; catálogo agnóstico, release canónica e inventarios.
- Profile, enrollment, assignments, sesiones, ítems/rúbricas, intentos, propuestas/decisiones, correcciones y journal.
- Exact-copy y contrato de traducción opcional; traducción puede faltar sin impedir MVP offline.
- Mastery determinista, revisión manual, FTS local separado, memoria por plantilla, recuperación y backup/restore básico.
- Dos agentes habilitados, plugin V2 con permisos y consentimiento comprobados; administración por CLI.
- Fixture electrónica y pruebas de fallo, seguridad y reinicio. No depender de LLM remoto para la suite automatizada.

### Fuera de v0.1

Firmas/registry público y reputación, namespace migration, equivalencias semánticas entre releases, transferencia de evidencias, multilearner, sincronización, SQLite remota, microservicios, embeddings/vector DB, BKT/IRT/calibración, decaimiento temporal, scheduling avanzado, evaluación automática sin revisión, sandbox de ejercicios ejecutables, PDF/SVG/HTML/audio, app web/móvil, plugin propio de Obsidian, cifrado propio y eliminación/compactación de historial. Son evoluciones, no decisiones necesarias para empezar. El backup mínimo y el scoring v1 **no** se posponen.

## 13. Criterios de aceptación y matriz de fallos

Cada criterio debe tener prueba automatizada salvo integración real OpenCode/Obsidian marcada manual. IDs estables de aceptación se reutilizan en el plan.

| ID | Criterio observable |
|---|---|
| AC01 | Dos paquetes con nombre igual/UID diferente y namespace distinto coexisten; UID/namespace conflictivos se rechazan |
| AC02 | Instalar desde local captura bytes independientes; modificar origen no cambia snapshot; mismo UID/version distinto digest se rechaza; distintos commits/igual digest reutilizan release |
| AC03 | Importar, copiar, practicar y generar no cambian bytes de release. Core rechaza toda escritura de Notebook y OpenCode deniega herramientas genéricas; prueba separada documenta que usuario host sí podría escribir |
| AC04 | Instalar v2 y crear inscripción vinculada no altera inscripción v1, sus evidencias, materiales ni scores; v2 empieza sin evidencias |
| AC05 | Exact-copy preserva bytes y enlaces locales/fragmentos/assets del cierre; idioma ausente no causa traducción; traducción conserva hash/ref, se publica aparte y no se marca revisada |
| AC06 | Editar nota no afecta DB. Editar material se detecta y bloquea consumo; adopt crea artifact nuevo sin reatribuir original ni modificar intentos |
| AC07 | Intento, rúbrica, evaluación y decisiones sobreviven reinicio sin OpenCode; leer no cambia mastery; tres perfectos siguen insufficient-evidence |
| AC08 | Replay al mismo H produce mismo score/digest; corrección reemplaza contribución una vez; rechazadas/pending no cuentan; más de 20 intentos aplica ventana estable |
| AC09 | Transiciones, pertenencia a enrollment/release, rúbricas y DAG inválidos son rechazados sin hechos/eventos parciales |
| AC10 | Idempotencia devuelve mismos IDs; payload/actor diferente con misma clave falla; claves concurrentes no duplican hechos ni aceptación de correcciones |
| AC11 | Kill en cada ventana de publicación (§6.4) deja resultado recuperable o failed explícito; no archivos consumibles sin ready ni referencias ready sin archivos validados |
| AC12 | Doctor detecta hashes, extras, FKs/dominio, pendientes y DB dañada sin reparar/destruir; caché corrupta se reconstruye sin modificar fuente, notas ni evidencias |
| AC13 | Backup con WAL activo y restore a raíz nueva pasan doctor y replay; backup incompleto o hash distinto falla; sin backup no se promete reconstruir DB corrupta |
| AC14 | Permisos Core/OpenCode se prueban por rol, escalada, actor falsificado, delegación, symlinks, traversal, hooks/configs de paquete y input malicioso; ninguna instrucción descargada habilita autoridad |
| AC15 | Sin consentimiento no sale dato personal; cambio de proveedor/revocación/auxiliares bloquea siguientes dispatch; mocks verifican disclosures mínimos sin cuerpos en logs; prueba real V2 confirma hooks y política efectiva |
| AC16 | Fixture electrónica valida sin campos disciplina/CEFR/idioma obligatorios; referencia sin currículo permite leer y rechaza diagnóstico/mastery con código explícito |
| AC17 | OpenCode V2 fijado, primary+tutor y reinicio desde enrollment funcionan; /undo no deshace hechos; modelo distinto recupera estado con consentimiento nuevo cuando aplica |

Matriz mínima de inyección de fallos: antes/después de fsync staging, COMMIT A, rename, fsync destino, COMMIT B y respuesta CLI; disco lleno; destino ocupado; staging perdido; proceso muerto con bloqueo; dos writers; evaluación corregida concurrentemente; caída de proveedor tras cobrar; cache FTS truncada; archivo Markdown modificado fuera del Core; DB con FK inválida por manipulación de fixture y DB ilegible. No usar una DB real del usuario para ensayos de corrupción. Clock skew no cambia orden de replay. Fallo de rebuild deja proyección anterior marcada stale.

## 14. Vertical slice de la ley de Ohm

1. Crear fixture con `notebook.yaml`, `resources/index.yaml`, `index.md`, `curriculum/index.yaml`, `resources/ohms-law.md`, `assets/manifest.yaml` y `assets/circuit-01.png`. El Markdown enlaza `../assets/circuit-01.png` y un encabezado relativo para probar cierre. Idioma `es-MX` puede declararse para demostrar match; una variante sin `language` también valida.
2. `learn init`; instalar fixture local, verificar inventario/release y registrar consentimiento local para perfil OpenCode si se usa. No se requiere red.
3. Crear enrollment, sesión diagnóstico y preparar tres ítems fijados del fixture de pruebas (no banco de autor anunciado por capabilities) mediante aprobación de usuario. Cada ítem tiene rúbrica y contexto distintos y evalúa explícitamente voltaje/resistencia. Registrar respuestas, propuestas y aceptación; tres evidencias aún no demuestran dominio. Para llegar a readiness, completar al menos cinco evidencias por prerrequisito, tres contextos y score ≥8000; se sirven variantes prefijadas, sin necesidad de LLM.
4. Crear assignment `ohms-law` exact-copy con objetivos, materializar bundle y comprobar todos sus hashes. Obsidian abre el documento manualmente; usuario declara lectura mediante herramienta/CLI. Score antes/después de lectura idéntico. Puede hacerse antes del diagnóstico, pero práctica de aplicación debe respetar readiness o override de usuario con razón registrada.
5. Iniciar sesión study y servir tres problemas nuevos de aplicación (por ejemplo corriente en carga resistiva, caída de tensión y elección de resistencia), con números/soluciones y rúbricas fijados antes de responder. Para demo offline usar catálogo de variantes de tests; tutor puede generar otros ítems aprobados. Guardar ejercicios en `generated/`, no Notebook, antes de servirlos; `ItemPrepared` referencia artifact ready y snapshots SQLite. No dar puntos de voltaje/resistencia por un criterio que solo evalúa aplicación.
6. Registrar intentos y evaluaciones pendientes; aceptar, corregir uno y reconstruir mastery. Solo tres aplicaciones perfectas siguen `insufficient-evidence`; no falsear aceptación para mostrar dominio total.
7. Matar/reiniciar OpenCode y Core, perder todo contexto y retomar con enrollmentUid; recuperar ítems/intentos y operación pending de una publicación interrumpida. Nueva evaluación no duplica la anterior al reintentar su clave.
8. Doctor limpio, comparación byte a byte del snapshot original, backup/restore a otro workspace y replay idéntico. Corromper solo caché en copia de pruebas, reconstruir y demostrar que evidencia/Markdown no cambian.

## 15. Trazabilidad del cierre y referencias

| Hallazgo de la revisión | Resolución normativa |
|---|---|
| 1. Core no puede interceptar escritura externa | §8.1–8.2: amenaza/autoridad real, aislamiento fuera de MVP, grants internos |
| 2. Fuentes de verdad ambiguas | §2 y §5: SQLite, notas libres, exportaciones y adopción explícita |
| 3. Archivos/DB sin atomicidad | §6.1, §6.3–6.4 y AC10–13: publicación recuperable y reintentos |
| 4. Replay/scoring indefinidos | §7: rúbrica fijada, decisiones/cadenas, fórmula/ventana/H versionados |
| 5. Release local/identidad | §3 y §6.1: release_id, commit opcional, digest canónico y conflictos |
| 6. resource_id e idioma ausentes | §4.1: catálogo e idioma opcional sin inferencia |
| 7. Copia exacta rompe enlaces | §5.3: bundle con cierre y bytes exactos, sin symlinks |
| 8. Relaciones/transiciones insuficientes | §5.4 y §6.1: estados terminales, CAS, FKs y checks de dominio |
| 9. Actualizar altera inscripción | §10.1: nueva inscripción vacía y vínculo, sin transferencia |
| 10. Privacidad y salida de datos | §11: consentimiento/destino, revocación, auxiliares y límites reales |
| 11. Integración V1 | §9.1: V2, plugin, permisos por ejecutor, pin y smoke gates |

Documentación oficial V2 consultada el 2026-10-24/25 (no prueba de funcionamiento del adaptador aún no implementado):
- [Índice V2](https://opencode.ai/v2/llms.txt)
- [Configuración](https://opencode.ai/v2/docs/config/)
- [Agentes](https://opencode.ai/v2/docs/agents/)
- [Permisos](https://opencode.ai/v2/docs/permissions/)
- [Herramientas](https://opencode.ai/v2/docs/tools/)
- [Plugin V2: herramientas, permisos y hooks de sesión](https://opencode.ai/v2/docs/build/plugins/)
- [Snapshots y límites de undo](https://opencode.ai/v2/docs/snapshots/)

La compatibilidad efectiva de permisos/aprobaciones/hooks es una **puerta de verificación de integración**, no una garantía probada por leer documentación. Si falla, conservar CLI y modo local, bloquear integración remota y corregir adaptador antes de declararlo aceptado. Riesgos y cuestiones genuinamente externas se registran en [open-questions.md](open-questions.md).

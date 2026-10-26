# F0 — Incompatibilidades comprobadas y correcciones requeridas

Fecha: 2026-10-25. Este registro se escribe **antes** de aclarar contratos normativos o cambiar la implementación afectada. No autoriza F1 ni habilita capacidades remotas.

## CF01 — Referencias publicadas no pueden contener un release_id local

**Evidencia:** `ItemDefinition`/`ItemCatalog` de F0 usan `sourceRefSchema`, que exige `release_id` (UUID asignado por una instalación local). Los bancos de autor dentro de un Notebook publicado no pueden conocer el UUID que cada workspace asignará al instalarlo. La especificación exige publicación independiente de instalaciones (§3.1), pero remite el banco publicado al contrato de ítem materializado (§4/§7) sin distinguir estas referencias.

**Decisión de corrección:** separar `CatalogSourceRef` (`resource_id`, `digest`) y `CatalogItemDefinition` de los ítems/propuestas ya vinculados a una inscripción. En un banco publicado todas las referencias son relativas al propio Notebook. Al preparar un ítem, el Core futuro vinculará el `release_id` local y verificará el digest de recurso contra el snapshot; no aceptará un UUID de instalación suministrado por el autor. No transferir identidades académicas ni añadir un registry externo.

**Aclaración normativa mínima necesaria:** ubicación y forma de estas referencias publicadas, conservando refs completas release/resource/digest en Portfolio. No cambia la identidad de releases ni su inmutabilidad.

## CF02 — LicenseRef sin un campo para declarar su texto

**Evidencia:** la especificación exige texto de licencia incluido y path declarado para `LicenseRef-*` (§4.1), pero el contrato implementado de metadata/recursos/assets es estricto y no admite ningún campo para declarar ese path. Aceptar una licencia personalizada en ese estado no permite satisfacer la regla normativa.

**Decisión de corrección:** `metadata.license_files` opcional, mapa de `LicenseRef-*` a ruta relativa de texto de licencia dentro del Notebook. Cada referencia personalizada efectiva debe tener declaración. Existencia y bytes se comprueban contra el snapshot al instalar (F2); F0 comprueba contrato/referencias declaradas. La materialización futura también incluirá los textos de licencia efectivos, sin inyectarlos en el cuerpo que se declara exact-copy. Identificador válido no equivale a permiso legal ni autenticidad del autor.

## CF03 — Falso positivo de validación combinada

**Reproducción ejecutada:** sobre el fixture de electrónica, cambiar `manifest.content.resources_manifest` a `42`: `NotebookManifest.safeParse(...).success` es false y `validateNotebookContracts(...)` devuelve `{ok:true,issues:[]}`. El conversor omitía diagnósticos de paths y la pasada de rutas solo recogía valores string.

**Corrección:** ningún fallo de schema puede convertirse en éxito por filtrar diagnósticos. Agregar regresiones para path ausente/null/no-string en manifiesto, recursos y assets, con diagnóstico no vacío.

## CF04 — YAML 1.1 y restricciones de datos inertes no normativas

**Reproducciones ejecutadas:** `%YAML 1.1\n---\nvalue: yes` devuelve `{value:true}` aunque el contrato requiere YAML 1.2. Un valor NFD `e\u0301` y una clave inerte `command` dentro de `extensions` se rechazan aunque la norma solo exige NFC en paths y prohíbe **ejecutar/expandir**, no representar esos datos.

**Corrección:** YAML 1.2 efectivo obligatorio; no normalizar ni rechazar texto libre por su forma Unicode de composición; mantener validación NFC de paths. No interpretar entorno/includes/comandos y no prohibir palabras de contenido por parecer instrucciones. Conservar controles de aliases, tags, merges, duplicados, Unicode inválido, profundidad y tamaño, y defensa de claves de prototipo.

## CF05 — Dos implementaciones de canonicalización con garantías divergentes

**Reproducciones ejecutadas:** `schemas.canonicalJson` acepta surrogate sin pareja en valor/clave y convierte `RegExp` en `{}`; `schemas.snapshotContentDigest` acepta `../x.md`. La implementación de Core rechaza parte de esos casos, por lo que el mismo contrato depende de qué API se use.

**Corrección:** una autoridad compartida de canonicalización y metadatos de inventario, sin dependencia schemas→core. Schemas mantiene las reglas base; Core adapta sus errores públicos y calcula hashes de bytes, reutilizando la autoridad base. Conservar los vectores válidos, los errores de API donde sea posible y el orden especial path,size,sha256. No redefinir RFC 8785 ni usar un serializador permisivo paralelo.

## CF06 — Gramática BCP 47 insuficiente

**Reproducciones ejecutadas:** se aceptan `en-1996-US`, `en-US-Latn`, `en-a-foo-Latn` y `en-u-ca-gregory-US` como canónicos; se rechaza el tag válido `en-x-a`. La máquina manual mezcla regiones/variantes/extensiones fuera de orden y restringe incorrectamente uso privado.

**Corrección:** parser BCP 47 estricto mantenido y formato de casing canónico sin eliminar regiones ni inferir equivalencias de idioma. No usar normalizadores CLDR que convierten, por ejemplo, `en-US` en `en`: la norma requiere conservar distinciones y comparar tags canónicos exactos. Probar extensiones, uso privado, duplicados y tags inválidos.

## Cambios de dependencias justificados

- `bcp-47@2.1.2`: sustituye la gramática manual incorrecta; sin red en runtime.
- `spdx-license-ids@3.0.24`: vocabulario estático de identificadores actuales/deprecados; distingue identificadores inventados de LicenseRef declaradas. No determina derechos de uso.
- `json-canonicalize@3.0.1`: ya utilizado por Core; se declara también donde vive la autoridad base en schemas para eliminar la implementación paralela. No añade servicio ni infraestructura.

Los resultados finales de regresión y cualquier limitación pendiente se recogerán en el informe de verificación F0. No se presentan estos defectos como corregidos únicamente por registrarlos aquí.

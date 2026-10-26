# Learning Workspace — Cuestiones abiertas reales

**Fecha:** 2026-10-25  
**Ámbito:** Solo información externa que no puede deducirse del diseño. No es un backlog de v0.2.

Los once hallazgos de la revisión tienen decisión normativa en [la especificación](learning-workspace-spec-v0.1.md#15-trazabilidad-del-cierre-y-referencias). **No queda una pregunta de dominio que impida comenzar la implementación.**

## Q01 — Entorno exacto de OpenCode V2 y comportamiento comprobado

**Falta:** Versión patch real de CLI/servicio y paquete `@opencode/plugin` con la que se ejecutará el MVP; no se ha inspeccionado ni ejecutado esa integración en esta etapa documental. La documentación oficial no demuestra cómo funciona una instalación concreta con configuración global, plugins o políticas del usuario.

**Cómo resolver:** En F0 registrar versiones y política efectiva y ejecutar smoke de herramientas directas, actor runtime, aprobación ask sin patrones guardados y bloqueo de dispatch en todos los flujos. Si una API carece de la capacidad exigida, documentar incompatibilidad concreta y bloquear esa integración hasta corregirla; no sustituir permisos por prompts ni activar una ruta remota insegura.

**Impacto:** No bloquea Core/CLI/esquemas. Sí bloquea aceptar F6/F7 y usar datos personales remotamente si no se satisfacen sus garantías. La arquitectura V2/plugin y las invariantes ya están decididas; el número patch se obtiene del entorno.

## Q02 — Proveedor, destino y derechos del contenido real del usuario

**Falta:** Qué proveedor/modelo/endpoint desea usar el usuario y con qué Notebooks reales, licencias y categorías privadas autorizará trabajar. No es legítimo inventar ese consentimiento o atribuirle derechos de traducción.

**Cómo resolver:** Onboarding local cuando se elija usar un proveedor o instalar contenido real: mostrar condiciones/destino, verificar licencia declarada y pedir consentimiento con alcance y expiración. No hace falta elegir proveedor para construir/probar el MVP: fixtures propios, mocks y CLI offline cubren aceptación automatizada. El fixture distribuido por el proyecto debe incluir licencia explícita de sus propios materiales.

**Impacto:** Solo bloquea la operación externa concreta sin consentimiento/derechos. No bloquea implementar y demostrar el vertical slice offline.

## No son preguntas abiertas

SQLite/archivos, scoring mínimo, estados, autoridad, identidad, actualización, copias, backup y privacidad ya tienen reglas v0.1. Firmas, calibración, transferencia entre versiones, sincronización, nuevos medios y sandbox están **fuera de alcance**, no requieren respuesta del usuario para empezar. La adaptación visual de un vault existente tampoco condiciona el Core: se prueba el vault recomendado y cualquier otro se admite bajo los límites documentados.

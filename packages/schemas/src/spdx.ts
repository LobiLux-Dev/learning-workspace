/**
 * Vocabulario SPDX de licencias a partir del paquete estático instalado.
 *
 * `spdx-license-ids` publica dos listas JSON: identificadores vigentes y
 * deprecados. Se cargan con `createRequire` (JSON no tiene tipos en NodeNext
 * sin `resolveJsonModule`) y se comprueban en tiempo de ejecución: si la
 * estructura del paquete cambiara, el módulo falla de forma ruidosa en lugar
 * de aceptar cualquier cadena como SPDX.
 *
 * Un identificador desconocido **no** se atribuye a SPDX: o es un
 * `LicenseRef-*` bien formado con su texto declarado (§4.1), o se rechaza.
 * Pertenecer a la lista no prueba derechos de uso ni autenticidad.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function loadStringArray(modulePath: string): ReadonlySet<string> {
  const loaded: unknown = require(modulePath);
  if (!Array.isArray(loaded)) {
    throw new TypeError(`${modulePath} must export an array of SPDX identifiers`);
  }
  const values = new Set<string>();
  for (const entry of loaded) {
    if (typeof entry !== 'string' || entry.length === 0) {
      throw new TypeError(`${modulePath} must contain only non-empty strings`);
    }
    values.add(entry);
  }
  return values;
}

/** Identificadores SPDX vigentes (708 en spdx-license-ids@3.0.24). */
export const SPDX_LICENSE_IDS: ReadonlySet<string> = loadStringArray('spdx-license-ids/index.json');

/** Identificadores SPDX deprecados (26 en spdx-license-ids@3.0.24); siguen siendo vocabulario reconocido. */
export const DEPRECATED_SPDX_LICENSE_IDS: ReadonlySet<string> = loadStringArray('spdx-license-ids/deprecated.json');

/** Forma de un `LicenseRef-*` (§4.1): idstring de SPDX, sin espacios. */
export const LICENSE_REF_PATTERN = /^LicenseRef-[A-Za-z0-9][A-Za-z0-9.-]*$/;

export function isLicenseRef(value: string): boolean {
  return LICENSE_REF_PATTERN.test(value);
}

/** ¿Es un identificador SPDX vigente o deprecado? No implica permiso legal. */
export function isSpdxLicenseId(value: string): boolean {
  return SPDX_LICENSE_IDS.has(value) || DEPRECATED_SPDX_LICENSE_IDS.has(value);
}

/** Forma general de licencia: SPDX conocido o `LicenseRef-*`. */
export const LICENSE_SHAPE_PATTERN = /^(?:LicenseRef-[A-Za-z0-9][A-Za-z0-9.-]*|[A-Za-z0-9][A-Za-z0-9.+-]*)$/;

/**
 * Licencia aceptable: vocabulario SPDX reconocido (vigente o deprecado) o una
 * referencia personalizada bien formada. Un nombre inventado como `MyLicense`
 * se rechaza; debe declararse como `LicenseRef-MyLicense`.
 */
export function isKnownLicense(value: string): boolean {
  if (isLicenseRef(value)) return true;
  return isSpdxLicenseId(value);
}

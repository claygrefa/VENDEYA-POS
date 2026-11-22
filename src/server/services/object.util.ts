// ============================================================
// src/server/services/object.util.ts — Utilidades de objetos
// ============================================================

/** Campos requeridos se mantienen; los que admiten `undefined` pasan a opcionales sin `undefined`. */
export type SinUndefined<T> = {
  [K in keyof T as undefined extends T[K] ? never : K]: T[K];
} & {
  [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined>;
};

/** Quita las claves con valor `undefined` (compatible con exactOptionalPropertyTypes). */
export function omitUndefined<T extends object>(obj: T): SinUndefined<T> {
  const salida: Record<string, unknown> = {};
  for (const [clave, valor] of Object.entries(obj)) {
    if (valor !== undefined) {
      salida[clave] = valor;
    }
  }
  return salida as SinUndefined<T>;
}

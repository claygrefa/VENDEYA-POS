// ============================================================
// src/server/services/impuesto.util.ts — Resolución del porcentaje de IVA de un producto
// ============================================================
import { AppError } from "./appError.util";

export interface ProductoParaIva {
  nombre: string;
  aplicaIva: boolean;
  codigoIvaSRI: string;
  tarifaImpuesto: { porcentaje: number; vigente: boolean } | null;
}

/**
 * Prioridad: tarifa asignada al producto → 0 si no aplica IVA →
 * tarifa vigente de la empresa con el código SRI del producto.
 */
export function resolverPorcentajeIva(producto: ProductoParaIva, tarifasVigentes: ReadonlyMap<string, number>): number {
  if (producto.tarifaImpuesto !== null) {
    if (!producto.tarifaImpuesto.vigente) {
      throw new AppError("VALIDACION", `La tarifa de impuesto de "${producto.nombre}" ya no está vigente`);
    }
    return producto.tarifaImpuesto.porcentaje;
  }
  if (!producto.aplicaIva) return 0;
  const porcentaje = tarifasVigentes.get(producto.codigoIvaSRI);
  if (porcentaje === undefined) {
    throw new AppError("VALIDACION", `No hay tarifa de IVA vigente con código ${producto.codigoIvaSRI} para "${producto.nombre}"`);
  }
  return porcentaje;
}

// ============================================================
// src/server/services/impuesto.util.ts — Resolución del porcentaje de IVA de un producto
// ============================================================
import { CODIGOS_IVA_SIN_IMPUESTO } from "../../shared/constants/sri.constants";
import { AppError } from "./appError.util";

export interface ProductoParaIva {
  nombre: string;
  aplicaIva: boolean;
  codigoIvaSRI: string;
  tarifaImpuesto: { porcentaje: number; vigente: boolean; codigo?: string } | null;
}

export interface TarifaResuelta {
  /** Código de la Tabla 17 del SRI (`codigoPorcentaje` en el XML) */
  codigo: string;
  porcentaje: number;
}

/**
 * Prioridad: tarifa asignada al producto → sin IVA (código 0 / 6 / 7 según el producto) →
 * tarifa vigente de la empresa con el código SRI del producto.
 */
export function resolverTarifaIva(producto: ProductoParaIva, tarifasVigentes: ReadonlyMap<string, number>): TarifaResuelta {
  if (producto.tarifaImpuesto !== null) {
    if (!producto.tarifaImpuesto.vigente) {
      throw new AppError("VALIDACION", `La tarifa de impuesto de "${producto.nombre}" ya no está vigente`);
    }
    return { codigo: producto.tarifaImpuesto.codigo ?? producto.codigoIvaSRI, porcentaje: producto.tarifaImpuesto.porcentaje };
  }
  if (!producto.aplicaIva) {
    const sinImpuesto = (CODIGOS_IVA_SIN_IMPUESTO as readonly string[]).includes(producto.codigoIvaSRI);
    return { codigo: sinImpuesto ? producto.codigoIvaSRI : "0", porcentaje: 0 };
  }
  const porcentaje = tarifasVigentes.get(producto.codigoIvaSRI);
  if (porcentaje === undefined) {
    throw new AppError("VALIDACION", `No hay tarifa de IVA vigente con código ${producto.codigoIvaSRI} para "${producto.nombre}"`);
  }
  return { codigo: producto.codigoIvaSRI, porcentaje };
}

export function resolverPorcentajeIva(producto: ProductoParaIva, tarifasVigentes: ReadonlyMap<string, number>): number {
  return resolverTarifaIva(producto, tarifasVigentes).porcentaje;
}

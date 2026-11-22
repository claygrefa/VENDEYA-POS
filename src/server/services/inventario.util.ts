// ============================================================
// src/server/services/inventario.util.ts
// Funciones puras: conversión de unidades, precio por lista/presentación, FEFO y prorrateo.
// ============================================================
import { AppError } from "./appError.util";
import { round2, round4 } from "./ventaCalculo.util";

// ── Unidades y presentaciones ────────────────────────────────

/** Cantidad en unidades base de `cantidad` unidades de venta con `factor` unidades base cada una. */
export function aUnidadesBase(cantidad: number, factor: number): number {
  return round4(cantidad * factor);
}

/**
 * Valida la cantidad vendida: las presentaciones (cajas, paquetes) y las unidades que no admiten
 * fracciones (UN, PAQ…) deben ser enteras; las fraccionables (KG, M…) admiten hasta 4 decimales.
 */
export function validarCantidadVenta(o: {
  cantidad: number;
  permiteDecimales: boolean;
  esPresentacion: boolean;
  nombre: string;
}): void {
  if (!o.esPresentacion && o.permiteDecimales) {
    if (Math.abs(round4(o.cantidad) - o.cantidad) > 1e-9) {
      throw new AppError("VALIDACION", `"${o.nombre}": la cantidad admite como máximo 4 decimales`);
    }
    return;
  }
  if (!Number.isInteger(o.cantidad)) {
    const motivo = o.esPresentacion ? "se vende por presentaciones completas" : "no admite cantidades fraccionadas";
    throw new AppError("VALIDACION", `"${o.nombre}" ${motivo}: cantidad entera requerida`);
  }
}

// ── Precio ───────────────────────────────────────────────────

export interface EntradaPrecio {
  /** Precio por unidad base del catálogo */
  precioProducto: number;
  /** Unidades base de la presentación vendida (1 si es unidad base) */
  factor: number;
  esPresentacion: boolean;
  /** Precio propio de la presentación en el catálogo (si tiene) */
  precioPresentacion: number | null;
  /** Precio en la lista del cliente para la unidad base (si existe) */
  precioListaBase: number | null;
  /** Precio en la lista del cliente específico de la presentación (si existe) */
  precioListaPresentacion: number | null;
}

/**
 * Precio por unidad de venta. Prioridad:
 *  - Presentación: lista (presentación) → lista (unidad base × factor) → catálogo presentación → producto × factor.
 *  - Unidad base: lista → catálogo.
 */
export function resolverPrecioUnitario(e: EntradaPrecio): number {
  if (e.esPresentacion) {
    if (e.precioListaPresentacion !== null) return round2(e.precioListaPresentacion);
    if (e.precioListaBase !== null) return round2(e.precioListaBase * e.factor);
    if (e.precioPresentacion !== null) return round2(e.precioPresentacion);
    return round2(e.precioProducto * e.factor);
  }
  return round2(e.precioListaBase ?? e.precioProducto);
}

// ── FEFO ─────────────────────────────────────────────────────

export interface LoteDisponible {
  id: string;
  cantidadActual: number;
  fechaVencimiento: Date;
  createdAt: Date;
}

export interface AsignacionLote {
  loteId: string;
  /** En unidades base */
  cantidad: number;
}

/** First-Expired-First-Out: consume primero los lotes que vencen antes (empate: el más antiguo). */
export function asignarFefo(
  lotes: ReadonlyArray<LoteDisponible>,
  cantidadBase: number
): { asignaciones: AsignacionLote[]; faltante: number } {
  const ordenados = [...lotes].sort(
    (a, b) =>
      a.fechaVencimiento.getTime() - b.fechaVencimiento.getTime() ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      a.id.localeCompare(b.id)
  );
  const asignaciones: AsignacionLote[] = [];
  let restante = round4(cantidadBase);
  for (const lote of ordenados) {
    if (restante <= 0) break;
    if (lote.cantidadActual <= 0) continue;
    const tomar = round4(Math.min(restante, lote.cantidadActual));
    asignaciones.push({ loteId: lote.id, cantidad: tomar });
    restante = round4(restante - tomar);
  }
  return { asignaciones, faltante: Math.max(0, restante) };
}

/** Reparte `total` en partes proporcionales a `pesos`; el último absorbe el redondeo (suma exacta). */
export function repartirProporcional(total: number, pesos: ReadonlyArray<number>): number[] {
  const suma = pesos.reduce((a, b) => a + b, 0);
  const partes: number[] = [];
  let acumulado = 0;
  pesos.forEach((peso, i) => {
    if (i === pesos.length - 1) {
      partes.push(round2(total - acumulado));
    } else {
      const parte = round2((total * peso) / suma);
      partes.push(parte);
      acumulado = round2(acumulado + parte);
    }
  });
  return partes;
}

/** true si la fecha de vencimiento ya pasó respecto a `ahora`. */
export function estaVencido(fechaVencimiento: Date, ahora: Date = new Date()): boolean {
  return fechaVencimiento.getTime() < ahora.getTime();
}

/** Días completos entre `ahora` y el vencimiento (negativo si ya venció). */
export function diasHastaVencimiento(fechaVencimiento: Date, ahora: Date = new Date()): number {
  return Math.ceil((fechaVencimiento.getTime() - ahora.getTime()) / 86_400_000);
}

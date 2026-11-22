// ============================================================
// src/server/services/cuadreCaja.util.ts — Cuadre de caja y fechas de cartera (funciones puras)
// ============================================================
import { round2 } from "./ventaCalculo.util";

export interface EntradaCuadre {
  montoApertura: number;
  /** Suma de `PagoVenta.monto` en efectivo de ventas COMPLETADAS del turno (lo recibido) */
  ventasEfectivoRecibido: number;
  /** Suma de `PagoVenta.cambio` de esas ventas (lo devuelto al cliente) */
  cambioEntregado: number;
  ingresos: number;
  egresos: number;
}

/** Efectivo que debería haber en caja: apertura + ventas netas en efectivo + ingresos − egresos. */
export function calcularEfectivoEsperado(e: EntradaCuadre): number {
  return round2(e.montoApertura + e.ventasEfectivoRecibido - e.cambioEntregado + e.ingresos - e.egresos);
}

/** Diferencia de arqueo: positivo = sobrante, negativo = faltante. */
export function calcularDiferencia(efectivoContado: number, efectivoEsperado: number): number {
  return round2(efectivoContado - efectivoEsperado);
}

/** Suma días calendario conservando la hora. */
export function sumarDias(fecha: Date, dias: number): Date {
  const r = new Date(fecha.getTime());
  r.setDate(r.getDate() + dias);
  return r;
}

/** Estado de una cuenta (por cobrar/pagar) según su saldo. */
export function estadoPorSaldo(saldo: number): "PARCIAL" | "PAGADA" {
  return saldo <= 0 ? "PAGADA" : "PARCIAL";
}

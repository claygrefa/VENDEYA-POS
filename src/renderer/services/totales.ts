// ============================================================
// src/renderer/services/totales.ts — Cálculo de líneas, totales y pagos para mostrar en pantalla
//
// Usa las MISMAS funciones puras que el servidor (ventaCalculo.util), de modo que lo que ve el cajero coincide con lo que
// se registra. Aun así el total definitivo lo calcula el servidor al cobrar (puede resolver otro precio: listas de precio,
// presentaciones) y es el que se muestra en la confirmación.
// ============================================================
import { TARIFAS_IVA } from "../../shared/constants/sri.constants";
import { calcularLinea, calcularTotales, distribuirPagos, round2, type ResultadoLinea, type TotalesVenta } from "../../server/services/ventaCalculo.util";
import type { ProductoPos } from "./tipos";

export { round2 };

export interface LineaCarrito {
  /** Identificador local de la línea (no es el del servidor) */
  clave: string;
  productoId: string;
  presentacionId: string | null;
  codigo: string;
  nombre: string;
  unidad: string;
  permiteDecimales: boolean;
  cantidad: number;
  /** Precio estimado en pantalla; el servidor resuelve el definitivo */
  precioUnitario: number;
  porcentajeIva: number;
  descuento: number;
  tipoDescuento: "PORCENTAJE" | "VALOR";
}

/** IVA aplicable al producto: su tarifa asignada, o la de su código SRI (Tabla 17) si no tiene. */
export function porcentajeIvaDe(p: Pick<ProductoPos, "aplicaIva" | "codigoIvaSRI" | "tarifaImpuesto">): number {
  if (!p.aplicaIva) return 0;
  if (p.tarifaImpuesto !== null) return p.tarifaImpuesto.porcentaje;
  return TARIFAS_IVA.find((t) => t.codigo === p.codigoIvaSRI)?.porcentaje ?? 0;
}

export interface CalculoCarrito {
  lineas: Array<ResultadoLinea | null>;
  totales: TotalesVenta;
  /** Alguna línea tiene un descuento inválido (mayor que su valor) */
  hayErrores: boolean;
  /** IVA agrupado por tarifa, para el desglose de la pantalla */
  ivaPorTarifa: Array<{ porcentaje: number; base: number; iva: number }>;
}

export function calcularCarrito(lineas: ReadonlyArray<LineaCarrito>): CalculoCarrito {
  const resultados = lineas.map((l) => {
    try {
      return calcularLinea({ cantidad: l.cantidad, precioUnitario: l.precioUnitario, descuento: l.descuento, tipoDescuento: l.tipoDescuento, porcentajeIva: l.porcentajeIva });
    } catch {
      return null;
    }
  });
  const validos = resultados.filter((r): r is ResultadoLinea => r !== null);
  const grupos = new Map<number, { base: number; iva: number }>();
  resultados.forEach((r, i) => {
    if (r === null) return;
    const porcentaje = lineas[i]?.porcentajeIva ?? 0;
    const g = grupos.get(porcentaje) ?? { base: 0, iva: 0 };
    g.base += r.subtotal;
    g.iva += r.iva;
    grupos.set(porcentaje, g);
  });
  return {
    lineas: resultados,
    totales: calcularTotales(validos),
    hayErrores: resultados.some((r) => r === null),
    ivaPorTarifa: [...grupos.entries()].sort(([a], [b]) => a - b).map(([porcentaje, g]) => ({ porcentaje, base: round2(g.base), iva: round2(g.iva) })),
  };
}

export interface ResumenPagos {
  pagado: number;
  /** Lo que falta por cubrir (0 si ya está cubierto) */
  falta: number;
  /** Cambio a devolver (solo si lo recibido supera lo que se debe y el excedente es en efectivo) */
  cambio: number;
  /** El excedente no se puede devolver (no hay efectivo suficiente para el cambio) */
  excedenteInvalido: boolean;
}

export function resumirPagos(aPagar: number, pagos: ReadonlyArray<{ formaPago: string; monto: number }>): ResumenPagos {
  const pagado = round2(pagos.reduce((a, p) => a + p.monto, 0));
  if (pagado < aPagar) return { pagado, falta: round2(aPagar - pagado), cambio: 0, excedenteInvalido: false };
  try {
    return { pagado, falta: 0, cambio: distribuirPagos(aPagar, pagos).cambio, excedenteInvalido: false };
  } catch {
    return { pagado, falta: 0, cambio: 0, excedenteInvalido: true };
  }
}

const formatoMoneda = new Intl.NumberFormat("es-EC", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

/** `1234.5` → `$1.234,50` */
export const dinero = (n: number): string => formatoMoneda.format(round2(n));

export const cantidadTexto = (n: number): string => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000));

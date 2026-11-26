// ============================================================
// src/server/services/ventaCalculo.util.ts
// Funciones puras de cálculo: redondeo, líneas, totales, pagos y costo promedio.
// ============================================================
import { AppError } from "./appError.util";

function redondearEscalado(n: number, escala: number): number {
  const escalado = n * escala;
  const medio = Math.floor(escalado) + 0.5;
  // Corrige el error binario cerca de medio centavo, proporcional a la magnitud.
  return Math.round(Math.abs(escalado - medio) <= Math.abs(escalado) * Number.EPSILON ? medio : escalado);
}

export function round2(n: number): number {
  return redondearEscalado(n, 100) / 100;
}

export function round4(n: number): number {
  return redondearEscalado(n, 10_000) / 10_000;
}

// ── Líneas ───────────────────────────────────────────────────

export interface EntradaLinea {
  cantidad: number;
  precioUnitario: number;
  descuento: number;
  tipoDescuento: "PORCENTAJE" | "VALOR";
  porcentajeIva: number;
}

export interface ResultadoLinea {
  bruto: number;
  descuento: number;
  subtotal: number; // bruto - descuento (base imponible)
  iva: number;
  total: number;
}

export function calcularLinea(l: EntradaLinea): ResultadoLinea {
  const bruto = round2(l.cantidad * l.precioUnitario);
  let descuento: number;
  if (l.tipoDescuento === "PORCENTAJE") {
    if (l.descuento > 100) throw new AppError("VALIDACION", "El descuento porcentual no puede superar 100%");
    descuento = round2((bruto * l.descuento) / 100);
  } else {
    descuento = round2(l.descuento);
  }
  if (descuento > bruto) throw new AppError("VALIDACION", "El descuento no puede superar el valor de la línea");

  const subtotal = round2(bruto - descuento);
  const iva = round2((subtotal * l.porcentajeIva) / 100);
  return { bruto, descuento, subtotal, iva, total: round2(subtotal + iva) };
}

export interface TotalesVenta {
  subtotal: number;
  descuento: number;
  iva: number;
  total: number;
}

export function calcularTotales(lineas: ReadonlyArray<ResultadoLinea>): TotalesVenta {
  const suma = (f: (l: ResultadoLinea) => number): number =>
    lineas.reduce((acc, l) => acc + redondearEscalado(f(l), 100), 0) / 100;
  return {
    subtotal: suma((l) => l.subtotal),
    descuento: suma((l) => l.descuento),
    iva: suma((l) => l.iva),
    total: suma((l) => l.total),
  };
}

// ── Pagos ────────────────────────────────────────────────────

export interface EntradaPago {
  formaPago: string;
  monto: number;
}

export interface ResultadoPagos {
  pagado: number;
  cambio: number;
  /** Cambio asignado a cada pago (mismo orden que la entrada); solo en efectivo */
  cambioPorPago: number[];
}

/**
 * Valida que los pagos cubran el total y reparte el cambio entre los pagos en efectivo
 * (de atrás hacia adelante). El monto de cada pago es lo recibido; el cambio se devuelve aparte.
 */
export function distribuirPagos(total: number, pagos: ReadonlyArray<EntradaPago>): ResultadoPagos {
  const pagado = round2(pagos.reduce((acc, p) => acc + p.monto, 0));
  if (pagado < total) {
    throw new AppError("VALIDACION", `Pago insuficiente: total ${total.toFixed(2)}, recibido ${pagado.toFixed(2)}`);
  }
  const cambioPorPago = pagos.map(() => 0);
  let restante = round2(pagado - total);
  const cambio = restante;

  for (let i = pagos.length - 1; i >= 0 && restante > 0; i--) {
    const pago = pagos[i] as EntradaPago;
    if (pago.formaPago !== "EFECTIVO") continue;
    const devolver = Math.min(restante, pago.monto);
    cambioPorPago[i] = round2(devolver);
    restante = round2(restante - devolver);
  }
  if (restante > 0) {
    throw new AppError("VALIDACION", "El excedente solo puede devolverse como cambio de pagos en efectivo");
  }
  return { pagado, cambio, cambioPorPago };
}

// ── Kardex ───────────────────────────────────────────────────

/** Costo promedio ponderado tras una entrada. Con stock <= 0 el costo pasa a ser el de la entrada. */
export function calcularCostoPromedio(
  stockActual: number,
  costoPromedio: number,
  cantidadEntrada: number,
  costoEntrada: number
): number {
  if (stockActual <= 0) return round4(costoEntrada);
  const stockNuevo = stockActual + cantidadEntrada;
  return round4((stockActual * costoPromedio + cantidadEntrada * costoEntrada) / stockNuevo);
}

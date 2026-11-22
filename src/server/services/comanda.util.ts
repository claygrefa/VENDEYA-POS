// ============================================================
// src/server/services/comanda.util.ts
// Funciones puras del módulo Restaurantes: estados de ítems, división de cuentas y líneas de cobro.
// ============================================================
import { repartirProporcional } from "./inventario.util";
import { round2, round4 } from "./ventaCalculo.util";

export type EstadoItem = "PENDIENTE" | "EN_PREPARACION" | "LISTO" | "ENTREGADO" | "CANCELADO";

/** Estados en los que el pedido ya salió hacia cocina/barra. */
export function esItemEnviado(estado: string): boolean {
  return estado === "EN_PREPARACION" || estado === "LISTO" || estado === "ENTREGADO";
}

/**
 * Avance permitido de un ítem (no incluye cancelación):
 *  - con cocina: EN_PREPARACION → LISTO → ENTREGADO
 *  - sin módulo de cocina: PENDIENTE → ENTREGADO directamente (cafetería de mostrador)
 */
export function transicionItemValida(de: string, a: string, usaCocina: boolean): boolean {
  if (de === "EN_PREPARACION" && a === "LISTO") return usaCocina;
  if (de === "LISTO" && a === "ENTREGADO") return usaCocina;
  if (de === "PENDIENTE" && a === "ENTREGADO") return !usaCocina;
  return false;
}

export function totalItem(cantidad: number, precioUnitario: number, descuento = 0): number {
  return round2(round2(cantidad * precioUnitario) - descuento);
}

// ── División en partes iguales ───────────────────────────────

/**
 * Cantidad que corresponde a la parte `parte` (1..partes). Las primeras partes reciben
 * `cantidad / partes` redondeado a 4 decimales y la última el resto, de modo que la suma
 * de todas las partes es exactamente `cantidad` (el stock se descuenta sin diferencias).
 */
export function cantidadDeParte(cantidad: number, partes: number, parte: number): number {
  const base = round4(cantidad / partes);
  return parte < partes ? base : round4(cantidad - base * (partes - 1));
}

/** Reparte un monto en partes iguales; la última absorbe los centavos de redondeo. */
export function dividirMontoEnPartes(total: number, partes: number): number[] {
  return repartirProporcional(total, Array.from({ length: partes }, () => 1));
}

// ── Líneas de venta para el cobro ────────────────────────────

export interface ItemCobrable {
  id: string;
  productoId: string;
  cantidad: number;
  precioUnitario: number;
  descuento: number;
}

export interface LineaCobro {
  productoId: string;
  cantidad: number;
  precioUnitario: number;
  descuento: number;
  tipoDescuento: "VALOR";
}

/** Modo ITEMS: una línea de venta por cada ítem, a los precios pactados. */
export function lineasParaItems(items: ReadonlyArray<ItemCobrable>): LineaCobro[] {
  return items.map((i) => ({
    productoId: i.productoId,
    cantidad: i.cantidad,
    precioUnitario: i.precioUnitario,
    descuento: i.descuento,
    tipoDescuento: "VALOR",
  }));
}

/** Modo PARTE_IGUAL: cada ítem aporta su fracción a la parte indicada. */
export function lineasParaParte(items: ReadonlyArray<ItemCobrable>, parte: number, partes: number): LineaCobro[] {
  const lineas: LineaCobro[] = [];
  for (const i of items) {
    const cantidad = cantidadDeParte(i.cantidad, partes, parte);
    if (cantidad <= 0) continue; // ítem tan pequeño que esta parte no le corresponde nada
    const descuentos = dividirMontoEnPartes(i.descuento, partes);
    lineas.push({
      productoId: i.productoId,
      cantidad,
      precioUnitario: i.precioUnitario,
      descuento: descuentos[parte - 1] ?? 0,
      tipoDescuento: "VALOR",
    });
  }
  return lineas;
}

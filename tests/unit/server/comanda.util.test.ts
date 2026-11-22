// ============================================================
// tests/unit/server/comanda.util.test.ts — Estados, división de cuentas y líneas de cobro
// ============================================================
import { describe, expect, it } from "vitest";
import {
  cantidadDeParte,
  dividirMontoEnPartes,
  esItemEnviado,
  lineasParaItems,
  lineasParaParte,
  totalItem,
  transicionItemValida,
  type ItemCobrable,
} from "../../../src/server/services/comanda.util";

describe("esItemEnviado", () => {
  it("true desde que sale hacia cocina/barra", () => {
    for (const e of ["EN_PREPARACION", "LISTO", "ENTREGADO"]) expect(esItemEnviado(e)).toBe(true);
    for (const e of ["PENDIENTE", "CANCELADO"]) expect(esItemEnviado(e)).toBe(false);
  });
});

describe("transicionItemValida", () => {
  it("con cocina: EN_PREPARACION → LISTO → ENTREGADO, sin saltos", () => {
    expect(transicionItemValida("EN_PREPARACION", "LISTO", true)).toBe(true);
    expect(transicionItemValida("LISTO", "ENTREGADO", true)).toBe(true);
    expect(transicionItemValida("EN_PREPARACION", "ENTREGADO", true)).toBe(false);
    expect(transicionItemValida("PENDIENTE", "LISTO", true)).toBe(false);
    expect(transicionItemValida("PENDIENTE", "ENTREGADO", true)).toBe(false);
  });

  it("sin cocina: un pendiente se entrega directamente; LISTO no existe", () => {
    expect(transicionItemValida("PENDIENTE", "ENTREGADO", false)).toBe(true);
    expect(transicionItemValida("PENDIENTE", "LISTO", false)).toBe(false);
    expect(transicionItemValida("EN_PREPARACION", "LISTO", false)).toBe(false);
  });

  it("no hay retrocesos ni salidas desde estados finales", () => {
    expect(transicionItemValida("LISTO", "EN_PREPARACION", true)).toBe(false);
    expect(transicionItemValida("ENTREGADO", "LISTO", true)).toBe(false);
    expect(transicionItemValida("CANCELADO", "ENTREGADO", false)).toBe(false);
    expect(transicionItemValida("LISTO", "LISTO", true)).toBe(false);
  });
});

describe("totalItem", () => {
  it("cantidad × precio − descuento, redondeado a centavos", () => {
    expect(totalItem(3, 2.5)).toBe(7.5);
    expect(totalItem(3, 0.333)).toBe(1);
    expect(totalItem(2, 10, 5)).toBe(15);
  });
});

describe("cantidadDeParte", () => {
  it("la suma de las partes es exactamente la cantidad original", () => {
    for (const [cantidad, partes] of [[1, 3], [3, 2], [7, 3], [0.5, 4], [10, 7], [2.35, 6]] as const) {
      const suma = Array.from({ length: partes }, (_, k) => cantidadDeParte(cantidad, partes, k + 1)).reduce((a, b) => a + b, 0);
      expect(Math.round(suma * 10_000) / 10_000).toBe(cantidad);
    }
  });

  it("las primeras partes son iguales y la última absorbe el resto", () => {
    expect([1, 2, 3].map((k) => cantidadDeParte(1, 3, k))).toEqual([0.3333, 0.3333, 0.3334]);
    expect([1, 2].map((k) => cantidadDeParte(3, 2, k))).toEqual([1.5, 1.5]);
  });
});

describe("dividirMontoEnPartes", () => {
  it("partes iguales con los centavos sobrantes en la última", () => {
    expect(dividirMontoEnPartes(10, 3)).toEqual([3.33, 3.33, 3.34]);
    expect(dividirMontoEnPartes(9, 3)).toEqual([3, 3, 3]);
    expect(dividirMontoEnPartes(0, 4)).toEqual([0, 0, 0, 0]);
  });
});

describe("líneas de cobro", () => {
  const items: ItemCobrable[] = [
    { id: "a", productoId: "p1", cantidad: 1, precioUnitario: 10, descuento: 0 },
    { id: "b", productoId: "p2", cantidad: 3, precioUnitario: 2, descuento: 1 },
  ];

  it("modo ITEMS: una línea por ítem a los precios pactados", () => {
    expect(lineasParaItems(items)).toEqual([
      { productoId: "p1", cantidad: 1, precioUnitario: 10, descuento: 0, tipoDescuento: "VALOR" },
      { productoId: "p2", cantidad: 3, precioUnitario: 2, descuento: 1, tipoDescuento: "VALOR" },
    ]);
  });

  it("modo PARTE_IGUAL: cada ítem aporta su fracción y los descuentos se reparten exactos", () => {
    const partes = [1, 2, 3].map((k) => lineasParaParte(items, k, 3));
    const sumaCantidad = (producto: string) =>
      Math.round(partes.flat().filter((l) => l.productoId === producto).reduce((a, l) => a + l.cantidad, 0) * 10_000) / 10_000;
    expect(sumaCantidad("p1")).toBe(1);
    expect(sumaCantidad("p2")).toBe(3);
    const descuento = Math.round(partes.flat().reduce((a, l) => a + l.descuento, 0) * 100) / 100;
    expect(descuento).toBe(1);
    expect(partes.every((p) => p.length === 2)).toBe(true);
  });

  it("omite ítems cuya fracción es cero", () => {
    const diminuto: ItemCobrable[] = [{ id: "x", productoId: "p", cantidad: 0.0001, precioUnitario: 1, descuento: 0 }];
    expect(lineasParaParte(diminuto, 1, 3)).toEqual([]);
    expect(lineasParaParte(diminuto, 3, 3)).toHaveLength(1); // la última recibe el resto
  });
});

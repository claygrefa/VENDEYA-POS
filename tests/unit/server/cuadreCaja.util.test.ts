// ============================================================
// tests/unit/server/cuadreCaja.util.test.ts — Cuadre de caja y fechas de cartera
// ============================================================
import { describe, expect, it } from "vitest";
import { calcularDiferencia, calcularEfectivoEsperado, estadoPorSaldo, sumarDias } from "../../../src/server/services/cuadreCaja.util";
import { resolverPorcentajeIva } from "../../../src/server/services/impuesto.util";
import { AppError } from "../../../src/server/services/appError.util";

describe("calcularEfectivoEsperado", () => {
  it("apertura + ventas netas en efectivo + ingresos − egresos", () => {
    expect(
      calcularEfectivoEsperado({ montoApertura: 100, ventasEfectivoRecibido: 25, cambioEntregado: 2, ingresos: 20, egresos: 10 })
    ).toBe(133);
  });

  it("solo apertura cuando no hubo movimientos", () => {
    expect(calcularEfectivoEsperado({ montoApertura: 50, ventasEfectivoRecibido: 0, cambioEntregado: 0, ingresos: 0, egresos: 0 })).toBe(50);
  });

  it("evita errores de punto flotante", () => {
    expect(calcularEfectivoEsperado({ montoApertura: 0.1, ventasEfectivoRecibido: 0.2, cambioEntregado: 0, ingresos: 0, egresos: 0 })).toBe(0.3);
  });
});

describe("calcularDiferencia", () => {
  it("negativo = faltante, positivo = sobrante, cero = cuadrado", () => {
    expect(calcularDiferencia(130, 133)).toBe(-3);
    expect(calcularDiferencia(135.5, 133)).toBe(2.5);
    expect(calcularDiferencia(133, 133)).toBe(0);
  });
});

describe("sumarDias / estadoPorSaldo", () => {
  it("suma días calendario sin mutar la fecha original", () => {
    const base = new Date(2026, 0, 30, 10, 0, 0);
    const r = sumarDias(base, 30);
    expect(r.getFullYear()).toBe(2026);
    expect(r.getMonth()).toBe(2); // marzo
    expect(r.getDate()).toBe(1);
    expect(base.getDate()).toBe(30);
  });

  it("0 días conserva la fecha", () => {
    const base = new Date();
    expect(sumarDias(base, 0).getTime()).toBe(base.getTime());
  });

  it("saldo cero o menor = PAGADA; mayor = PARCIAL", () => {
    expect(estadoPorSaldo(0)).toBe("PAGADA");
    expect(estadoPorSaldo(0.01)).toBe("PARCIAL");
  });
});

describe("resolverPorcentajeIva", () => {
  const tarifas = new Map([["2", 15], ["3", 5]]);
  const base = { nombre: "P", aplicaIva: true, codigoIvaSRI: "2", tarifaImpuesto: null };

  it("usa la tarifa del catálogo por código SRI", () => {
    expect(resolverPorcentajeIva(base, tarifas)).toBe(15);
    expect(resolverPorcentajeIva({ ...base, codigoIvaSRI: "3" }, tarifas)).toBe(5);
  });

  it("0 si el producto no aplica IVA", () => {
    expect(resolverPorcentajeIva({ ...base, aplicaIva: false }, tarifas)).toBe(0);
  });

  it("la tarifa asignada al producto tiene prioridad; si no está vigente falla", () => {
    expect(resolverPorcentajeIva({ ...base, tarifaImpuesto: { porcentaje: 8, vigente: true } }, tarifas)).toBe(8);
    expect(() => resolverPorcentajeIva({ ...base, tarifaImpuesto: { porcentaje: 8, vigente: false } }, tarifas)).toThrow(AppError);
  });

  it("falla si el código SRI no tiene tarifa vigente", () => {
    expect(() => resolverPorcentajeIva({ ...base, codigoIvaSRI: "99" }, tarifas)).toThrow(/tarifa de IVA vigente/);
  });
});

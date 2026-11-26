// ============================================================
// tests/unit/server/ventaCalculo.util.test.ts — Cálculo de IVA, pagos y costo promedio
// ============================================================
import { describe, expect, it } from "vitest";
import { AppError } from "../../../src/server/services/appError.util";
import {
  calcularCostoPromedio,
  calcularLinea,
  calcularTotales,
  distribuirPagos,
  round2,
  round4,
} from "../../../src/server/services/ventaCalculo.util";
import { formatearNumeroVenta } from "../../../src/server/services/venta.service";

const linea = (o: Partial<Parameters<typeof calcularLinea>[0]> = {}) =>
  calcularLinea({ cantidad: 1, precioUnitario: 10, descuento: 0, tipoDescuento: "VALOR", porcentajeIva: 15, ...o });

describe("redondeo", () => {
  it("round2 evita errores de punto flotante", () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(2.675)).toBe(2.68);
    expect(round2(10.075)).toBe(10.08);
    expect(round2(10.0749999)).toBe(10.07);
  });
  it("round4", () => {
    expect(round4(1.00005)).toBe(1.0001);
    expect(round4(0.1 + 0.2)).toBe(0.3);
  });
});

describe("calcularLinea", () => {
  it("IVA 15% sobre la base", () => {
    expect(linea({ cantidad: 2 })).toEqual({ bruto: 20, descuento: 0, subtotal: 20, iva: 3, total: 23 });
  });

  it("IVA 0% y 5%", () => {
    expect(linea({ porcentajeIva: 0 }).iva).toBe(0);
    expect(linea({ porcentajeIva: 5, cantidad: 3 }).iva).toBe(1.5);
  });

  it("descuento por valor reduce la base antes del IVA", () => {
    const r = linea({ cantidad: 2, descuento: 5 });
    expect(r).toEqual({ bruto: 20, descuento: 5, subtotal: 15, iva: 2.25, total: 17.25 });
  });

  it("descuento porcentual", () => {
    const r = linea({ cantidad: 2, descuento: 10, tipoDescuento: "PORCENTAJE" });
    expect(r).toEqual({ bruto: 20, descuento: 2, subtotal: 18, iva: 2.7, total: 20.7 });
  });

  it("cantidades decimales (granel)", () => {
    const r = linea({ cantidad: 0.35, precioUnitario: 3.2 });
    expect(r.bruto).toBe(1.12);
    expect(r.iva).toBe(0.17);
  });

  it("rechaza descuentos que superan la línea o 100%", () => {
    expect(() => linea({ descuento: 11 })).toThrow(AppError);
    expect(() => linea({ descuento: 101, tipoDescuento: "PORCENTAJE" })).toThrow(/100%/);
  });

  it("permite descuento del 100%", () => {
    expect(linea({ descuento: 100, tipoDescuento: "PORCENTAJE" })).toMatchObject({ subtotal: 0, iva: 0, total: 0 });
  });
});

describe("calcularTotales", () => {
  it("suma líneas ya redondeadas", () => {
    const l1 = linea({ cantidad: 3, precioUnitario: 0.33 }); // 0.99 + 0.15
    const l2 = linea({ porcentajeIva: 0 }); // 10
    expect(calcularTotales([l1, l2])).toEqual({ subtotal: 10.99, descuento: 0, iva: 0.15, total: 11.14 });
  });
});

describe("distribuirPagos", () => {
  it("pago exacto sin cambio", () => {
    expect(distribuirPagos(23, [{ formaPago: "TARJETA_CREDITO", monto: 23 }])).toEqual({ pagado: 23, cambio: 0, cambioPorPago: [0] });
  });

  it("cambio en efectivo", () => {
    expect(distribuirPagos(23, [{ formaPago: "EFECTIVO", monto: 25 }])).toEqual({ pagado: 25, cambio: 2, cambioPorPago: [2] });
  });

  it("pago mixto: el cambio sale del efectivo", () => {
    const r = distribuirPagos(23, [
      { formaPago: "TARJETA_DEBITO", monto: 10 },
      { formaPago: "EFECTIVO", monto: 15 },
    ]);
    expect(r.cambio).toBe(2);
    expect(r.cambioPorPago).toEqual([0, 2]);
  });

  it("reparte el cambio entre varios pagos en efectivo", () => {
    const r = distribuirPagos(10, [
      { formaPago: "EFECTIVO", monto: 10 },
      { formaPago: "EFECTIVO", monto: 3 },
    ]);
    expect(r.cambio).toBe(3);
    expect(r.cambioPorPago).toEqual([0, 3]);
  });

  it("rechaza pago insuficiente", () => {
    expect(() => distribuirPagos(23, [{ formaPago: "EFECTIVO", monto: 22.99 }])).toThrow(/insuficiente/);
  });

  it("rechaza excedente que no puede devolverse en efectivo", () => {
    expect(() => distribuirPagos(23, [{ formaPago: "TARJETA_CREDITO", monto: 30 }])).toThrow(/efectivo/);
    expect(() =>
      distribuirPagos(20, [
        { formaPago: "TARJETA_CREDITO", monto: 20 },
        { formaPago: "EFECTIVO", monto: 5 },
      ])
    ).not.toThrow(); // 5 en efectivo cubre el excedente de 5
    expect(() =>
      distribuirPagos(20, [
        { formaPago: "TARJETA_CREDITO", monto: 20 },
        { formaPago: "EFECTIVO", monto: 5 },
        { formaPago: "TRANSFERENCIA", monto: 10 },
      ])
    ).toThrow(/efectivo/);
  });
});

describe("calcularCostoPromedio", () => {
  it("con stock 0 toma el costo de la entrada", () => {
    expect(calcularCostoPromedio(0, 99, 10, 2)).toBe(2);
  });
  it("promedio ponderado", () => {
    expect(calcularCostoPromedio(10, 2, 10, 4)).toBe(3);
    expect(calcularCostoPromedio(15, 3, 5, 6)).toBe(3.75);
  });
  it("redondea a 4 decimales", () => {
    expect(calcularCostoPromedio(3, 1, 4, 2)).toBe(1.5714);
  });
});

describe("formatearNumeroVenta", () => {
  it("formato SRI 001-001-000000001", () => {
    expect(formatearNumeroVenta("001", "002", 1)).toBe("001-002-000000001");
    expect(formatearNumeroVenta("001", "001", 123456789)).toBe("001-001-123456789");
  });
});

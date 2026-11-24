// ============================================================
// tests/unit/server/sri/mapeoSri.test.ts — Códigos SRI: tarifas de IVA, formas de pago y constantes
// ============================================================
import { describe, expect, it } from "vitest";
import {
  CODIGOS_IVA_SIN_IMPUESTO,
  FORMAS_PAGO_SRI,
  IVA_GENERAL_CODIGO,
  MONTO_MAXIMO_CONSUMIDOR_FINAL,
  PROPINA_MAXIMA_PORCENTAJE,
  TARIFAS_IVA,
} from "../../../../src/shared/constants/sri.constants";
import { resolverTarifaIva, type ProductoParaIva } from "../../../../src/server/services/impuesto.util";
import { codigoFormaPagoSri, codigoIvaDesdePorcentaje } from "../../../../src/server/services/sri/comprobanteMapper";

describe("Tabla 17 del SRI (tarifas de IVA)", () => {
  it("los códigos oficiales: 4 = 15 %, 5 = 5 %, 0 = 0 %, 6 = no objeto, 7 = exento (2 y 3 son históricos)", () => {
    const porCodigo = Object.fromEntries(TARIFAS_IVA.map((t) => [t.codigo, t]));
    expect(porCodigo["4"]).toMatchObject({ porcentaje: 15, vigente: true });
    expect(porCodigo["5"]).toMatchObject({ porcentaje: 5, vigente: true });
    expect(porCodigo["0"]).toMatchObject({ porcentaje: 0, vigente: true });
    expect(porCodigo["6"]).toMatchObject({ porcentaje: 0, vigente: true });
    expect(porCodigo["7"]).toMatchObject({ porcentaje: 0, vigente: true });
    expect(porCodigo["2"]).toMatchObject({ porcentaje: 12, vigente: false });
    expect(porCodigo["3"]).toMatchObject({ porcentaje: 14, vigente: false });
    expect(IVA_GENERAL_CODIGO).toBe("4");
    expect(new Set(TARIFAS_IVA.map((t) => t.codigo)).size).toBe(TARIFAS_IVA.length); // sin códigos repetidos
  });

  it("los códigos que no generan impuesto son 0, 6 y 7", () => {
    expect([...CODIGOS_IVA_SIN_IMPUESTO]).toEqual(["0", "6", "7"]);
  });

  it("codigoIvaDesdePorcentaje (líneas anteriores al registro del código)", () => {
    expect(codigoIvaDesdePorcentaje(15)).toBe("4");
    expect(codigoIvaDesdePorcentaje(5)).toBe("5");
    expect(codigoIvaDesdePorcentaje(0)).toBe("0");
    expect(codigoIvaDesdePorcentaje(12)).toBe("2");
    expect(codigoIvaDesdePorcentaje(14)).toBe("3");
    expect(() => codigoIvaDesdePorcentaje(7)).toThrow(/No se puede determinar/);
  });
});

describe("resolverTarifaIva (código + porcentaje)", () => {
  const tarifas = new Map([["4", 15], ["5", 5], ["0", 0], ["6", 0], ["7", 0]]);
  const base: ProductoParaIva = { nombre: "P", aplicaIva: true, codigoIvaSRI: "4", tarifaImpuesto: null };

  it("por el código SRI del producto", () => {
    expect(resolverTarifaIva(base, tarifas)).toEqual({ codigo: "4", porcentaje: 15 });
    expect(resolverTarifaIva({ ...base, codigoIvaSRI: "5" }, tarifas)).toEqual({ codigo: "5", porcentaje: 5 });
    expect(resolverTarifaIva({ ...base, codigoIvaSRI: "7" }, tarifas)).toEqual({ codigo: "7", porcentaje: 0 });
  });

  it("un producto sin IVA es 0 % salvo que su código sea 6 (no objeto) o 7 (exento)", () => {
    expect(resolverTarifaIva({ ...base, aplicaIva: false }, tarifas)).toEqual({ codigo: "0", porcentaje: 0 });
    expect(resolverTarifaIva({ ...base, aplicaIva: false, codigoIvaSRI: "6" }, tarifas)).toEqual({ codigo: "6", porcentaje: 0 });
    expect(resolverTarifaIva({ ...base, aplicaIva: false, codigoIvaSRI: "7" }, tarifas)).toEqual({ codigo: "7", porcentaje: 0 });
  });

  it("la tarifa asignada al producto aporta su propio código", () => {
    expect(resolverTarifaIva({ ...base, tarifaImpuesto: { porcentaje: 5, vigente: true, codigo: "5" } }, tarifas)).toEqual({ codigo: "5", porcentaje: 5 });
    expect(() => resolverTarifaIva({ ...base, tarifaImpuesto: { porcentaje: 12, vigente: false, codigo: "2" } }, tarifas)).toThrow(/ya no está vigente/);
  });
});

describe("Formas de pago (Tabla 24)", () => {
  it("traducción de las formas internas", () => {
    expect(codigoFormaPagoSri("EFECTIVO")).toBe("01");
    expect(codigoFormaPagoSri("CREDITO")).toBe("01");
    expect(codigoFormaPagoSri("TARJETA_CREDITO")).toBe("19");
    expect(codigoFormaPagoSri("TARJETA_DEBITO")).toBe("16");
    expect(codigoFormaPagoSri("TRANSFERENCIA")).toBe("20");
    expect(codigoFormaPagoSri("CHEQUE")).toBe("20");
    expect(codigoFormaPagoSri("OTRO")).toBe("20");
  });

  it("los códigos de la tabla coinciden con los de la Ficha Técnica", () => {
    expect(FORMAS_PAGO_SRI).toEqual({
      SIN_SISTEMA_FINANCIERO: "01", COMPENSACION_DEUDAS: "15", TARJETA_DEBITO: "16", DINERO_ELECTRONICO: "17",
      TARJETA_PREPAGO: "18", TARJETA_CREDITO: "19", OTROS_SISTEMA_FINANCIERO: "20", ENDOSO_TITULOS: "21",
    });
  });
});

describe("Límites de la Ficha Técnica", () => {
  it("Consumidor Final hasta USD 50 y propina hasta el 10 % del subtotal", () => {
    expect(MONTO_MAXIMO_CONSUMIDOR_FINAL).toBe(50);
    expect(PROPINA_MAXIMA_PORCENTAJE).toBe(10);
  });
});

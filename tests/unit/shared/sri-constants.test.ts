// ============================================================
// tests/unit/shared/sri-constants.test.ts
// Prueba: Constantes SRI con valores correctos y completos
// ============================================================

import { describe, it, expect } from "vitest";
import {
  TARIFAS_IVA,
  IVA_GENERAL_PORCENTAJE,
  IVA_GENERAL_CODIGO,
  CONSUMIDOR_FINAL,
  CLAVE_ACCESO_LONGITUDES,
  TIPOS_COMPROBANTE,
  SRI_MAX_REINTENTOS,
  SRI_REINTENTOS_BACKOFF_MS,
} from "../../../src/shared/constants/sri.constants";

describe("Constantes SRI Ecuador", () => {
  it("IVA general debe ser 15% con el código SRI '4' (Tabla 17)", () => {
    expect(IVA_GENERAL_PORCENTAJE).toBe(15);
    expect(IVA_GENERAL_CODIGO).toBe("4");
  });

  it("TARIFAS_IVA debe incluir la tarifa del 15%", () => {
    const tarifa15 = TARIFAS_IVA.find((t) => t.porcentaje === 15 && t.codigo === "4");
    expect(tarifa15).toBeDefined();
  });

  it("CLAVE_ACCESO_LONGITUDES.total debe ser 49", () => {
    expect(CLAVE_ACCESO_LONGITUDES.total).toBe(49);
  });

  it("La suma de los campos de la clave de acceso debe ser 49", () => {
    const { total, ...partes } = CLAVE_ACCESO_LONGITUDES;
    const suma = Object.values(partes).reduce((acc, v) => acc + v, 0);
    expect(suma).toBe(total);
  });

  it("CONSUMIDOR_FINAL debe tener RUC de 13 dígitos", () => {
    expect(CONSUMIDOR_FINAL.identificacion).toHaveLength(13);
    expect(CONSUMIDOR_FINAL.tipoIdentificacion).toBe("07");
  });

  it("TIPOS_COMPROBANTE debe incluir los 6 tipos del SRI", () => {
    const codigos = Object.keys(TIPOS_COMPROBANTE);
    expect(codigos).toContain("01"); // Factura
    expect(codigos).toContain("04"); // Nota de Crédito
    expect(codigos).toContain("07"); // Retención
    expect(codigos).toHaveLength(6);
  });

  it("SRI_MAX_REINTENTOS debe ser 5", () => {
    expect(SRI_MAX_REINTENTOS).toBe(5);
  });

  it("SRI_REINTENTOS_BACKOFF_MS debe tener 5 valores en orden creciente", () => {
    expect(SRI_REINTENTOS_BACKOFF_MS).toHaveLength(5);
    for (let i = 1; i < SRI_REINTENTOS_BACKOFF_MS.length; i++) {
      expect(SRI_REINTENTOS_BACKOFF_MS[i]).toBeGreaterThan(SRI_REINTENTOS_BACKOFF_MS[i - 1]!);
    }
  });
});

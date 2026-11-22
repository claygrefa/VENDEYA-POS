// ============================================================
// tests/unit/shared/feature-flags.test.ts
// Prueba: FEATURE_FLAGS_POR_GIRO define flags coherentes por giro
// ============================================================

import { describe, it, expect } from "vitest";
import {
  FEATURE_FLAGS_POR_GIRO,
  type GiroNegocio,
  type FeatureFlags,
} from "../../../src/shared/types/feature-flags.types";

const giros = Object.keys(FEATURE_FLAGS_POR_GIRO) as GiroNegocio[];

describe("FEATURE_FLAGS_POR_GIRO", () => {
  it("debe definir flags para todos los giros esperados", () => {
    const girosEsperados: GiroNegocio[] = [
      "RETAIL_GENERAL",
      "FERRETERIA",
      "FARMACIA",
      "RESTAURANTE",
      "SERVICIOS",
      "DISTRIBUIDOR",
    ];
    expect(giros.sort()).toEqual(girosEsperados.sort());
  });

  it.each(giros)("giro %s: todas las claves de FeatureFlags deben estar presentes", (giro) => {
    const flags = FEATURE_FLAGS_POR_GIRO[giro];
    const requiredKeys: (keyof FeatureFlags)[] = [
      "moduloInventario", "moduloKardex", "moduloLotes", "moduloVencimientos",
      "moduloMesas", "moduloComandasCocina", "moduloBalanza", "moduloListasPrecios",
      "moduloCuentasPorCobrar", "moduloCuentasPorPagar", "moduloContabilidad",
      "emitirFacturas", "emitirNotasCredito", "emitirRetenciones",
      "emitirGuiasRemision", "emitirLiquidaciones",
      "modoTacticl", "impresionTermica", "aperturaGaveta",
      "lecturaCodigoBarras", "sincronizacionLAN",
    ];
    for (const key of requiredKeys) {
      expect(flags, `Giro ${giro} le falta la clave "${key}"`).toHaveProperty(key);
      expect(typeof flags[key]).toBe("boolean");
    }
  });

  it("FARMACIA: moduloLotes y moduloVencimientos deben ser true", () => {
    expect(FEATURE_FLAGS_POR_GIRO.FARMACIA.moduloLotes).toBe(true);
    expect(FEATURE_FLAGS_POR_GIRO.FARMACIA.moduloVencimientos).toBe(true);
  });

  it("RESTAURANTE: moduloMesas y moduloComandasCocina deben ser true", () => {
    expect(FEATURE_FLAGS_POR_GIRO.RESTAURANTE.moduloMesas).toBe(true);
    expect(FEATURE_FLAGS_POR_GIRO.RESTAURANTE.moduloComandasCocina).toBe(true);
  });

  it("SERVICIOS: moduloInventario debe ser false", () => {
    expect(FEATURE_FLAGS_POR_GIRO.SERVICIOS.moduloInventario).toBe(false);
  });
});

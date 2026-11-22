// ============================================================
// src/shared/types/feature-flags.types.ts — Feature Flags Multi-Giro
// ============================================================

/** Giros de negocio soportados por VENDEYA POS */
export type GiroNegocio =
  | "RETAIL_GENERAL"    // Tienda, minimarket, abarrotes
  | "FERRETERIA"        // Ferretería, materiales de construcción
  | "FARMACIA"          // Farmacia, distribuidora de medicamentos
  | "RESTAURANTE"       // Restaurante, cafetería, comida rápida
  | "SERVICIOS"         // Empresas de servicios (sin inventario físico)
  | "DISTRIBUIDOR";     // Distribuidora (ventas por mayor)

/** Conjunto de características habilitadas para un giro específico */
export interface FeatureFlags {
  // Módulos de negocio
  moduloInventario:      boolean;
  moduloKardex:          boolean;
  moduloLotes:           boolean;         // Farmacia
  moduloVencimientos:    boolean;         // Farmacia
  moduloMesas:           boolean;         // Restaurante
  moduloComandasCocina:  boolean;         // Restaurante
  moduloBalanza:         boolean;         // Retail granel
  moduloListasPrecios:   boolean;         // Retail / Distribuidora
  moduloCuentasPorCobrar: boolean;
  moduloCuentasPorPagar:  boolean;
  moduloContabilidad:    boolean;         // Futuro Mes 6+

  // Facturación SRI
  emitirFacturas:        boolean;
  emitirNotasCredito:    boolean;
  emitirRetenciones:     boolean;
  emitirGuiasRemision:   boolean;
  emitirLiquidaciones:   boolean;

  // UX / Hardware
  modoTacticl:           boolean;         // UI optimizada para touch
  impresionTermica:      boolean;
  aperturaGaveta:        boolean;
  lecturaCodigoBarras:   boolean;
  sincronizacionLAN:     boolean;        // Multi-caja vía WebSockets
}

/** Configuración de Feature Flags por giro de negocio */
export const FEATURE_FLAGS_POR_GIRO: Record<GiroNegocio, FeatureFlags> = {
  RETAIL_GENERAL: {
    moduloInventario:       true,
    moduloKardex:           true,
    moduloLotes:            false,
    moduloVencimientos:     false,
    moduloMesas:            false,
    moduloComandasCocina:   false,
    moduloBalanza:          true,
    moduloListasPrecios:    true,
    moduloCuentasPorCobrar: true,
    moduloCuentasPorPagar:  true,
    moduloContabilidad:     false,
    emitirFacturas:         true,
    emitirNotasCredito:     true,
    emitirRetenciones:      false,
    emitirGuiasRemision:    false,
    emitirLiquidaciones:    false,
    modoTacticl:            false,
    impresionTermica:       true,
    aperturaGaveta:         true,
    lecturaCodigoBarras:    true,
    sincronizacionLAN:      true,
  },
  FERRETERIA: {
    moduloInventario:       true,
    moduloKardex:           true,
    moduloLotes:            false,
    moduloVencimientos:     false,
    moduloMesas:            false,
    moduloComandasCocina:   false,
    moduloBalanza:          false,
    moduloListasPrecios:    true,
    moduloCuentasPorCobrar: true,
    moduloCuentasPorPagar:  true,
    moduloContabilidad:     false,
    emitirFacturas:         true,
    emitirNotasCredito:     true,
    emitirRetenciones:      true,
    emitirGuiasRemision:    true,
    emitirLiquidaciones:    true,
    modoTacticl:            false,
    impresionTermica:       true,
    aperturaGaveta:         true,
    lecturaCodigoBarras:    true,
    sincronizacionLAN:      true,
  },
  FARMACIA: {
    moduloInventario:       true,
    moduloKardex:           true,
    moduloLotes:            true,
    moduloVencimientos:     true,
    moduloMesas:            false,
    moduloComandasCocina:   false,
    moduloBalanza:          false,
    moduloListasPrecios:    false,
    moduloCuentasPorCobrar: true,
    moduloCuentasPorPagar:  true,
    moduloContabilidad:     false,
    emitirFacturas:         true,
    emitirNotasCredito:     true,
    emitirRetenciones:      false,
    emitirGuiasRemision:    false,
    emitirLiquidaciones:    false,
    modoTacticl:            false,
    impresionTermica:       true,
    aperturaGaveta:         true,
    lecturaCodigoBarras:    true,
    sincronizacionLAN:      true,
  },
  RESTAURANTE: {
    moduloInventario:       true,
    moduloKardex:           true,
    moduloLotes:            false,
    moduloVencimientos:     false,
    moduloMesas:            true,
    moduloComandasCocina:   true,
    moduloBalanza:          false,
    moduloListasPrecios:    false,
    moduloCuentasPorCobrar: false,
    moduloCuentasPorPagar:  true,
    moduloContabilidad:     false,
    emitirFacturas:         true,
    emitirNotasCredito:     true,
    emitirRetenciones:      false,
    emitirGuiasRemision:    false,
    emitirLiquidaciones:    false,
    modoTacticl:            true,
    impresionTermica:       true,
    aperturaGaveta:         true,
    lecturaCodigoBarras:    false,
    sincronizacionLAN:      true,
  },
  SERVICIOS: {
    moduloInventario:       false,
    moduloKardex:           false,
    moduloLotes:            false,
    moduloVencimientos:     false,
    moduloMesas:            false,
    moduloComandasCocina:   false,
    moduloBalanza:          false,
    moduloListasPrecios:    false,
    moduloCuentasPorCobrar: true,
    moduloCuentasPorPagar:  true,
    moduloContabilidad:     false,
    emitirFacturas:         true,
    emitirNotasCredito:     true,
    emitirRetenciones:      true,
    emitirGuiasRemision:    false,
    emitirLiquidaciones:    false,
    modoTacticl:            false,
    impresionTermica:       false,
    aperturaGaveta:         false,
    lecturaCodigoBarras:    false,
    sincronizacionLAN:      false,
  },
  DISTRIBUIDOR: {
    moduloInventario:       true,
    moduloKardex:           true,
    moduloLotes:            false,
    moduloVencimientos:     false,
    moduloMesas:            false,
    moduloComandasCocina:   false,
    moduloBalanza:          false,
    moduloListasPrecios:    true,
    moduloCuentasPorCobrar: true,
    moduloCuentasPorPagar:  true,
    moduloContabilidad:     false,
    emitirFacturas:         true,
    emitirNotasCredito:     true,
    emitirRetenciones:      true,
    emitirGuiasRemision:    true,
    emitirLiquidaciones:    true,
    modoTacticl:            false,
    impresionTermica:       true,
    aperturaGaveta:         true,
    lecturaCodigoBarras:    true,
    sincronizacionLAN:      true,
  },
};

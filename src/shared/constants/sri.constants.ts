// ============================================================
// src/shared/constants/sri.constants.ts — Constantes del SRI Ecuador
// ============================================================

/**
 * Versión del XML (atributo `version` de la raíz) de cada comprobante que se emite, según los XSD oficiales
 * incluidos en `src/server/services/sri/xsd`: factura 2.1.0 y nota de crédito 1.1.0.
 */
export const VERSION_XML_COMPROBANTE = { "01": "2.1.0", "04": "1.1.0" } as const;

/** Versión de la Ficha Técnica de Comprobantes Electrónicos (esquema offline) sobre la que se implementó. */
export const VERSION_FICHA_TECNICA_SRI = "2.34" as const;

/** URLs de Web Services SRI */
export const SRI_WS = {
  PRUEBAS: {
    RECEPCION:    "https://celcer.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline?wsdl",
    AUTORIZACION: "https://celcer.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline?wsdl",
  },
  PRODUCCION: {
    RECEPCION:    "https://cel.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline?wsdl",
    AUTORIZACION: "https://cel.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline?wsdl",
  },
} as const;

/**
 * Tarifas de IVA según la Tabla 17 de la Ficha Técnica de Comprobantes Electrónicos (esquema offline, v2.34).
 * El código es el que viaja en `codigoPorcentaje` del XML. Ojo: el código NO es el porcentaje
 * (p. ej. 15 % es el código "4"; el "2" es la antigua tarifa del 12 %).
 * Códigos no sembrados: "8" (IVA diferenciado por decreto, p. ej. 8 % turismo) y "10" (13 %).
 */
export const TARIFAS_IVA = [
  { codigo: "0", porcentaje: 0,  descripcion: "0%",                       vigente: true  },
  { codigo: "2", porcentaje: 12, descripcion: "12% (histórica)",           vigente: false },
  { codigo: "3", porcentaje: 14, descripcion: "14% (histórica)",           vigente: false },
  { codigo: "4", porcentaje: 15, descripcion: "15% - Tarifa general",      vigente: true  },
  { codigo: "5", porcentaje: 5,  descripcion: "5% - Tarifa reducida",      vigente: true  },
  { codigo: "6", porcentaje: 0,  descripcion: "No objeto de IVA",          vigente: true  },
  { codigo: "7", porcentaje: 0,  descripcion: "Exento de IVA",             vigente: true  },
] as const;

/** Tarifa IVA general vigente en Ecuador (código SRI "4" = 15 %) */
export const IVA_GENERAL_PORCENTAJE = 15;
export const IVA_GENERAL_CODIGO     = "4";

/** Códigos de IVA que no generan impuesto (0 %, no objeto, exento) */
export const CODIGOS_IVA_SIN_IMPUESTO = ["0", "6", "7"] as const;

/** Código del impuesto IVA en `<impuesto><codigo>` (Tabla 16) */
export const CODIGO_IMPUESTO_IVA = "2";

/** Formas de pago (Tabla 24) */
export const FORMAS_PAGO_SRI = {
  SIN_SISTEMA_FINANCIERO: "01",
  COMPENSACION_DEUDAS:    "15",
  TARJETA_DEBITO:         "16",
  DINERO_ELECTRONICO:     "17",
  TARJETA_PREPAGO:        "18",
  TARJETA_CREDITO:        "19",
  OTROS_SISTEMA_FINANCIERO: "20",
  ENDOSO_TITULOS:         "21",
} as const;

/** Una factura a Consumidor Final no puede superar este valor (Ficha Técnica, 9.10): sobre él se identifica al adquirente. */
export const MONTO_MAXIMO_CONSUMIDOR_FINAL = 50;

/** La propina no puede superar este porcentaje del subtotal (Ficha Técnica, 9.16). */
export const PROPINA_MAXIMA_PORCENTAJE = 10;

/** Tipos de Comprobante (Tabla 4 Manual SRI) */
export const TIPOS_COMPROBANTE = {
  "01": "Factura",
  "03": "Liquidación de Compra de Bienes y Prestación de Servicios",
  "04": "Nota de Crédito",
  "05": "Nota de Débito",
  "06": "Guía de Remisión",
  "07": "Comprobante de Retención",
} as const;

/** Tipos de Identificación del Comprador (Tabla 6 Manual SRI) */
export const TIPOS_IDENTIFICACION = {
  "04": "RUC",
  "05": "Cédula de Ciudadanía",
  "06": "Pasaporte",
  "07": "Consumidor Final",
  "08": "Identificación del Exterior",
  "09": "Placa",
} as const;

/** Dato de Consumidor Final (cliente genérico) */
export const CONSUMIDOR_FINAL = {
  tipoIdentificacion: "07" as const,
  identificacion:     "9999999999999",
  razonSocial:        "CONSUMIDOR FINAL",
} as const;

/** Longitudes estándar de los campos de la Clave de Acceso */
export const CLAVE_ACCESO_LONGITUDES = {
  fechaEmision:      8,
  tipoComprobante:   2,
  ruc:               13,
  ambiente:          1,
  serie:             6,  // sucursal (3) + puntoEmision (3)
  secuencial:        9,
  codigoNumerico:    8,
  tipoEmision:       1,
  digitoVerificador: 1,
  total:             49,
} as const;

/** Tiempo entre reintentos de envío SRI (milisegundos) */
export const SRI_REINTENTOS_BACKOFF_MS = [
  5_000,     // 1er reintento: 5 s
  30_000,    // 2do: 30 s
  120_000,   // 3ro: 2 min
  600_000,   // 4to: 10 min
  3_600_000, // 5to: 1 h
] as const;

/** Máximo de reintentos automáticos antes de marcar como fallido permanente */
export const SRI_MAX_REINTENTOS = 5;

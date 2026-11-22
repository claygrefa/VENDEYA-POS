// ============================================================
// src/shared/constants/sri.constants.ts — Constantes del SRI Ecuador
// ============================================================

/** Versiones de los esquemas XSD de comprobantes */
export const SRI_VERSION_COMPROBANTE = "2.1.0" as const;

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

/** Tabla de IVA vigente Ecuador (2024–2025) */
export const TARIFAS_IVA = [
  { codigo: "0",  porcentaje: 0,   descripcion: "0%  - Tarifa 0"                              },
  { codigo: "2",  porcentaje: 15,  descripcion: "15% - Tarifa General (desde abr-2024)"        },
  { codigo: "3",  porcentaje: 5,   descripcion: "5%  - Tarifa Reducida (canasta básica)"        },
  { codigo: "6",  porcentaje: 0,   descripcion: "No objeto de IVA"                             },
  { codigo: "7",  porcentaje: 0,   descripcion: "Exento de IVA"                               },
  { codigo: "8",  porcentaje: 8,   descripcion: "8%  - IVA turismo interno (Galápagos)"        },
  { codigo: "10", porcentaje: 10,  descripcion: "10% - IVA turismo receptivo"                  },
  { codigo: "9",  porcentaje: 15,  descripcion: "15% - Tarifa General (IVA bienes específicos)" },
] as const;

/** Tarifa IVA general vigente en Ecuador */
export const IVA_GENERAL_PORCENTAJE = 15;
export const IVA_GENERAL_CODIGO     = "2";

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

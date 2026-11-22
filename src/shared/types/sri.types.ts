// ============================================================
// src/shared/types/sri.types.ts — Tipos para Facturación Electrónica SRI Ecuador
// ============================================================

import type { UUID, AuditTimestamps } from "./common.types";

/** Tipos de Comprobante SRI (Tabla 4 del Manual Técnico) */
export type TipoComprobanteSRI =
  | "01" // Factura
  | "03" // Liquidación de Compra de Bienes y Prestación de Servicios
  | "04" // Nota de Crédito
  | "05" // Nota de Débito
  | "06" // Guía de Remisión
  | "07"; // Comprobante de Retención

/** Ambiente SRI */
export type AmbienteSRI = "1" | "2"; // 1 = Pruebas, 2 = Producción

/** Tipo de Emisión */
export type TipoEmision = "1"; // 1 = Normal (Emisión en línea)

/** Estado del comprobante en el ciclo de vida SRI */
export type EstadoComprobante =
  | "PENDIENTE"     // Generado localmente, en cola de envío
  | "EN_PROCESO"    // Enviado al SRI, esperando autorización
  | "AUTORIZADO"    // Autorizado por el SRI
  | "RECHAZADO"     // Rechazado por el SRI (error en datos)
  | "DEVUELTO"      // Devuelto por el SRI (error técnico, se puede reintentar)
  | "ANULADO";      // Anulado a nivel local (SRI no tiene método de anulación online)

export interface ComprobanteElectronico extends AuditTimestamps {
  id:                UUID;
  claveAcceso:       string;    // 49 dígitos
  tipoComprobante:   TipoComprobanteSRI;
  ambiente:          AmbienteSRI;
  serie:             string;    // "001-001"
  secuencial:        string;    // 9 dígitos: "000000001"
  fechaEmision:      Date;
  xmlFirmado?:       string | null;  // XML con firma XAdES-BES
  xmlAutorizado?:    string | null;  // XML con nodo de autorización SRI
  estado:            EstadoComprobante;
  numeroAutorizacion?: string | null;
  fechaAutorizacion?:  Date   | null;
  mensajesRespuesta?:  string | null; // JSON con mensajes del SRI
  intentosEnvio:     number;
  proximoIntento?:   Date   | null;
  ventaId?:          UUID   | null;
  empresaId:         UUID;
  sucursalId:        UUID;
  puntoEmisionId:    UUID;
}

/** Resultado de la validación de Clave de Acceso */
export interface ClaveAccesoDesglosada {
  fechaEmision:    string;  // ddMMaaaa
  tipoComprobante: TipoComprobanteSRI;
  ruc:             string;
  ambiente:        AmbienteSRI;
  serie:           string;  // sucursal + puntoEmision: "001001"
  secuencial:      string;  // 9 dígitos
  codigoNumerico:  string;  // 8 dígitos aleatorios
  tipoEmision:     TipoEmision;
  digitoVerificador: number; // Módulo 11
}

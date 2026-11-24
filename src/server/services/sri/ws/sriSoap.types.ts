// ============================================================
// src/server/services/sri/ws/sriSoap.types.ts — Contrato del cliente SOAP del SRI
// ============================================================
import type { AmbienteSri } from "../claveAcceso.util";

/** Mensaje que devuelve el SRI (recepción o autorización). */
export interface MensajeSri {
  identificador: string;
  mensaje: string;
  informacionAdicional: string | null;
  /** ERROR | ADVERTENCIA | INFORMATIVO (según el SRI) */
  tipo: string;
}

export type EstadoRecepcion = "RECIBIDA" | "DEVUELTA";

export interface RespuestaRecepcion {
  estado: EstadoRecepcion;
  mensajes: MensajeSri[];
}

/** Una autorización del SRI para la clave consultada. */
export interface AutorizacionSri {
  /** AUTORIZADO | NO AUTORIZADO | EN PROCESAMIENTO (u otro texto que envíe el SRI) */
  estado: string;
  numeroAutorizacion: string | null;
  fechaAutorizacion: Date | null;
  /** PRUEBAS | PRODUCCION */
  ambiente: string | null;
  /** XML del comprobante tal como lo devolvió el SRI */
  comprobante: string | null;
  mensajes: MensajeSri[];
}

export interface RespuestaAutorizacion {
  claveAcceso: string;
  autorizaciones: AutorizacionSri[];
}

/** Contrato que usa el servicio de envío (permite sustituir el SRI real por uno simulado). */
export interface ClienteSri {
  enviarComprobante(ambiente: AmbienteSri, xmlFirmado: string): Promise<RespuestaRecepcion>;
  consultarAutorizacion(ambiente: AmbienteSri, claveAcceso: string): Promise<RespuestaAutorizacion>;
}

/**
 * Fallo de comunicación o respuesta ininteligible (sin red, tiempo agotado, HTTP 5xx, SOAP Fault, XML inesperado).
 * NUNCA significa que el SRI rechazó el comprobante: siempre es reintentable.
 */
export class SriTransporteError extends Error {
  constructor(mensaje: string, readonly causa?: unknown) {
    super(mensaje);
    this.name = "SriTransporteError";
  }
}

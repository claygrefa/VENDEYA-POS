// ============================================================
// src/server/services/sri/claveAcceso.util.ts — Clave de Acceso de 49 dígitos (Ficha Técnica SRI, Tabla 1)
//
//   fecha ddMMyyyy (8) + tipo comprobante (2) + RUC (13) + ambiente (1) + serie (6) +
//   secuencial (9) + código numérico (8) + tipo de emisión (1) + dígito verificador Módulo 11 (1)
// ============================================================
import { randomInt } from "crypto";
import { CLAVE_ACCESO_LONGITUDES, TIPOS_COMPROBANTE } from "../../../shared/constants/sri.constants";
import { AppError } from "../appError.util";
import { fechaParaClave } from "./fechaEcuador.util";

export type AmbienteSri = "1" | "2"; // 1 = pruebas, 2 = producción

export interface PartesClaveAcceso {
  /** ddMMyyyy */
  fechaEmision: string;
  tipoComprobante: string;
  ruc: string;
  ambiente: AmbienteSri;
  /** establecimiento (3) + punto de emisión (3) */
  serie: string;
  secuencial: string;
  codigoNumerico: string;
  tipoEmision: string;
  digitoVerificador: string;
}

/**
 * Dígito verificador Módulo 11: ponderadores 2,3,4,5,6,7 repetidos de DERECHA a izquierda;
 * resultado = 11 − (suma mod 11); si es 11 → 0 y si es 10 → 1 (Ficha Técnica 5.2).
 */
export function calcularDigitoVerificador(cadena48: string): number {
  if (!/^\d+$/.test(cadena48)) throw new AppError("VALIDACION", "El Módulo 11 solo se calcula sobre dígitos");
  let suma = 0;
  let ponderador = 2;
  for (let i = cadena48.length - 1; i >= 0; i--) {
    suma += Number(cadena48[i]) * ponderador;
    ponderador = ponderador === 7 ? 2 : ponderador + 1;
  }
  const resultado = 11 - (suma % 11);
  if (resultado === 11) return 0;
  if (resultado === 10) return 1;
  return resultado;
}

/** Código numérico de 8 dígitos (su algoritmo es libre para el emisor; aquí, aleatorio criptográfico). */
export function generarCodigoNumerico(): string {
  return String(randomInt(0, 100_000_000)).padStart(8, "0");
}

export interface EntradaClaveAcceso {
  fechaEmision: Date;
  /** "01" factura, "04" nota de crédito… */
  tipoComprobante: string;
  ruc: string;
  ambiente: AmbienteSri;
  /** Código de establecimiento (3 dígitos) */
  establecimiento: string;
  /** Código de punto de emisión (3 dígitos) */
  puntoEmision: string;
  /** Secuencial entero ≥ 1 (se rellena a 9 dígitos) */
  secuencial: number;
  /** 8 dígitos; si se omite se genera uno */
  codigoNumerico?: string;
  /** Solo existe la emisión normal ("1") en el esquema offline */
  tipoEmision?: "1";
}

function exigir(condicion: boolean, mensaje: string): void {
  if (!condicion) throw new AppError("VALIDACION", mensaje);
}

export function generarClaveAcceso(e: EntradaClaveAcceso): string {
  exigir(Object.hasOwn(TIPOS_COMPROBANTE, e.tipoComprobante), `Tipo de comprobante inválido: ${e.tipoComprobante}`);
  exigir(/^\d{10}001$/.test(e.ruc), `RUC inválido para la clave de acceso: ${e.ruc} (13 dígitos terminados en 001)`);
  exigir(e.ambiente === "1" || e.ambiente === "2", "El ambiente debe ser 1 (pruebas) o 2 (producción)");
  exigir(/^\d{3}$/.test(e.establecimiento), `Establecimiento inválido: ${e.establecimiento}`);
  exigir(/^\d{3}$/.test(e.puntoEmision), `Punto de emisión inválido: ${e.puntoEmision}`);
  exigir(Number.isInteger(e.secuencial) && e.secuencial >= 1 && e.secuencial <= 999_999_999, `Secuencial fuera de rango: ${e.secuencial}`);
  const codigoNumerico = e.codigoNumerico ?? generarCodigoNumerico();
  exigir(/^\d{8}$/.test(codigoNumerico), "El código numérico debe tener 8 dígitos");

  const base =
    fechaParaClave(e.fechaEmision) +
    e.tipoComprobante +
    e.ruc +
    e.ambiente +
    e.establecimiento +
    e.puntoEmision +
    String(e.secuencial).padStart(CLAVE_ACCESO_LONGITUDES.secuencial, "0") +
    codigoNumerico +
    (e.tipoEmision ?? "1");
  return base + String(calcularDigitoVerificador(base));
}

/** Desarma una clave de acceso en sus partes (sin validar el dígito verificador). */
export function parsearClaveAcceso(clave: string): PartesClaveAcceso {
  exigir(/^\d{49}$/.test(clave), "La clave de acceso debe tener exactamente 49 dígitos");
  return {
    fechaEmision: clave.slice(0, 8),
    tipoComprobante: clave.slice(8, 10),
    ruc: clave.slice(10, 23),
    ambiente: clave.slice(23, 24) as AmbienteSri,
    serie: clave.slice(24, 30),
    secuencial: clave.slice(30, 39),
    codigoNumerico: clave.slice(39, 47),
    tipoEmision: clave.slice(47, 48),
    digitoVerificador: clave.slice(48, 49),
  };
}

/**
 * ¿La clave tiene 49 dígitos y un dígito verificador correcto?
 * Contrato: valida SOLO la forma y el Módulo 11 (detecta errores de digitación). No comprueba que el tipo de
 * comprobante, el ambiente o el RUC sean coherentes; para eso se usa `parsearClaveAcceso` y se revisan sus partes.
 */
export function validarClaveAcceso(clave: string): boolean {
  if (!/^\d{49}$/.test(clave)) return false;
  return calcularDigitoVerificador(clave.slice(0, 48)) === Number(clave[48]);
}

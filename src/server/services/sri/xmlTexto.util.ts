// ============================================================
// src/server/services/sri/xmlTexto.util.ts — Texto y números aptos para los esquemas del SRI
// ============================================================
import { round2 } from "../ventaCalculo.util";

// Caracteres de control no permitidos por XML 1.0 (se conservan \t, \n y \r solo para luego normalizarlos)
// eslint-disable-next-line no-control-regex
const CONTROL_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

/**
 * Deja un texto válido para los esquemas del SRI (`[^\n]*`, longitud máxima): quita caracteres de control,
 * convierte saltos de línea y tabulaciones en espacios, colapsa espacios y recorta a `max`.
 * Si queda vacío devuelve `respaldo` (los campos obligatorios exigen al menos 1 carácter).
 */
export function limpiarTexto(valor: string | null | undefined, max: number, respaldo = "N/A"): string {
  const limpio = (valor ?? "").replace(CONTROL_XML, "").replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim();
  const recortado = limpio.slice(0, max).trim();
  return recortado === "" ? respaldo : recortado;
}

/** Igual que `limpiarTexto` pero devuelve `undefined` si no hay contenido (campos opcionales). */
export function limpiarTextoOpcional(valor: string | null | undefined, max: number): string | undefined {
  const limpio = limpiarTexto(valor, max, "");
  return limpio === "" ? undefined : limpio;
}

/** Valor monetario con 2 decimales y punto decimal ("123456.98"). */
export function formatoDinero(valor: number): string {
  return round2(valor).toFixed(2);
}

/** Cantidad o precio unitario con 6 decimales (máximo permitido por los esquemas 1.1.0 / 2.1.0). */
export function formatoUnitario(valor: number): string {
  return (Math.round((valor + Number.EPSILON) * 1_000_000) / 1_000_000).toFixed(6);
}

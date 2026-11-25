// ============================================================
// src/server/services/telemetria/telemetria.util.ts — Limpieza de datos personales en los reportes de error
//
// Un mensaje de error o una pila pueden arrastrar datos del negocio (el nombre de un cliente en un mensaje de validación, el RUC en una
// consulta, la ruta con el nombre del usuario de Windows, un token). Antes de guardar o enviar nada se eliminan: es la barrera que hace
// aceptable la telemetría. Se aplica en el servidor aunque la interfaz ya limpie, porque la interfaz no es de confiar.
// ============================================================
import { z } from "zod";
import type { OrigenError, ReporteError } from "../../../shared/types/telemetria.types";

export const MAX_MENSAJE = 300;
export const MAX_PILA = 2_000;
export const MAX_LINEAS_PILA = 25;

/** Sustituciones en orden: lo más específico primero */
const REGLAS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bbearer\s+[\w.~+/=-]+/gi, "Bearer <oculto>"],
  [/\b(password|passwd|contrase[ñn]a|clave|secret|token|authorization|frase)(["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&]+)/gi, "$1$2<oculto>"],
  [/[?&](token|access_token|clave|password)=[^&\s#]*/gi, "?$1=<oculto>"],
  [/\bhttps?:\/\/[^\s)'"<>]+/gi, "<url>"],
  [/\bfile:\/\/\/?[^\s)'"<>]+/gi, "<archivo>"],
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "<correo>"],
  // Rutas con el nombre del usuario del sistema (Windows, macOS, Linux)
  [/[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s:)"']+/gi, "<inicio>"],
  [/\/(?:Users|home)\/[^/\s:)"']+/g, "<inicio>"],
  [/\b[a-f0-9]{32,}\b/gi, "<token>"],
  [/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, "<ip>"],
  // RUC (13), cédula (10), clave de acceso (49), teléfonos, tarjetas…: toda secuencia larga de dígitos
  [/\d{9,}/g, "<numero>"],
];

export function limpiarTexto(texto: string, maximo: number): string {
  let t = texto;
  for (const [regla, reemplazo] of REGLAS) t = t.replace(regla, reemplazo);
  // eslint-disable-next-line no-control-regex
  t = t.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
  return t.length > maximo ? `${t.slice(0, maximo)}…` : t;
}

function limpiarPila(pila: string): string {
  const lineas = pila.split(/\r?\n/).slice(0, MAX_LINEAS_PILA).map((l) => limpiarTexto(l, 300));
  return limpiarTexto(lineas.join("\n"), MAX_PILA);
}

export const EntradaErrorSchema = z.object({
  origen: z.enum(["interfaz", "servidor"]).default("interfaz"),
  mensaje: z.string().min(1).max(5_000),
  pila: z.string().max(20_000).nullish(),
  vista: z.string().max(40).nullish(),
});

export interface ContextoReporte {
  id: string;
  fecha: string;
  version: string;
  plataforma: string;
}

/** Construye el reporte con todo lo que venga del usuario o del error ya limpio. */
export function construirReporte(entrada: { origen: OrigenError; mensaje: string; pila?: string | null | undefined; vista?: string | null | undefined }, ctx: ContextoReporte): ReporteError {
  return {
    id: ctx.id,
    fecha: ctx.fecha,
    version: limpiarTexto(ctx.version, 30),
    plataforma: limpiarTexto(ctx.plataforma, 40),
    origen: entrada.origen,
    // La vista es un nombre interno de pantalla: solo letras, números y guion
    vista: entrada.vista === null || entrada.vista === undefined ? null : entrada.vista.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 30) || null,
    mensaje: limpiarTexto(entrada.mensaje, MAX_MENSAJE),
    pila: entrada.pila === null || entrada.pila === undefined || entrada.pila === "" ? null : limpiarPila(entrada.pila),
  };
}

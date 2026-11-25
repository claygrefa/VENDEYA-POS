// ============================================================
// src/server/services/licencia/licencia.estado.ts — Qué dice la licencia hoy (función pura: no toca la base ni la red)
//
// Reglas (en este orden; la primera que aplica manda):
//  1. Licenciamiento apagado → NO_REQUERIDA.   2. Sin licencia guardada → SIN_LICENCIA.
//  3. La firma no vale, es de otra empresa o de otro equipo, o la fecha del equipo se atrasó → INVALIDA.
//  4. El servidor la revocó / marcó la suscripción como vencida / liberó este equipo → REVOCADA / VENCIDA / INVALIDA.
//  5. Terminó la suscripción → VENCIDA.
//  6. Más de `graciaDias` sin validar en línea → BLOQUEADA_OFFLINE; más de `avisoGraciaDias` → GRACIA (se opera, con aviso).
//  7. Quedan `avisoVencimientoDias` o menos → POR_VENCER. Si no, ACTIVA.
// Solo ACTIVA, POR_VENCER, GRACIA y NO_REQUERIDA permiten operar.
// ============================================================
import type { EstadoLicencia, TipoEstadoLicencia } from "../../../shared/types/licencia.types";
import { verificarLicencia, type LicenciaPayload } from "./licencia.token";

export const DIA_MS = 86_400_000;
/** Cuánto se tolera que el reloj del equipo esté por debajo del más alto visto (ajustes automáticos de hora, zonas horarias) */
const TOLERANCIA_RELOJ_MS = 10 * 60_000;

export interface LicenciaGuardada {
  clave: string;
  token: string;
  dispositivoId: string;
  ultimaValidacion: Date;
  ultimoRelojVisto: Date;
  bloqueoServidor: string | null;
  motivoBloqueo: string | null;
}

export interface EntradaEvaluacion {
  requerida: boolean;
  licencia: LicenciaGuardada | null;
  clavePublica: string | null;
  /** RUC de la empresa de esta instalación */
  ruc: string;
  /** Identificador de este equipo */
  dispositivoId: string;
  ahora: Date;
  /** Días de gracia offline desde la última validación correcta (15) */
  graciaDias: number;
  /** Desde cuántos días sin validar se avisa (2) */
  avisoGraciaDias: number;
  /** Con cuántos días para vencer se avisa (7) */
  avisoVencimientoDias: number;
}

export function enmascararClave(clave: string): string {
  const partes = clave.split("-");
  if (partes.length >= 3) return [partes[0], ...partes.slice(1, -1).map((p) => "•".repeat(p.length)), partes[partes.length - 1]].join("-");
  return clave.length <= 8 ? "•".repeat(clave.length) : `${clave.slice(0, 4)}${"•".repeat(clave.length - 8)}${clave.slice(-4)}`;
}

const fecha = (d: Date): string => `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
const plural = (n: number, uno: string, varios: string): string => `${n} ${n === 1 ? uno : varios}`;

const VACIO: EstadoLicencia = {
  tipo: "NO_REQUERIDA", permiteOperar: true, mensaje: "", plan: null, vence: null, diasParaVencer: null, ultimaValidacion: null,
  diasGraciaRestantes: null, maxDispositivos: null, claveEnmascarada: null, dispositivoId: null,
};

const PERMITEN: ReadonlySet<TipoEstadoLicencia> = new Set<TipoEstadoLicencia>(["NO_REQUERIDA", "ACTIVA", "POR_VENCER", "GRACIA"]);

export function evaluarLicencia(e: EntradaEvaluacion): EstadoLicencia {
  const hecho = (tipo: TipoEstadoLicencia, mensaje: string, extra: Partial<EstadoLicencia> = {}): EstadoLicencia => ({
    ...VACIO, ...extra, tipo, permiteOperar: PERMITEN.has(tipo), mensaje, dispositivoId: e.dispositivoId,
  });

  if (!e.requerida) return hecho("NO_REQUERIDA", "Licenciamiento no requerido en esta instalación");
  const l = e.licencia;
  if (l === null) return hecho("SIN_LICENCIA", "Active su licencia para registrar ventas. Sus datos y reportes siguen disponibles.");

  const base: Partial<EstadoLicencia> = { claveEnmascarada: enmascararClave(l.clave), ultimaValidacion: l.ultimaValidacion.toISOString() };
  const invalida = (mensaje: string, extra: Partial<EstadoLicencia> = {}): EstadoLicencia => hecho("INVALIDA", mensaje, { ...base, ...extra });

  const v = e.clavePublica === null ? ({ valida: false, motivo: "Falta la clave pública del servidor de licencias" } as const) : verificarLicencia(l.token, e.clavePublica);
  if (!v.valida) return invalida(`${v.motivo}. Vuelva a activarla.`);
  const p: LicenciaPayload = v.payload;
  const vence = new Date(p.vence);
  const diasParaVencer = Math.ceil((vence.getTime() - e.ahora.getTime()) / DIA_MS);
  const conPlan: Partial<EstadoLicencia> = { ...base, plan: p.plan, vence: p.vence, diasParaVencer, maxDispositivos: p.maxDispositivos };

  if (p.ruc !== e.ruc) return invalida("Esta licencia pertenece a otra empresa (RUC distinto). Active la licencia de su empresa.", conPlan);
  if (p.dispositivoId !== e.dispositivoId || l.dispositivoId !== e.dispositivoId) {
    return invalida("Esta licencia está activada en otro equipo. Actívela de nuevo en este (use otra plaza de su plan si hace falta).", conPlan);
  }
  if (e.ahora.getTime() < l.ultimoRelojVisto.getTime() - TOLERANCIA_RELOJ_MS) {
    return invalida(`La fecha de este equipo es anterior a la última vez que se usó el sistema (${fecha(l.ultimoRelojVisto)}). Corrija la fecha y la hora.`, conPlan);
  }

  if (l.bloqueoServidor === "REVOCADA") return hecho("REVOCADA", `La licencia fue revocada${l.motivoBloqueo === null ? "" : `: ${l.motivoBloqueo}`}. Contacte a su proveedor.`, conPlan);
  if (l.bloqueoServidor === "SUSCRIPCION_VENCIDA") return hecho("VENCIDA", `La suscripción está vencida${l.motivoBloqueo === null ? "" : ` (${l.motivoBloqueo})`}. Renuévela para seguir vendiendo.`, conPlan);
  if (l.bloqueoServidor === "DISPOSITIVO") return invalida("Este equipo fue liberado de la licencia desde otro lugar. Actívela de nuevo si desea usarlo.", conPlan);

  if (e.ahora.getTime() > vence.getTime()) {
    return hecho("VENCIDA", `La suscripción venció el ${fecha(vence)}. Renuévela para seguir vendiendo; sus datos y reportes siguen disponibles.`, { ...conPlan, diasParaVencer: Math.min(diasParaVencer, 0) });
  }

  const sinValidarMs = Math.max(0, e.ahora.getTime() - l.ultimaValidacion.getTime());
  const sinValidarDias = sinValidarMs / DIA_MS;
  if (sinValidarDias > e.graciaDias) {
    return hecho("BLOQUEADA_OFFLINE", `Hace más de ${e.graciaDias} días que no se valida la licencia. Conecte este equipo a internet para continuar.`, { ...conPlan, diasGraciaRestantes: 0 });
  }
  if (sinValidarDias > e.avisoGraciaDias) {
    const restantes = Math.max(1, Math.ceil(e.graciaDias - sinValidarDias));
    return hecho("GRACIA", `No se ha podido validar la licencia en línea. Conecte este equipo a internet: podrá seguir vendiendo ${plural(restantes, "día más", "días más")}.`, { ...conPlan, diasGraciaRestantes: restantes });
  }
  if (diasParaVencer <= e.avisoVencimientoDias) {
    return hecho("POR_VENCER", `La suscripción vence ${diasParaVencer <= 1 ? "hoy o mañana" : `en ${diasParaVencer} días`} (${fecha(vence)}). Renuévela para no interrumpir las ventas.`, conPlan);
  }
  return hecho("ACTIVA", `Licencia activa hasta el ${fecha(vence)}.`, conPlan);
}

// ============================================================
// src/shared/types/licencia.types.ts — Estado de la licencia (lo comparten el servidor y la interfaz)
// ============================================================

export type TipoEstadoLicencia =
  /** Licenciamiento apagado (desarrollo, pruebas o build sin servidor de licencias configurado): se opera sin restricciones */
  | "NO_REQUERIDA"
  /** Hace falta activar una clave */
  | "SIN_LICENCIA"
  | "ACTIVA"
  /** Quedan pocos días de suscripción (se sigue operando) */
  | "POR_VENCER"
  /** Hace días que no se valida en línea: se sigue operando hasta agotar el período de gracia offline */
  | "GRACIA"
  /** Terminó la suscripción */
  | "VENCIDA"
  /** Se agotó el período de gracia sin poder validar en línea */
  | "BLOQUEADA_OFFLINE"
  | "REVOCADA"
  /** Licencia que no corresponde a este equipo/empresa, no es auténtica o la fecha del equipo es anterior a la última vez que se usó */
  | "INVALIDA";

export interface EstadoLicencia {
  tipo: TipoEstadoLicencia;
  /** ¿Se pueden registrar ventas y abrir turnos? (cerrar turnos, reportes y respaldos NUNCA se bloquean) */
  permiteOperar: boolean;
  /** Texto para el usuario */
  mensaje: string;
  plan: string | null;
  /** Fin de la suscripción (ISO) */
  vence: string | null;
  diasParaVencer: number | null;
  /** Última validación correcta con el servidor (ISO) */
  ultimaValidacion: string | null;
  /** Días que quedan para validar en línea (solo con tipo GRACIA) */
  diasGraciaRestantes: number | null;
  maxDispositivos: number | null;
  /** Clave con casi todo oculto (`ABCD-••••-••••-WXYZ`) */
  claveEnmascarada: string | null;
  /** Identificador de este equipo */
  dispositivoId: string | null;
}

export interface DispositivoLicencia {
  id: string;
  nombre: string;
  plataforma: string;
  /** Última vez que validó (ISO) */
  ultimoUso: string | null;
  /** Es este equipo */
  esEste: boolean;
}

export interface DispositivosLicencia {
  maximo: number;
  dispositivos: DispositivoLicencia[];
}

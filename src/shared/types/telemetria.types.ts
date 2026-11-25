// ============================================================
// src/shared/types/telemetria.types.ts — Telemetría opcional de errores (contrato entre servidor e interfaz)
// ============================================================

export type OrigenError = "interfaz" | "servidor";

/**
 * Lo ÚNICO que sale del equipo si el negocio da su consentimiento: qué versión, en qué sistema y qué error técnico ocurrió. Nunca
 * incluye ventas, clientes, productos, usuarios, claves, rutas personales, direcciones ni números de identificación (se eliminan antes
 * de guardarlo; ver telemetria.util.ts).
 */
export interface ReporteError {
  id: string;
  fecha: string;
  version: string;
  plataforma: string;
  origen: OrigenError;
  /** Vista de la aplicación donde ocurrió (solo para errores de la interfaz) */
  vista: string | null;
  mensaje: string;
  pila: string | null;
}

export interface LoteTelemetria {
  /** Identificador aleatorio de esta instalación (no se deriva de la empresa ni del equipo) */
  instalacion: string;
  reportes: ReporteError[];
}

export interface EstadoTelemetria {
  /** Desactivada hasta que el administrador la active expresamente */
  consentimiento: boolean;
  desde: string | null;
  instalacion: string;
  pendientes: number;
  /** ¿Hay un servidor de destino configurado? Sin él los reportes solo se acumulan para revisarlos */
  destinoConfigurado: boolean;
  ultimoEnvio: string | null;
}

// ============================================================
// src/shared/types/actualizacion.types.ts — Estado de la auto-actualización (lo comparten Electron y la interfaz)
// ============================================================

export type EstadoActualizacion =
  /** No se buscan actualizaciones (modo desarrollo o desactivadas por configuración) */
  | { tipo: "desactivado"; motivo: string }
  | { tipo: "inactivo" }
  | { tipo: "buscando" }
  /** La última búsqueda no encontró nada nuevo; `revisado` es la hora ISO */
  | { tipo: "al-dia"; revisado: string }
  | { tipo: "descargando"; version: string; porcentaje: number }
  /**
   * Descargada y lista: se instala al cerrar la aplicación o con «Reiniciar e instalar». `respaldo` es la copia de la base de
   * datos tomada para la instalación (null si no hay base local); si el respaldo falló `aviso` lo explica y NO se instalará sola.
   */
  | { tipo: "lista"; version: string; respaldo: string | null; aviso: string | null }
  | { tipo: "error"; mensaje: string };

export type MotivoRechazoInstalacion = "ocupado" | "no-lista" | "respaldo";

export type ResultadoInstalacion = { ok: true } | { ok: false; motivo: MotivoRechazoInstalacion; mensaje: string };

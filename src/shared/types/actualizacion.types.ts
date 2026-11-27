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
  | { tipo: "lista"; version: string; respaldo: string | null; aviso: string | null };
// No existe un estado «error»: un fallo al comprobar (404 si aún no hay releases, sin red, SRI de GitHub caído…) es silencioso para
// el cajero; solo queda en el registro y se reintenta en la siguiente búsqueda.

export type MotivoRechazoInstalacion = "ocupado" | "no-lista" | "respaldo";

export type ResultadoInstalacion = { ok: true } | { ok: false; motivo: MotivoRechazoInstalacion; mensaje: string };

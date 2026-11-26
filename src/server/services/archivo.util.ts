// ============================================================
// src/server/services/archivo.util.ts — Escritura de archivos: renombrado atómico tolerante al bloqueo transitorio de Windows
//
// El patrón «escribir `.tmp` y renombrar» deja el archivo final siempre completo (un corte de luz no lo deja a medias). En Windows, el
// antivirus o el indexador pueden retener un instante el archivo recién escrito y `rename` falla con EPERM/EBUSY/EACCES aunque nada
// esté mal: reintentar unas veces con una espera corta lo resuelve. Cualquier otro error, o un bloqueo que no cede, se propaga.
// ============================================================
import { renameSync } from "fs";

const CODIGOS_TRANSITORIOS = new Set(["EPERM", "EBUSY", "EACCES"]);

export interface OpcionesRenombrado {
  /** Intentos en total (default 6) */
  intentos?: number;
  /** Espera inicial en ms; crece de forma lineal con cada intento (default 25) */
  esperaMs?: number;
  /** Sustitutos para pruebas */
  renombrar?: (origen: string, destino: string) => void;
  esperar?: (ms: number) => void;
}

/** Pausa síncrona sin ocupar la CPU (el resto del código de escritura es síncrono para ser atómico respecto al proceso). */
function pausaSincrona(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function renombrarConReintento(origen: string, destino: string, o: OpcionesRenombrado = {}): void {
  const intentos = o.intentos ?? 6;
  const renombrar = o.renombrar ?? renameSync;
  const esperar = o.esperar ?? pausaSincrona;
  for (let intento = 1; ; intento++) {
    try {
      renombrar(origen, destino);
      return;
    } catch (e) {
      const codigo = (e as NodeJS.ErrnoException).code;
      if (codigo === undefined || !CODIGOS_TRANSITORIOS.has(codigo) || intento >= intentos) throw e;
      esperar((o.esperaMs ?? 25) * intento);
    }
  }
}

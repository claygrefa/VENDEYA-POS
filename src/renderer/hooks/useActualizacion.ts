// ============================================================
// src/renderer/hooks/useActualizacion.ts — Estado de la auto-actualización (puente con Electron) e indicador de venta en curso
// Fuera de Electron (navegador, pruebas, otras cajas sin puente) no hay actualizaciones: `disponible` es false.
// ============================================================
import { useCallback, useEffect, useState } from "react";
import type { EstadoActualizacion, ResultadoInstalacion } from "../../shared/types/actualizacion.types";

export interface ActualizacionVista {
  /** Hay puente con Electron */
  disponible: boolean;
  estado: EstadoActualizacion | null;
  buscar: () => Promise<void>;
  /** Devuelve el motivo si no se pudo instalar, o null si se está reiniciando */
  instalar: () => Promise<string | null>;
}

const puenteDe = (): Window["vendeya"] | undefined => (typeof window === "undefined" ? undefined : (window as Partial<Window>).vendeya);

/**
 * `ocupado`: hay una venta en curso (carrito con líneas o cobro abierto); mientras sea true no se reinicia para instalar.
 * Quien solo quiere mostrar el estado (Ajustes) no pasa nada y no toca ese indicador.
 */
export function useActualizacion(ocupado: boolean | null = null): ActualizacionVista {
  const puente = puenteDe();
  const [estado, setEstado] = useState<EstadoActualizacion | null>(null);

  useEffect(() => {
    if (puente === undefined) return;
    let vivo = true;
    puente
      .invoke<EstadoActualizacion>("updater:get-status")
      .then((e) => vivo && setEstado(e))
      .catch(() => undefined);
    const quitar = puente.on("updater:status", (e) => setEstado(e as EstadoActualizacion));
    return () => {
      vivo = false;
      quitar();
    };
  }, [puente]);

  useEffect(() => {
    if (puente === undefined || ocupado === null) return;
    void puente.invoke("updater:set-busy", ocupado).catch(() => undefined);
  }, [puente, ocupado]);

  // Al salir de la aplicación autenticada ya no hay venta en curso
  const informa = ocupado !== null;
  useEffect(() => {
    if (puente === undefined || !informa) return;
    return () => void puente.invoke("updater:set-busy", false).catch(() => undefined);
  }, [puente, informa]);

  const buscar = useCallback(async (): Promise<void> => {
    if (puente === undefined) return;
    try {
      setEstado(await puente.invoke<EstadoActualizacion>("updater:check"));
    } catch {
      /* el estado real llega por updater:status */
    }
  }, [puente]);

  const instalar = useCallback(async (): Promise<string | null> => {
    if (puente === undefined) return "La actualización solo está disponible en la aplicación instalada";
    try {
      const r = await puente.invoke<ResultadoInstalacion>("updater:install");
      return r.ok ? null : r.mensaje;
    } catch (e) {
      return e instanceof Error ? e.message : "No se pudo reiniciar para instalar";
    }
  }, [puente]);

  return { disponible: puente !== undefined, estado, buscar, instalar };
}

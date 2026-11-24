// ============================================================
// src/renderer/hooks/useEscaneo.ts — Distingue el lector de códigos de la digitación del cajero
// ============================================================
import { useCallback, useEffect, useRef } from "react";
import { DetectorEscaneo, type OpcionesDetector, type ResultadoTecla } from "../../server/services/hardware/detectorEscaneo.util";

export interface OpcionesEscaneo extends OpcionesDetector {
  /** Llegó un código por el lector (ráfaga + Enter) */
  alEscanear: (codigo: string) => void;
  /** El cajero escribió algo y apretó Enter */
  alDigitar: (texto: string) => void;
  /** Reloj en ms (pruebas) */
  ahora?: () => number;
}

export interface ManejadorEscaneo {
  /** Pasar cada `keydown` del campo de búsqueda */
  procesarTecla: (key: string) => ResultadoTecla;
}

/**
 * Devuelve un procesador de teclas para el campo de búsqueda y, además, escucha la ventana: si el lector «escribe» con el
 * foco en ninguna parte (la pantalla no tiene un campo enfocado) el escaneo igual se atiende.
 */
export function useEscaneo(o: OpcionesEscaneo): ManejadorEscaneo {
  const detector = useRef<DetectorEscaneo>(new DetectorEscaneo(o));
  const ultimas = useRef(o);
  ultimas.current = o;

  const procesarTecla = useCallback((key: string): ResultadoTecla => {
    const ahora = ultimas.current.ahora?.() ?? performance.now();
    const r = detector.current.teclaPresionada(key, ahora);
    if (r.tipo === "ESCANEO") ultimas.current.alEscanear(r.codigo);
    else if (r.tipo === "MANUAL") ultimas.current.alDigitar(r.texto);
    return r;
  }, []);

  useEffect(() => {
    const manejar = (e: KeyboardEvent): void => {
      const destino = e.target;
      // Con foco en un campo, es ese campo quien reporta sus teclas (evita contarlas dos veces)
      if (destino instanceof HTMLInputElement || destino instanceof HTMLTextAreaElement || destino instanceof HTMLSelectElement) return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      procesarTecla(e.key);
    };
    window.addEventListener("keydown", manejar);
    return () => window.removeEventListener("keydown", manejar);
  }, [procesarTecla]);

  return { procesarTecla };
}

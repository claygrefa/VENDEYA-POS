// ============================================================
// src/renderer/hooks/useAtajos.ts — Atajos de teclado globales del POS (F2, F4, F8, ESC…)
// ============================================================
import { useEffect, useRef } from "react";

export type MapaAtajos = Partial<Record<"F2" | "F4" | "F8" | "Escape" | "F9" | "F10", () => void>>;

/**
 * Registra los atajos en la ventana. Las teclas de función se atienden aunque el foco esté en un campo de texto (el cajero
 * escribe en la búsqueda y aprieta F8 para cobrar); el navegador no debe ejecutar su acción (F5 recarga, F1 ayuda…).
 */
export function useAtajos(mapa: MapaAtajos, activo = true): void {
  const ultimo = useRef(mapa);
  ultimo.current = mapa;

  useEffect(() => {
    if (!activo) return;
    const manejar = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      const accion = (ultimo.current as Record<string, (() => void) | undefined>)[e.key];
      if (accion === undefined) return;
      e.preventDefault();
      accion();
    };
    window.addEventListener("keydown", manejar);
    return () => window.removeEventListener("keydown", manejar);
  }, [activo]);
}

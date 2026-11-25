// ============================================================
// src/renderer/hooks/useDiferido.ts — Valor que se actualiza solo cuando el usuario deja de teclear
// Con un catálogo de decenas de miles de productos, buscar en cada tecla multiplica las consultas sin que el cajero lo note.
// ============================================================
import { useEffect, useState } from "react";

export function useDiferido<T>(valor: T, retrasoMs: number): T {
  const [diferido, setDiferido] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setDiferido(valor), retrasoMs);
    return () => clearTimeout(t);
  }, [valor, retrasoMs]);
  return diferido;
}

/** Pausa tras la última tecla antes de consultar al servidor (corta para que la lista siga sintiéndose inmediata) */
export const RETRASO_BUSQUEDA_MS = 150;

// ============================================================
// src/renderer/components/Modal.tsx — Diálogo modal accesible (foco inicial, Escape lo atiende el POS)
// ============================================================
import React, { useEffect, useRef } from "react";

interface Props {
  titulo: string;
  /** Texto de ayuda con los atajos de teclado del diálogo */
  ayuda?: string;
  ancho?: "sm" | "md" | "lg";
  children: React.ReactNode;
}

const ANCHOS = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-3xl" } as const;

export function Modal({ titulo, ayuda, ancho = "md", children }: Props): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const previo = useRef<Element | null>(null);

  useEffect(() => {
    previo.current = document.activeElement;
    // Foco al primer campo del diálogo; al cerrarlo, el foco vuelve a donde estaba (la búsqueda)
    const primero = ref.current?.querySelector<HTMLElement>("[data-autofocus], input, select, button");
    primero?.focus();
    return () => {
      if (previo.current instanceof HTMLElement) previo.current.focus();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
      <div ref={ref} role="dialog" aria-modal="true" aria-label={titulo} className={`w-full ${ANCHOS[ancho]} rounded-2xl border border-slate-700 bg-slate-800 p-5 shadow-2xl`}>
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <h2 className="text-lg font-semibold text-ink">{titulo}</h2>
          {ayuda !== undefined ? <span className="text-xs text-slate-400">{ayuda}</span> : null}
        </div>
        {children}
      </div>
    </div>
  );
}

/** Mensaje de error o aviso dentro de un diálogo o pantalla. */
export function Aviso({ tipo, children }: { tipo: "error" | "info" | "exito"; children: React.ReactNode }): React.JSX.Element {
  const colores = { error: "border-red-500/60 bg-red-950/60 text-red-200", info: "border-amber-500/60 bg-amber-950/50 text-amber-200", exito: "border-emerald-500/60 bg-emerald-950/50 text-emerald-200" } as const;
  return (
    <div role={tipo === "error" ? "alert" : "status"} className={`rounded-lg border px-3 py-2 text-sm ${colores[tipo]}`}>
      {children}
    </div>
  );
}

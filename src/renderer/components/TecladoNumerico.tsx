// ============================================================
// src/renderer/components/TecladoNumerico.tsx — Teclado numérico en pantalla (modo táctil)
// ============================================================
import React from "react";

interface Props {
  valor: string;
  onCambio: (nuevo: string) => void;
  /** Permite el punto decimal (default true) */
  decimales?: boolean;
}

const TECLAS = ["7", "8", "9", "4", "5", "6", "1", "2", "3", ".", "0", "⌫"] as const;

/** Edita un texto numérico (`"12.5"`) con botones grandes. */
export function TecladoNumerico({ valor, onCambio, decimales = true }: Props): React.JSX.Element {
  const pulsar = (tecla: (typeof TECLAS)[number]): void => {
    if (tecla === "⌫") onCambio(valor.slice(0, -1));
    else if (tecla === ".") {
      if (decimales && !valor.includes(".")) onCambio(valor === "" ? "0." : `${valor}.`);
    } else onCambio(valor === "0" ? tecla : `${valor}${tecla}`);
  };
  return (
    <div role="group" aria-label="Teclado numérico" className="mt-3 grid grid-cols-3 gap-2">
      {TECLAS.map((t) => (
        <button
          key={t}
          type="button"
          tabIndex={-1}
          aria-label={t === "⌫" ? "Borrar" : t === "." ? "Punto decimal" : t}
          onClick={() => pulsar(t)}
          className="h-14 rounded-xl bg-slate-700 text-xl font-semibold text-ink active:bg-slate-600"
        >
          {t}
        </button>
      ))}
    </div>
  );
}

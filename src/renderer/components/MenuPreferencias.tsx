// ============================================================
// src/renderer/components/MenuPreferencias.tsx — Menú de la cabecera: tema, tamaño del texto, modo táctil y cambio de contraseña
// Reúne en un solo lugar lo que antes eran botones sueltos. Todo es de este equipo: no afecta a ningún dato del negocio.
// ============================================================
import { KeyRound, Monitor, Moon, SlidersHorizontal, Sun, Type, Hand, type LucideIcon } from "lucide-react";
import React, { useEffect, useId, useRef, useState } from "react";
import { usePreferencias, type TamanoTexto, type Tema } from "../store/preferencias.store";
import { useSesion } from "../store/sesion.store";

const TEMAS: ReadonlyArray<{ id: Tema; titulo: string; icono: LucideIcon }> = [
  { id: "claro", titulo: "Claro", icono: Sun },
  { id: "oscuro", titulo: "Oscuro", icono: Moon },
  { id: "sistema", titulo: "Sistema", icono: Monitor },
];

const TEXTOS: ReadonlyArray<{ id: TamanoTexto; etiqueta: string; titulo: string }> = [
  { id: "normal", etiqueta: "A", titulo: "Texto normal" },
  { id: "grande", etiqueta: "A+", titulo: "Texto grande" },
  { id: "extra", etiqueta: "A++", titulo: "Texto extra grande" },
];

function Segmentos<T extends string>({ etiqueta, opciones, valor, onCambio }: {
  etiqueta: string;
  opciones: ReadonlyArray<{ id: T; titulo: string; contenido: React.ReactNode }>;
  valor: T;
  onCambio: (id: T) => void;
}): React.JSX.Element {
  return (
    <div role="radiogroup" aria-label={etiqueta} className="grid grid-flow-col gap-1 rounded-lg bg-slate-900 p-1">
      {opciones.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={valor === o.id} aria-label={o.titulo} title={o.titulo} onClick={() => onCambio(o.id)}
          className={`flex min-h-9 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400 ${valor === o.id ? "bg-brand-600 text-white shadow" : "text-slate-300 hover:bg-slate-700"}`}>
          {o.contenido}
        </button>
      ))}
    </div>
  );
}

export function MenuPreferencias({ onCambiarPassword }: { onCambiarPassword: () => void }): React.JSX.Element {
  const [abierto, setAbierto] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  const idPanel = useId();
  const tema = usePreferencias((s) => s.tema);
  const fijarTema = usePreferencias((s) => s.fijarTema);
  const tamano = usePreferencias((s) => s.tamanoTexto);
  const fijarTamano = usePreferencias((s) => s.fijarTamanoTexto);
  const tactil = useSesion((s) => s.modoTactil);
  const alternarTactil = useSesion((s) => s.alternarTactil);

  // Se cierra con Escape o al pulsar fuera
  useEffect(() => {
    if (!abierto) return;
    const alTecla = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setAbierto(false);
    };
    const alPulsar = (e: MouseEvent): void => {
      if (raiz.current !== null && !raiz.current.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener("keydown", alTecla);
    document.addEventListener("mousedown", alPulsar);
    return () => {
      document.removeEventListener("keydown", alTecla);
      document.removeEventListener("mousedown", alPulsar);
    };
  }, [abierto]);

  const fila = "flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm text-slate-200 hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400";

  return (
    <div ref={raiz} className="relative">
      <button type="button" aria-haspopup="true" aria-expanded={abierto} aria-controls={abierto ? idPanel : undefined} onClick={() => setAbierto((a) => !a)}
        className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400">
        <SlidersHorizontal className="h-4 w-4" aria-hidden="true" /> Preferencias
      </button>
      {abierto ? (
        <div id={idPanel} role="group" aria-label="Preferencias" className="absolute right-0 top-full z-40 mt-2 w-72 space-y-3 rounded-xl border border-slate-600 bg-slate-800 p-3 shadow-2xl">
          <div className="space-y-1.5">
            <p className="px-1 text-xs font-semibold uppercase tracking-wider text-slate-400">Tema</p>
            <Segmentos etiqueta="Tema" valor={tema} onCambio={fijarTema}
              opciones={TEMAS.map(({ id, titulo, icono: Icono }) => ({ id, titulo, contenido: <><Icono className="h-4 w-4" aria-hidden="true" />{titulo}</> }))} />
          </div>
          <div className="space-y-1.5">
            <p className="flex items-center gap-1.5 px-1 text-xs font-semibold uppercase tracking-wider text-slate-400"><Type className="h-3.5 w-3.5" aria-hidden="true" /> Tamaño del texto</p>
            <Segmentos etiqueta="Tamaño del texto" valor={tamano} onCambio={fijarTamano}
              opciones={TEXTOS.map(({ id, etiqueta, titulo }) => ({ id, titulo, contenido: <span aria-hidden="true">{etiqueta}</span> }))} />
          </div>
          <div className="border-t border-slate-700 pt-2">
            <button type="button" aria-pressed={tactil} onClick={alternarTactil} className={fila}>
              <Hand className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
              <span className="flex-1">Modo táctil: {tactil ? "sí" : "no"}</span>
            </button>
            <button type="button" onClick={() => { setAbierto(false); onCambiarPassword(); }} className={fila}>
              <KeyRound className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
              <span className="flex-1">Mi contraseña</span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

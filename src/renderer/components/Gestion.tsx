// ============================================================
// src/renderer/components/Gestion.tsx — Piezas comunes de las vistas de gestión: tabla, pestañas, paginador y campos
// ============================================================
import React from "react";
import { ApiError } from "../services/api";

export interface Columna<T> {
  titulo: string;
  celda: (fila: T) => React.ReactNode;
  derecha?: boolean;
}

interface TablaProps<T> {
  etiqueta: string;
  columnas: Array<Columna<T>>;
  filas: T[] | undefined;
  clave: (fila: T) => string;
  cargando?: boolean;
  vacio?: string;
}

export function Tabla<T>({ etiqueta, columnas, filas, clave, cargando = false, vacio = "Sin registros" }: TablaProps<T>): React.JSX.Element {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-700" aria-busy={cargando}>
      <table aria-label={etiqueta} className="w-full text-left text-sm">
        <thead className="bg-slate-800 text-xs uppercase tracking-wider text-slate-400">
          <tr>
            {columnas.map((c) => (
              <th key={c.titulo} scope="col" className={`px-3 py-2 font-medium ${c.derecha === true ? "text-right" : ""}`}>
                {c.titulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {(filas ?? []).map((f) => (
            <tr key={clave(f)} className="hover:bg-slate-800/60">
              {columnas.map((c) => (
                <td key={c.titulo} className={`px-3 py-2 text-slate-200 ${c.derecha === true ? "text-right tabular-nums" : ""}`}>
                  {c.celda(f)}
                </td>
              ))}
            </tr>
          ))}
          {filas !== undefined && filas.length === 0 ? (
            <tr>
              <td colSpan={columnas.length} className="px-3 py-6 text-center text-slate-500">
                {vacio}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

export function Paginador({ pagina, total, porPagina, onCambio }: { pagina: number; total: number; porPagina: number; onCambio: (p: number) => void }): React.JSX.Element | null {
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  if (paginas <= 1) return null;
  return (
    <nav aria-label="Paginación" className="mt-3 flex items-center justify-end gap-3 text-sm text-slate-300">
      <button type="button" onClick={() => onCambio(pagina - 1)} disabled={pagina <= 1} className="rounded-lg border border-slate-600 px-3 py-1 disabled:opacity-40">
        Anterior
      </button>
      <span>
        Página {pagina} de {paginas}
      </span>
      <button type="button" onClick={() => onCambio(pagina + 1)} disabled={pagina >= paginas} className="rounded-lg border border-slate-600 px-3 py-1 disabled:opacity-40">
        Siguiente
      </button>
    </nav>
  );
}

export function Pestanas<T extends string>({ etiqueta, opciones, activa, onCambio }: { etiqueta: string; opciones: ReadonlyArray<{ id: T; titulo: string }>; activa: T; onCambio: (id: T) => void }): React.JSX.Element {
  return (
    <div role="tablist" aria-label={etiqueta} className="mb-4 flex gap-1 border-b border-slate-700">
      {opciones.map((o) => (
        <button key={o.id} role="tab" type="button" aria-selected={o.id === activa} onClick={() => onCambio(o.id)} className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${o.id === activa ? "border-brand-400 text-white" : "border-transparent text-slate-400 hover:text-slate-200"}`}>
          {o.titulo}
        </button>
      ))}
    </div>
  );
}

interface CampoProps {
  etiqueta: string;
  valor: string;
  onCambio: (v: string) => void;
  tipo?: "text" | "number" | "date" | "email" | "password";
  placeholder?: string;
  deshabilitado?: boolean;
  autofoco?: boolean;
}

export function Campo({ etiqueta, valor, onCambio, tipo = "text", placeholder, deshabilitado = false, autofoco = false }: CampoProps): React.JSX.Element {
  return (
    <label className="block text-sm text-slate-300">
      {etiqueta}
      <input
        aria-label={etiqueta}
        type={tipo}
        value={valor}
        placeholder={placeholder}
        disabled={deshabilitado}
        data-autofocus={autofoco ? true : undefined}
        step={tipo === "number" ? "any" : undefined}
        onChange={(e) => onCambio(e.target.value)}
        className="mt-1 h-10 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 text-white outline-none focus:border-brand-400 disabled:opacity-50"
      />
    </label>
  );
}

export function Seleccion({ etiqueta, valor, onCambio, opciones }: { etiqueta: string; valor: string; onCambio: (v: string) => void; opciones: ReadonlyArray<{ valor: string; titulo: string }> }): React.JSX.Element {
  return (
    <label className="block text-sm text-slate-300">
      {etiqueta}
      <select aria-label={etiqueta} value={valor} onChange={(e) => onCambio(e.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-600 bg-slate-900 px-2 text-white">
        {opciones.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.titulo}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Casilla({ etiqueta, marcada, onCambio }: { etiqueta: string; marcada: boolean; onCambio: (v: boolean) => void }): React.JSX.Element {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-300">
      <input type="checkbox" aria-label={etiqueta} checked={marcada} onChange={(e) => onCambio(e.target.checked)} className="h-4 w-4" />
      {etiqueta}
    </label>
  );
}

export function Boton({ children, onClick, tipo = "button", variante = "normal", deshabilitado = false }: { children: React.ReactNode; onClick?: () => void; tipo?: "button" | "submit"; variante?: "normal" | "primario" | "peligro"; deshabilitado?: boolean }): React.JSX.Element {
  const estilos = { normal: "bg-slate-700 text-white hover:bg-slate-600", primario: "bg-brand-600 text-white hover:bg-brand-500", peligro: "bg-red-700 text-white hover:bg-red-600" } as const;
  return (
    <button type={tipo} onClick={onClick} disabled={deshabilitado} className={`rounded-lg px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40 ${estilos[variante]}`}>
      {children}
    </button>
  );
}

export const mensajeDeError = (e: unknown): string => (e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Ocurrió un error inesperado");

/** Pasa un campo de texto a número; vacío → undefined; inválido → NaN. */
export function aNumero(texto: string): number | undefined {
  const t = texto.trim().replace(",", ".");
  if (t === "") return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : Number.NaN;
}

/** Guarda un archivo descargado en el equipo (CSV, PDF, XML). */
export function guardarArchivo(nombre: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = nombre;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

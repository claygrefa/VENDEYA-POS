// ============================================================
// src/renderer/components/BuscadorProductos.tsx — Búsqueda ultrarrápida y catálogo táctil
// ============================================================
import { forwardRef } from "react";
import { useProductos } from "../hooks/consultas";
import { cantidadTexto, dinero } from "../services/totales";
import type { ProductoPos } from "../services/tipos";

interface Props {
  busqueda: string;
  onBusqueda: (texto: string) => void;
  onTecla: (key: string) => void;
  onElegir: (p: ProductoPos) => void;
  tactil: boolean;
}

export const BuscadorProductos = forwardRef<HTMLInputElement, Props>(function BuscadorProductos({ busqueda, onBusqueda, onTecla, onElegir, tactil }, ref) {
  const { data, isError, error, isFetching } = useProductos(busqueda);

  return (
    <section aria-label="Productos" className="flex min-h-0 flex-1 flex-col gap-3">
      <input
        ref={ref}
        aria-label="Buscar producto"
        placeholder="Buscar por nombre o código, o escanee (F2)"
        value={busqueda}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => onBusqueda(e.target.value)}
        onKeyDown={(e) => onTecla(e.key)}
        className={`w-full rounded-xl border border-slate-600 bg-slate-900 px-4 text-white placeholder-slate-500 outline-none focus:border-brand-400 ${tactil ? "h-16 text-xl" : "h-12 text-base"}`}
      />
      {isError ? (
        <p role="alert" className="text-sm text-red-300">
          {(error as Error).message}
        </p>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto" aria-busy={isFetching}>
        {data !== undefined && data.items.length === 0 ? <p className="p-4 text-center text-slate-400">Sin resultados para «{busqueda}»</p> : null}
        <ul className={`grid gap-2 ${tactil ? "grid-cols-2 xl:grid-cols-3" : "grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"}`}>
          {(data?.items ?? []).map((p) => (
            <li key={p.id}>
              <button
                type="button"
                aria-label={`Agregar ${p.nombre}`}
                onClick={() => onElegir(p)}
                className={`flex w-full flex-col justify-between rounded-xl border border-slate-700 bg-slate-800 p-3 text-left transition hover:border-brand-400 active:bg-slate-700 ${tactil ? "min-h-28" : "min-h-20"}`}
              >
                <span className="line-clamp-2 text-sm font-medium text-white">{p.nombre}</span>
                <span className="mt-2 flex items-end justify-between gap-2">
                  <span className="text-base font-semibold text-brand-300">{dinero(p.precioVenta)}</span>
                  <span className={`text-xs ${p.tipo === "BIEN" && p.stockActual <= 0 ? "text-red-400" : "text-slate-400"}`}>
                    {p.tipo === "BIEN" ? `${cantidadTexto(p.stockActual)} ${p.unidadMedida.codigo}` : "Servicio"}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
});

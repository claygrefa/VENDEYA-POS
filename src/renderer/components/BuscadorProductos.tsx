// ============================================================
// src/renderer/components/BuscadorProductos.tsx — Búsqueda ultrarrápida y catálogo táctil
// ============================================================
import { useQuery } from "@tanstack/react-query";
import { CircleAlert, LayoutGrid, Search, Tag } from "lucide-react";
import { forwardRef } from "react";
import { useProductos } from "../hooks/consultas";
import { useGestion } from "../services/contexto";
import { cantidadTexto, dinero } from "../services/totales";
import type { ProductoPos } from "../services/tipos";

interface Props {
  busqueda: string;
  categoriaId: string | undefined;
  onCategoria: (id: string | undefined) => void;
  onBusqueda: (texto: string) => void;
  onTecla: (key: string) => void;
  onElegir: (p: ProductoPos) => void;
  tactil: boolean;
}

export const BuscadorProductos = forwardRef<HTMLInputElement, Props>(function BuscadorProductos({ busqueda, categoriaId, onCategoria, onBusqueda, onTecla, onElegir, tactil }, ref) {
  const gestion = useGestion();
  const catalogos = useQuery({ queryKey: ["catalogos"], queryFn: () => gestion.catalogos(), staleTime: 300_000 });
  const { data, isError, error, isFetching } = useProductos(busqueda, categoriaId);
  const categorias = catalogos.data?.categorias ?? [];
  const nombres = new Map(categorias.map(({ id, nombre }) => [id, nombre]));
  const botonFiltro = (activo: boolean): string => `inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400 ${tactil ? "min-h-11" : "min-h-9"} ${activo ? "border-brand-500 bg-brand-600/20 text-brand-200" : "border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-500 hover:text-white"}`;

  return (
    <section aria-label="Productos" className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
        <input
          ref={ref}
          aria-label="Buscar producto"
          placeholder="Buscar por nombre o código, o escanee (F2)"
          value={busqueda}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => onBusqueda(e.target.value)}
          onKeyDown={(e) => onTecla(e.key)}
          className={`w-full rounded-xl border border-slate-600 bg-slate-800/60 pl-11 pr-4 text-white placeholder-slate-400 outline-none focus:border-brand-400 ${tactil ? "h-16 text-xl" : "h-12 text-base"}`}
        />
      </div>
      <div role="group" aria-label="Filtrar por categoría" className="flex shrink-0 gap-2 overflow-x-auto p-1">
        <button type="button" aria-pressed={categoriaId === undefined} onClick={() => onCategoria(undefined)} className={botonFiltro(categoriaId === undefined)}>
          <LayoutGrid className="h-4 w-4" aria-hidden="true" /> Todos
        </button>
        {categorias.map(({ id, nombre }) => (
          <button type="button" key={id} aria-pressed={categoriaId === id} onClick={() => onCategoria(id)} className={botonFiltro(categoriaId === id)}>{nombre}</button>
        ))}
      </div>
      {isError ? (
        <p role="alert" className="text-sm text-red-300">
          {(error as Error).message}
        </p>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto" aria-busy={isFetching}>
        {data !== undefined && data.items.length === 0 ? <p className="p-4 text-center text-slate-400">{busqueda.trim() === "" ? "Sin productos en esta selección" : `Sin resultados para «${busqueda}»`}</p> : null}
        <ul className={`grid gap-3 p-1 ${tactil ? "grid-cols-2 2xl:grid-cols-3" : "grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"}`}>
          {(data?.items ?? []).map((p) => (
            <TarjetaProducto key={p.id} producto={p} categoria={nombres.get(p.categoriaId)} tactil={tactil} onElegir={onElegir} />
          ))}
        </ul>
      </div>
    </section>
  );
});

function TarjetaProducto({ producto: p, categoria, tactil, onElegir }: { producto: ProductoPos; categoria: string | undefined; tactil: boolean; onElegir: Props["onElegir"] }) {
  const agotado = p.tipo === "BIEN" && p.stockActual <= 0;
  const bajo = p.tipo === "BIEN" && p.stockActual > 0 && p.stockActual <= p.stockMinimo;
  const iniciales = categoria?.trim().split(/\s+/).slice(0, 2).map((palabra) => palabra[0]).join("").toUpperCase();
  const stock = p.tipo === "BIEN" ? `${cantidadTexto(p.stockActual)} ${p.unidadMedida.codigo}` : "Servicio";

  return (
    <li>
      <button
        type="button"
        aria-label={`Agregar ${p.nombre}`}
        aria-describedby={`detalle-producto-${p.id}`}
        onClick={() => onElegir(p)}
        className={`flex h-full w-full flex-col gap-2 rounded-xl border border-slate-700 bg-slate-800 p-3 text-left transition hover:border-brand-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400 active:bg-slate-700 ${tactil ? "min-h-36" : "min-h-32"}`}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-500/15 text-xs font-bold text-brand-200">
            {iniciales || <Tag className="h-4 w-4" />}
          </span>
          {categoria && <span className="truncate text-xs text-slate-300">{categoria}</span>}
        </span>
        <span className="line-clamp-2 text-sm font-medium text-white">{p.nombre}</span>
        <span className="truncate text-xs tabular-nums text-slate-500">{p.codigoBarras ?? p.codigo}</span>
        <span id={`detalle-producto-${p.id}`} className="mt-auto flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
          <span className="text-xl font-bold tabular-nums text-brand-200">{dinero(p.precioVenta)}</span>
          <span className={`inline-flex items-center gap-1 text-xs ${agotado ? "text-red-300" : bajo ? "text-amber-300" : "text-slate-400"}`}>
            {(agotado || bajo) && <CircleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
            {agotado ? "Sin stock" : bajo ? `Stock bajo · ${stock}` : stock}
          </span>
        </span>
      </button>
    </li>
  );
}

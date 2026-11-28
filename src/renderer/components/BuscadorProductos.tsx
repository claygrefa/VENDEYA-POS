// ============================================================
// src/renderer/components/BuscadorProductos.tsx — Búsqueda ultrarrápida y catálogo (cuadrícula o lista, también táctil)
// ============================================================
import { useQuery } from "@tanstack/react-query";
import { CircleAlert, LayoutGrid, List, Search } from "lucide-react";
import { forwardRef } from "react";
import { useProductos } from "../hooks/consultas";
import { iconoDeCategoria } from "../services/categoriaIconos";
import { useGestion } from "../services/contexto";
import { cantidadTexto, dinero } from "../services/totales";
import type { ProductoPos } from "../services/tipos";
import { usePreferencias, type VistaProductos } from "../store/preferencias.store";

interface Props {
  busqueda: string;
  categoriaId: string | undefined;
  onCategoria: (id: string | undefined) => void;
  onBusqueda: (texto: string) => void;
  onTecla: (key: string) => void;
  onElegir: (p: ProductoPos) => void;
  tactil: boolean;
}

type EstadoStock = "agotado" | "bajo" | "normal";

function estadoDeStock(p: ProductoPos): EstadoStock {
  if (p.tipo !== "BIEN") return "normal";
  if (p.stockActual <= 0) return "agotado";
  return p.stockActual <= p.stockMinimo ? "bajo" : "normal";
}

const textoStock = (p: ProductoPos): string => (p.tipo === "BIEN" ? `${cantidadTexto(p.stockActual)} ${p.unidadMedida.codigo}` : "Servicio");

/** Indicador de disponibilidad: agotado (rojo), stock bajo (ámbar) o la cantidad disponible */
function Disponibilidad({ producto: p }: { producto: ProductoPos }) {
  const estado = estadoDeStock(p);
  if (estado === "normal") return <span className="text-xs tabular-nums text-slate-400">{textoStock(p)}</span>;
  const agotado = estado === "agotado";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${agotado ? "bg-red-500/15 text-red-300" : "bg-amber-500/15 text-amber-300"}`}>
      <CircleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {agotado ? "Sin stock" : `Stock bajo · ${textoStock(p)}`}
    </span>
  );
}

export const BuscadorProductos = forwardRef<HTMLInputElement, Props>(function BuscadorProductos({ busqueda, categoriaId, onCategoria, onBusqueda, onTecla, onElegir, tactil }, ref) {
  const gestion = useGestion();
  const vista = usePreferencias((s) => s.vistaProductos);
  const fijarVista = usePreferencias((s) => s.fijarVistaProductos);
  const catalogos = useQuery({ queryKey: ["catalogos"], queryFn: () => gestion.catalogos(), staleTime: 300_000 });
  const { data, isError, error, isFetching } = useProductos(busqueda, categoriaId);
  const categorias = catalogos.data?.categorias ?? [];
  const nombres = new Map(categorias.map(({ id, nombre }) => [id, nombre]));
  const botonFiltro = (activo: boolean): string => `inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400 ${tactil ? "min-h-11" : "min-h-9"} ${activo ? "border-brand-500 bg-brand-600/20 text-brand-200" : "border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-500 hover:text-ink"}`;
  const botonVista = (v: VistaProductos): string => `flex items-center justify-center rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400 ${tactil ? "h-12 w-12" : "h-9 w-9"} ${vista === v ? "bg-brand-600 text-white" : "text-slate-300 hover:bg-slate-700"}`;
  const items = data?.items ?? [];

  return (
    <section aria-label="Productos" className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input
            ref={ref}
            aria-label="Buscar producto"
            placeholder="Buscar por nombre, código o código de barras (F2)"
            value={busqueda}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => onBusqueda(e.target.value)}
            onKeyDown={(e) => onTecla(e.key)}
            className={`w-full rounded-xl border border-slate-600 bg-slate-800/60 pl-11 pr-4 text-ink placeholder-slate-400 outline-none focus:border-brand-400 ${tactil ? "h-16 text-xl" : "h-12 text-base"}`}
          />
        </div>
        <div role="group" aria-label="Vista de productos" className="flex shrink-0 gap-1 rounded-xl border border-slate-700 bg-slate-800 p-1">
          <button type="button" aria-label="Vista en cuadrícula" title="Vista en cuadrícula" aria-pressed={vista === "cuadricula"} onClick={() => fijarVista("cuadricula")} className={botonVista("cuadricula")}>
            <LayoutGrid className="h-5 w-5" aria-hidden="true" />
          </button>
          <button type="button" aria-label="Vista en lista" title="Vista en lista" aria-pressed={vista === "lista"} onClick={() => fijarVista("lista")} className={botonVista("lista")}>
            <List className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      </div>
      <div role="group" aria-label="Filtrar por categoría" className="flex shrink-0 gap-2 overflow-x-auto p-1">
        <button type="button" aria-pressed={categoriaId === undefined} onClick={() => onCategoria(undefined)} className={botonFiltro(categoriaId === undefined)}>
          <LayoutGrid className="h-4 w-4" aria-hidden="true" /> Todos
        </button>
        {categorias.map(({ id, nombre }) => {
          const Icono = iconoDeCategoria(nombre);
          return (
            <button type="button" key={id} aria-pressed={categoriaId === id} onClick={() => onCategoria(id)} className={botonFiltro(categoriaId === id)}>
              <Icono className="h-4 w-4" aria-hidden="true" /> {nombre}
            </button>
          );
        })}
      </div>
      {isError ? (
        <p role="alert" className="text-sm text-red-300">
          {(error as Error).message}
        </p>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto" aria-busy={isFetching}>
        {data !== undefined && items.length === 0 ? <p className="p-4 text-center text-slate-400">{busqueda.trim() === "" ? "Sin productos en esta selección" : `Sin resultados para «${busqueda}»`}</p> : null}
        <ul className={vista === "lista" ? "flex flex-col gap-2 p-1" : `grid gap-3 p-1 ${tactil ? "grid-cols-2 2xl:grid-cols-3" : "grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"}`}>
          {items.map((p) => (vista === "lista"
            ? <FilaProducto key={p.id} producto={p} categoria={nombres.get(p.categoriaId)} tactil={tactil} onElegir={onElegir} />
            : <TarjetaProducto key={p.id} producto={p} categoria={nombres.get(p.categoriaId)} tactil={tactil} onElegir={onElegir} />))}
        </ul>
      </div>
    </section>
  );
});

interface ItemProps {
  producto: ProductoPos;
  categoria: string | undefined;
  tactil: boolean;
  onElegir: Props["onElegir"];
}

const claseBase = "w-full rounded-xl border bg-slate-800 text-left transition hover:border-brand-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400 active:bg-slate-700";

function bordeSegunStock(estado: EstadoStock): string {
  return estado === "agotado" ? "border-red-500/40 opacity-80" : estado === "bajo" ? "border-amber-500/40" : "border-slate-700";
}

function TarjetaProducto({ producto: p, categoria, tactil, onElegir }: ItemProps) {
  const estado = estadoDeStock(p);
  const Icono = iconoDeCategoria(categoria);
  return (
    <li>
      <button type="button" aria-label={`Agregar ${p.nombre}`} aria-describedby={`detalle-producto-${p.id}`} onClick={() => onElegir(p)}
        className={`${claseBase} ${bordeSegunStock(estado)} flex h-full flex-col gap-2 p-3 ${tactil ? "min-h-36" : "min-h-32"}`}>
        <span className="flex min-w-0 items-center gap-2">
          <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-500/15 text-brand-300">
            <Icono className="h-5 w-5" />
          </span>
          {categoria && <span className="truncate text-xs text-slate-300">{categoria}</span>}
        </span>
        <span className="line-clamp-2 text-sm font-medium text-ink">{p.nombre}</span>
        <span className="truncate text-xs tabular-nums text-slate-500">{p.codigoBarras ?? p.codigo}</span>
        <span id={`detalle-producto-${p.id}`} className="mt-auto flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
          <span className="text-xl font-bold tabular-nums text-brand-200">{dinero(p.precioVenta)}</span>
          <Disponibilidad producto={p} />
        </span>
      </button>
    </li>
  );
}

function FilaProducto({ producto: p, categoria, tactil, onElegir }: ItemProps) {
  const estado = estadoDeStock(p);
  const Icono = iconoDeCategoria(categoria);
  return (
    <li>
      <button type="button" aria-label={`Agregar ${p.nombre}`} aria-describedby={`detalle-producto-${p.id}`} onClick={() => onElegir(p)}
        className={`${claseBase} ${bordeSegunStock(estado)} flex items-center gap-3 px-3 ${tactil ? "min-h-16" : "min-h-14"}`}>
        <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-500/15 text-brand-300">
          <Icono className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink">{p.nombre}</span>
          <span className="block truncate text-xs tabular-nums text-slate-500">{p.codigoBarras ?? p.codigo}{categoria ? ` · ${categoria}` : ""}</span>
        </span>
        <span id={`detalle-producto-${p.id}`} className="flex shrink-0 items-center gap-4">
          <Disponibilidad producto={p} />
          <span className="min-w-[4.5rem] text-right text-lg font-bold tabular-nums text-brand-200">{dinero(p.precioVenta)}</span>
        </span>
      </button>
    </li>
  );
}

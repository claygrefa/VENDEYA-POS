// ============================================================
// src/renderer/components/CarritoPanel.tsx — Líneas de la venta y totales
// ============================================================
import { Minus, Plus, ShoppingCart, Trash2, UserRound } from "lucide-react";
import React from "react";
import { cantidadTexto, dinero, type CalculoCarrito, type LineaCarrito } from "../services/totales";

interface Props {
  lineas: LineaCarrito[];
  calculo: CalculoCarrito;
  clienteNombre: string;
  tactil: boolean;
  onMas: (l: LineaCarrito) => void;
  onMenos: (l: LineaCarrito) => void;
  onQuitar: (l: LineaCarrito) => void;
  onEditar: (l: LineaCarrito) => void;
  /** Abre la búsqueda/cambio de cliente (F4) */
  onCliente: () => void;
}

export function CarritoPanel({ lineas, calculo, clienteNombre, tactil, onMas, onMenos, onQuitar, onEditar, onCliente }: Props): React.JSX.Element {
  const boton = `flex items-center justify-center rounded-md text-ink hover:bg-slate-700 active:bg-slate-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400 ${tactil ? "h-12 w-12" : "h-8 w-8"}`;
  const general = calculo.ivaPorTarifa.find((t) => t.porcentaje === 15);
  const tarifaCero = calculo.ivaPorTarifa.find((t) => t.porcentaje === 0);
  const otrasTarifas = calculo.ivaPorTarifa.filter((t) => t.porcentaje !== 0 && t.porcentaje !== 15);
  return (
    <section aria-label="Carrito" className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 flex items-center gap-3 rounded-xl border border-slate-700 bg-slate-800 p-3">
        <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-500/15 text-brand-200">
          <UserRound className="h-5 w-5" />
        </span>
        <p className="min-w-0 flex-1 text-xs uppercase tracking-wider text-slate-400">
          Cliente: <span className="block truncate text-sm font-semibold normal-case tracking-normal text-slate-100">{clienteNombre}</span>
        </p>
        <button type="button" onClick={onCliente} aria-label="Cambiar cliente" title="Buscar o cambiar cliente (F4)" className="shrink-0 rounded-lg border border-slate-600 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-700">
          Cambiar <kbd className="ml-1 text-slate-400">F4</kbd>
        </button>
      </div>
      <ul role="list" aria-label="Líneas de la venta" className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {lineas.length === 0 ? (
          <li className="flex flex-col items-center gap-3 px-6 py-10 text-center text-slate-500">
            <span aria-hidden="true" className="flex h-16 w-16 items-center justify-center rounded-2xl border border-dashed border-slate-600 text-slate-500">
              <ShoppingCart className="h-8 w-8" />
            </span>
            <span className="text-base font-medium text-slate-400">Carrito vacío</span>
            <span className="text-sm">Escanee o busque un producto para empezar</span>
          </li>
        ) : null}
        {lineas.map((l, i) => {
          const r = calculo.lineas[i];
          return (
            <li key={l.clave} className="rounded-xl border border-slate-700 bg-slate-800 p-3">
              <div className="flex items-start justify-between gap-3">
                <button type="button" aria-label={`Editar ${l.nombre}`} onClick={() => onEditar(l)} className="min-w-0 flex-1 text-left">
                  <span className="block truncate text-sm font-medium text-ink">{l.nombre}</span>
                  <span className="text-xs text-slate-400">
                    {dinero(l.precioUnitario)} × {cantidadTexto(l.cantidad)} {l.unidad}
                    {l.descuento > 0 ? ` · desc. ${l.tipoDescuento === "PORCENTAJE" ? `${l.descuento}%` : dinero(l.descuento)}` : ""}
                    {l.porcentajeIva > 0 ? ` · IVA ${l.porcentajeIva}%` : ""}
                  </span>
                </button>
                <span className="text-base font-semibold tabular-nums text-ink">{r === null || r === undefined ? "—" : dinero(r.subtotal)}</span>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <div className="flex items-center rounded-lg border border-slate-600 bg-slate-900">
                  <button type="button" aria-label={`Disminuir ${l.nombre}`} onClick={() => onMenos(l)} className={boton}>
                    <Minus className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <span className="min-w-10 text-center text-sm font-medium tabular-nums text-ink" aria-label={`Cantidad de ${l.nombre}`}>
                    {cantidadTexto(l.cantidad)}
                  </span>
                  <button type="button" aria-label={`Aumentar ${l.nombre}`} onClick={() => onMas(l)} className={boton}>
                    <Plus className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
                <button type="button" aria-label={`Quitar ${l.nombre}`} title="Quitar" onClick={() => onQuitar(l)} className={`ml-auto flex items-center justify-center rounded-lg text-red-300 hover:bg-red-500/10 hover:text-red-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400 ${tactil ? "h-12 w-12" : "h-8 w-8"}`}>
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <dl className="mt-3 space-y-1 rounded-xl border border-slate-700 bg-slate-900/60 p-3 text-sm tabular-nums" aria-label="Totales">
        <Fila etiqueta="Subtotal 15%" valor={dinero(general?.base ?? 0)} />
        <Fila etiqueta="Subtotal 0%" valor={dinero(tarifaCero?.base ?? 0)} />
        {otrasTarifas.map((t) => <Fila key={t.porcentaje} etiqueta={`Subtotal ${t.porcentaje}%`} valor={dinero(t.base)} />)}
        <Fila etiqueta={<>Descuento <span className="text-xs text-slate-400">aplicado</span></>} valor={dinero(calculo.totales.descuento)} />
        <Fila etiqueta="IVA 15%" valor={dinero(general?.iva ?? 0)} />
        {otrasTarifas.map((t) => <Fila key={t.porcentaje} etiqueta={`IVA ${t.porcentaje}%`} valor={dinero(t.iva)} />)}
        <div className="flex items-baseline justify-between border-t border-slate-700 pt-2 text-ink">
          <dt className="text-base font-semibold">Total</dt>
          <dd data-testid="total" className={`font-bold ${tactil ? "text-4xl" : "text-3xl"}`}>
            {dinero(calculo.totales.total)}
          </dd>
        </div>
      </dl>
      {calculo.hayErrores ? (
        <p role="alert" className="mt-2 text-xs text-red-300">
          Hay un descuento mayor que el valor de su línea: corríjalo para cobrar.
        </p>
      ) : null}
    </section>
  );
}

function Fila({ etiqueta, valor }: { etiqueta: React.ReactNode; valor: string }): React.JSX.Element {
  return (
    <div className="flex justify-between text-slate-300">
      <dt>{etiqueta}</dt>
      <dd>{valor}</dd>
    </div>
  );
}

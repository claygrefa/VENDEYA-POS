// ============================================================
// src/renderer/components/CarritoPanel.tsx — Líneas de la venta y totales
// ============================================================
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
}

export function CarritoPanel({ lineas, calculo, clienteNombre, tactil, onMas, onMenos, onQuitar, onEditar }: Props): React.JSX.Element {
  const boton = `rounded-lg bg-slate-700 text-white active:bg-slate-600 ${tactil ? "h-12 w-12 text-xl" : "h-8 w-8"}`;
  return (
    <section aria-label="Carrito" className="flex min-h-0 flex-1 flex-col">
      <p className="mb-2 text-xs uppercase tracking-wider text-slate-400">
        Cliente: <span className="font-semibold text-slate-200">{clienteNombre}</span>
      </p>
      <ul role="list" aria-label="Líneas de la venta" className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {lineas.length === 0 ? <li className="p-6 text-center text-slate-500">Escanee o busque un producto para empezar</li> : null}
        {lineas.map((l, i) => {
          const r = calculo.lineas[i];
          return (
            <li key={l.clave} className="rounded-xl border border-slate-700 bg-slate-800 p-3">
              <div className="flex items-start justify-between gap-3">
                <button type="button" aria-label={`Editar ${l.nombre}`} onClick={() => onEditar(l)} className="min-w-0 flex-1 text-left">
                  <span className="block truncate text-sm font-medium text-white">{l.nombre}</span>
                  <span className="text-xs text-slate-400">
                    {dinero(l.precioUnitario)} × {cantidadTexto(l.cantidad)} {l.unidad}
                    {l.descuento > 0 ? ` · desc. ${l.tipoDescuento === "PORCENTAJE" ? `${l.descuento}%` : dinero(l.descuento)}` : ""}
                    {l.porcentajeIva > 0 ? ` · IVA ${l.porcentajeIva}%` : ""}
                  </span>
                </button>
                <span className="text-sm font-semibold text-white">{r === null || r === undefined ? "—" : dinero(r.subtotal)}</span>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <button type="button" aria-label={`Disminuir ${l.nombre}`} onClick={() => onMenos(l)} className={boton}>
                  −
                </button>
                <span className="min-w-10 text-center text-sm text-white" aria-label={`Cantidad de ${l.nombre}`}>
                  {cantidadTexto(l.cantidad)}
                </span>
                <button type="button" aria-label={`Aumentar ${l.nombre}`} onClick={() => onMas(l)} className={boton}>
                  +
                </button>
                <button type="button" aria-label={`Quitar ${l.nombre}`} onClick={() => onQuitar(l)} className={`ml-auto text-sm text-red-300 hover:text-red-200 ${tactil ? "h-12 px-3" : ""}`}>
                  Quitar
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <dl className="mt-3 space-y-1 border-t border-slate-700 pt-3 text-sm" aria-label="Totales">
        <Fila etiqueta="Subtotal" valor={dinero(calculo.totales.subtotal)} />
        {calculo.totales.descuento > 0 ? <Fila etiqueta="Descuento" valor={`-${dinero(calculo.totales.descuento)}`} /> : null}
        {calculo.ivaPorTarifa
          .filter((t) => t.porcentaje > 0)
          .map((t) => (
            <Fila key={t.porcentaje} etiqueta={`IVA ${t.porcentaje}%`} valor={dinero(t.iva)} />
          ))}
        <div className="flex items-baseline justify-between pt-1 text-white">
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

function Fila({ etiqueta, valor }: { etiqueta: string; valor: string }): React.JSX.Element {
  return (
    <div className="flex justify-between text-slate-300">
      <dt>{etiqueta}</dt>
      <dd>{valor}</dd>
    </div>
  );
}

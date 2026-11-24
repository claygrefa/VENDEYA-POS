// ============================================================
// src/renderer/components/ModalCobro.tsx — Cobro con formas de pago mixtas, cambio y propina
// ============================================================
import React, { useState } from "react";
import { FORMAS_PAGO, type FormaPago } from "../services/tipos";
import { dinero, resumirPagos, round2 } from "../services/totales";
import { Aviso, Modal } from "./Modal";
import { TecladoNumerico } from "./TecladoNumerico";

export interface PagoEntrada {
  formaPago: FormaPago;
  monto: number;
}

export interface DatosCobro {
  pagos: PagoEntrada[];
  propina: number;
  emitirFactura: boolean;
}

interface Props {
  total: number;
  clienteNombre: string;
  esConsumidorFinal: boolean;
  tactil: boolean;
  /** Mensaje del servidor si el cobro falló (el diálogo sigue abierto para corregir) */
  error: string | null;
  enviando: boolean;
  onConfirmar: (d: DatosCobro) => void;
  onCancelar: () => void;
}

interface FilaPago {
  forma: FormaPago;
  monto: string;
}

const numero = (t: string): number => {
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? round2(n) : 0;
};

export function ModalCobro({ total, clienteNombre, esConsumidorFinal, tactil, error, enviando, onConfirmar, onCancelar }: Props): React.JSX.Element {
  const [filas, setFilas] = useState<FilaPago[]>([{ forma: "EFECTIVO", monto: total.toFixed(2) }]);
  const [propina, setPropina] = useState("");
  const [facturar, setFacturar] = useState(true);
  const [activa, setActiva] = useState(0);

  const propinaValor = numero(propina);
  const aPagar = round2(total + propinaValor);
  const pagos = filas.map((f) => ({ formaPago: f.forma, monto: numero(f.monto) })).filter((p) => p.monto > 0);
  const resumen = resumirPagos(aPagar, pagos);
  const usaCredito = filas.some((f) => f.forma === "CREDITO");
  const puede = !enviando && pagos.length > 0 && resumen.falta === 0 && !resumen.excedenteInvalido && !(usaCredito && esConsumidorFinal);

  const cambiarFila = (i: number, cambios: Partial<FilaPago>): void => setFilas((fs) => fs.map((f, k) => (k === i ? { ...f, ...cambios } : f)));

  /** Pone en la fila lo que falta para cubrir el total (o el monto exacto indicado). */
  const completar = (i: number, monto: number): void => cambiarFila(i, { monto: monto.toFixed(2) });
  const faltante = (i: number): number => {
    const otros = filas.reduce((a, f, k) => (k === i ? a : a + numero(f.monto)), 0);
    return Math.max(0, round2(aPagar - otros));
  };

  const confirmar = (e: React.FormEvent): void => {
    e.preventDefault();
    if (!puede) return;
    onConfirmar({ pagos: pagos as PagoEntrada[], propina: propinaValor, emitirFactura: facturar });
  };

  return (
    <Modal titulo="Cobrar" ayuda="Enter confirma · ESC cancela" ancho="md">
      <form onSubmit={confirmar} className="space-y-3">
        <div className="flex items-baseline justify-between rounded-xl bg-slate-900 px-4 py-3">
          <span className="text-sm text-slate-400">Total a pagar</span>
          <span data-testid="total-cobro" className="text-3xl font-bold text-white">
            {dinero(aPagar)}
          </span>
        </div>
        <p className="text-xs text-slate-400">
          Cliente: <span className="text-slate-200">{clienteNombre}</span>
        </p>

        <ul className="space-y-2">
          {filas.map((f, i) => (
            <li key={i} className="flex items-center gap-2">
              <select aria-label={`Forma de pago ${i + 1}`} value={f.forma} onChange={(e) => cambiarFila(i, { forma: e.target.value as FormaPago })} className="h-11 rounded-lg border border-slate-600 bg-slate-900 px-2 text-white">
                {FORMAS_PAGO.map((fp) => (
                  <option key={fp.valor} value={fp.valor}>
                    {fp.etiqueta}
                  </option>
                ))}
              </select>
              <input
                data-autofocus={i === 0 ? true : undefined}
                aria-label={`Monto ${i + 1}`}
                inputMode="decimal"
                value={f.monto}
                onFocus={() => setActiva(i)}
                onChange={(e) => cambiarFila(i, { monto: e.target.value })}
                className={`w-full rounded-lg border border-slate-600 bg-slate-900 px-3 text-right text-white outline-none focus:border-brand-400 ${tactil ? "h-14 text-xl" : "h-11"}`}
              />
              <button type="button" aria-label={`Completar pago ${i + 1}`} title="Poner lo que falta" onClick={() => completar(i, faltante(i))} className="h-11 rounded-lg bg-slate-700 px-3 text-sm text-white">
                Exacto
              </button>
              {filas.length > 1 ? (
                <button type="button" aria-label={`Quitar pago ${i + 1}`} onClick={() => setFilas((fs) => fs.filter((_, k) => k !== i))} className="h-11 px-2 text-red-300">
                  ✕
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => setFilas((fs) => [...fs, { forma: "TARJETA_CREDITO", monto: "" }])} className="text-sm text-brand-300 hover:text-brand-200">
          + Agregar otra forma de pago
        </button>

        {tactil ? <TecladoNumerico valor={filas[activa]?.monto ?? ""} onCambio={(v) => cambiarFila(Math.min(activa, filas.length - 1), { monto: v })} /> : null}

        <div className="grid grid-cols-2 gap-3 text-sm">
          <label className="text-slate-300">
            Propina
            <input aria-label="Propina" inputMode="decimal" value={propina} onChange={(e) => setPropina(e.target.value)} placeholder="0.00" className="mt-1 h-10 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 text-right text-white" />
          </label>
          <label className="flex items-end gap-2 pb-2 text-slate-300">
            <input type="checkbox" checked={facturar} onChange={(e) => setFacturar(e.target.checked)} className="h-5 w-5" />
            Emitir factura electrónica
          </label>
        </div>

        <div className="space-y-1 rounded-xl border border-slate-700 px-4 py-3 text-sm" aria-label="Resumen del cobro">
          <div className="flex justify-between text-slate-300">
            <span>Recibido</span>
            <span>{dinero(resumen.pagado)}</span>
          </div>
          {resumen.falta > 0 ? (
            <div className="flex justify-between font-semibold text-amber-300">
              <span>Falta</span>
              <span data-testid="falta">{dinero(resumen.falta)}</span>
            </div>
          ) : (
            <div className="flex justify-between text-xl font-bold text-emerald-300">
              <span>Cambio</span>
              <span data-testid="cambio">{dinero(resumen.cambio)}</span>
            </div>
          )}
        </div>

        {resumen.excedenteInvalido ? <Aviso tipo="error">Lo recibido supera el total y el excedente no se puede devolver: reduzca los pagos que no son en efectivo.</Aviso> : null}
        {usaCredito && esConsumidorFinal ? <Aviso tipo="info">La venta a crédito necesita un cliente identificado (F4).</Aviso> : null}
        {error !== null ? <Aviso tipo="error">{error}</Aviso> : null}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onCancelar} className="rounded-lg px-4 py-2 text-slate-300 hover:text-white">
            Cancelar
          </button>
          <button type="submit" disabled={!puede} className={`rounded-lg bg-emerald-600 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40 ${tactil ? "px-8 py-4 text-lg" : "px-6 py-2"}`}>
            {enviando ? "Registrando…" : "Confirmar cobro"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ============================================================
// src/renderer/components/ModalLinea.tsx — Cantidad, peso (balanza) y descuento de una línea
// ============================================================
import React, { useState } from "react";
import { ApiError } from "../services/api";
import { usePos } from "../services/contexto";
import { cantidadTexto } from "../services/totales";
import { Aviso, Modal } from "./Modal";
import { TecladoNumerico } from "./TecladoNumerico";

export interface ResultadoLinea {
  cantidad: number;
  descuento: number;
  tipoDescuento: "PORCENTAJE" | "VALOR";
}

interface Props {
  titulo: string;
  unidad: string;
  permiteDecimales: boolean;
  /** Para pedir el peso a la balanza (solo productos a granel) */
  productoId: string | null;
  balanzaDisponible: boolean;
  inicial: ResultadoLinea;
  /** Mostrar el campo de descuento (al editar una línea; al agregar un producto solo se pide la cantidad) */
  conDescuento: boolean;
  tactil: boolean;
  onAceptar: (r: ResultadoLinea) => void;
  onCancelar: () => void;
}

const numero = (t: string): number => {
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
};

export function ModalLinea({ titulo, unidad, permiteDecimales, productoId, balanzaDisponible, inicial, conDescuento, tactil, onAceptar, onCancelar }: Props): React.JSX.Element {
  const { api } = usePos();
  const [cantidad, setCantidad] = useState(inicial.cantidad > 0 ? cantidadTexto(inicial.cantidad) : "");
  const [descuento, setDescuento] = useState(inicial.descuento > 0 ? String(inicial.descuento) : "");
  const [tipo, setTipo] = useState<"PORCENTAJE" | "VALOR">(inicial.tipoDescuento);
  const [error, setError] = useState<string | null>(null);
  const [pesando, setPesando] = useState(false);
  const [campoTactil, setCampoTactil] = useState<"cantidad" | "descuento">("cantidad");

  const pesar = async (): Promise<void> => {
    if (productoId === null) return;
    setPesando(true);
    setError(null);
    try {
      const r = await api.pesar(productoId);
      if (r.cantidad !== null) setCantidad(cantidadTexto(r.cantidad));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo leer la balanza");
    } finally {
      setPesando(false);
    }
  };

  const aceptar = (e: React.FormEvent): void => {
    e.preventDefault();
    const c = numero(cantidad);
    const d = descuento === "" ? 0 : numero(descuento);
    if (!(c > 0)) return setError("Indique una cantidad mayor que cero");
    if (!permiteDecimales && !Number.isInteger(c)) return setError(`${unidad} no admite decimales`);
    if (Number.isNaN(d) || d < 0) return setError("El descuento no es válido");
    if (tipo === "PORCENTAJE" && d > 100) return setError("El descuento no puede superar 100%");
    onAceptar({ cantidad: c, descuento: d, tipoDescuento: tipo });
  };

  const campo = "w-full rounded-lg border border-slate-600 bg-slate-900 px-3 text-ink outline-none focus:border-brand-400 " + (tactil ? "h-14 text-xl" : "h-10");
  return (
    <Modal titulo={titulo} ayuda="Enter acepta · ESC cancela" ancho="sm">
      <form onSubmit={aceptar} className="space-y-3">
        <label className="block text-sm text-slate-300">
          Cantidad ({unidad})
          <div className="mt-1 flex gap-2">
            <input data-autofocus aria-label="Cantidad" inputMode="decimal" value={cantidad} onFocus={() => setCampoTactil("cantidad")} onChange={(e) => setCantidad(e.target.value)} className={campo} />
            {balanzaDisponible && productoId !== null ? (
              <button type="button" onClick={() => void pesar()} disabled={pesando} className="rounded-lg bg-brand-600 px-4 text-sm font-medium text-white disabled:opacity-50">
                {pesando ? "Pesando…" : "Pesar"}
              </button>
            ) : null}
          </div>
        </label>
        {conDescuento ? (
          <div>
            <span className="block text-sm text-slate-300">Descuento de la línea</span>
            <div className="mt-1 flex gap-2">
              <input aria-label="Descuento" inputMode="decimal" value={descuento} onFocus={() => setCampoTactil("descuento")} onChange={(e) => setDescuento(e.target.value)} className={campo} />
              <select aria-label="Tipo de descuento" value={tipo} onChange={(e) => setTipo(e.target.value as "PORCENTAJE" | "VALOR")} className="rounded-lg border border-slate-600 bg-slate-900 px-2 text-ink">
                <option value="VALOR">$</option>
                <option value="PORCENTAJE">%</option>
              </select>
            </div>
          </div>
        ) : null}
        {tactil ? <TecladoNumerico valor={campoTactil === "cantidad" ? cantidad : descuento} decimales={permiteDecimales || campoTactil === "descuento"} onCambio={campoTactil === "cantidad" ? setCantidad : setDescuento} /> : null}
        {error !== null ? <Aviso tipo="error">{error}</Aviso> : null}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onCancelar} className="rounded-lg px-4 py-2 text-slate-300 hover:text-ink">
            Cancelar
          </button>
          <button type="submit" className="rounded-lg bg-brand-600 px-5 py-2 font-medium text-white">
            Aceptar
          </button>
        </div>
      </form>
    </Modal>
  );
}

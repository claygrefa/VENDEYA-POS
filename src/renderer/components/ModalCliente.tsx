// ============================================================
// src/renderer/components/ModalCliente.tsx — Elegir el cliente de la venta (por defecto, Consumidor Final)
// ============================================================
import React, { useState } from "react";
import { useClientes } from "../hooks/consultas";
import type { ClientePos } from "../services/tipos";
import { Modal } from "./Modal";

interface Props {
  actual: ClientePos | null;
  tactil: boolean;
  onElegir: (c: ClientePos | null) => void;
  onCancelar: () => void;
}

export function ModalCliente({ actual, tactil, onElegir, onCancelar }: Props): React.JSX.Element {
  const [texto, setTexto] = useState("");
  const { data, isFetching, isError } = useClientes(texto, true);
  return (
    <Modal titulo="Cliente de la venta" ayuda="ESC cierra" ancho="md">
      <input
        data-autofocus
        aria-label="Buscar cliente"
        placeholder="Nombre, cédula o RUC (mínimo 2 letras)"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        className={`w-full rounded-lg border border-slate-600 bg-slate-900 px-3 text-ink outline-none focus:border-brand-400 ${tactil ? "h-14 text-xl" : "h-10"}`}
      />
      <ul className="mt-3 max-h-64 space-y-1 overflow-y-auto" aria-busy={isFetching}>
        {(data?.items ?? []).map((c) => (
          <li key={c.id}>
            <button type="button" onClick={() => onElegir(c)} aria-label={`Elegir ${c.razonSocial}`} className="flex w-full justify-between rounded-lg bg-slate-700/60 px-3 py-2 text-left text-ink hover:bg-slate-700">
              <span>{c.razonSocial}</span>
              <span className="text-sm text-slate-400">{c.identificacion}</span>
            </button>
          </li>
        ))}
        {data !== undefined && data.items.length === 0 ? <li className="p-3 text-center text-sm text-slate-400">Sin coincidencias</li> : null}
        {isError ? <li role="alert" className="p-3 text-sm text-red-300">No se pudo buscar clientes</li> : null}
      </ul>
      <div className="mt-4 flex justify-between gap-2">
        <button type="button" onClick={() => onElegir(null)} disabled={actual === null} className="rounded-lg border border-slate-600 px-4 py-2 text-slate-200 disabled:opacity-40">
          Consumidor Final
        </button>
        <button type="button" onClick={onCancelar} className="rounded-lg px-4 py-2 text-slate-300 hover:text-ink">
          Cerrar
        </button>
      </div>
    </Modal>
  );
}

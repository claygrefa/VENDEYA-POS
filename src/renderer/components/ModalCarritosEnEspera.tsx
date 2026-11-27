import { Clock, Pause, Play } from "lucide-react";
import type { CarritoEnEspera } from "../services/carritosEnEspera";
import { calcularCarrito, dinero } from "../services/totales";
import { Aviso, Modal } from "./Modal";

interface Props {
  carritos: CarritoEnEspera[];
  hayCarrito: boolean;
  error: string | null;
  onSuspender: () => void;
  onRecuperar: (c: CarritoEnEspera) => void;
  onCerrar: () => void;
}

const fecha = new Intl.DateTimeFormat("es-EC", { dateStyle: "short", timeStyle: "short" });

export function ModalCarritosEnEspera({ carritos, hayCarrito, error, onSuspender, onRecuperar, onCerrar }: Props) {
  return (
    <Modal titulo="Carritos en espera" ayuda="ESC cierra" ancho="md">
      {error !== null && <Aviso tipo="error">{error}</Aviso>}
      {hayCarrito && (
        <button type="button" onClick={onSuspender} className="btn-primary mb-3 inline-flex min-h-11 w-full items-center justify-center gap-2">
          <Pause className="h-4 w-4" aria-hidden="true" /> Poner carrito actual en espera
        </button>
      )}
      {hayCarrito && carritos.length > 0 && <p className="mb-2 text-sm text-slate-300">Al recuperar otro carrito, el actual queda en espera.</p>}
      {carritos.length === 0 ? <p className="rounded-xl border border-slate-700 px-3 py-4 text-center text-sm text-slate-300">No hay carritos en espera.</p> : (
        <ul className="max-h-[45vh] space-y-2 overflow-y-auto" aria-label="Carritos guardados">
          {carritos.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => onRecuperar(c)} className="flex min-h-16 w-full items-center justify-between gap-3 rounded-xl border border-slate-700 bg-slate-900/60 p-3 text-left hover:border-brand-400 focus-visible:outline focus-visible:outline-brand-400">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">Recuperar · {c.cliente?.razonSocial ?? "Consumidor Final"}</span>
                  <span className="block truncate text-xs text-slate-300">{c.lineas.map((l) => l.nombre).join(", ")}</span>
                  <span className="mt-1 flex items-center gap-1 text-xs text-slate-400"><Clock className="h-3 w-3" aria-hidden="true" /> {fecha.format(new Date(c.guardadoEn))}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2 text-sm font-semibold text-brand-200">{dinero(calcularCarrito(c.lineas).totales.total)} <Play className="h-4 w-4" aria-hidden="true" /></span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex justify-end">
        <button type="button" onClick={onCerrar} className="min-h-11 rounded-lg px-4 text-sm text-slate-200 hover:bg-slate-700">Cerrar</button>
      </div>
    </Modal>
  );
}

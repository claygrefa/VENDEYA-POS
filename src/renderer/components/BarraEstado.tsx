// ============================================================
// src/renderer/components/BarraEstado.tsx — Cajero, turno y estado de la conexión, la cola del SRI y la impresora
// ============================================================
import { LogOut } from "lucide-react";
import React, { useState } from "react";
import type { EstadoCliente } from "../../server/services/sync/syncCliente";
import { useColaSri, useImpresora } from "../hooks/consultas";
import { useSesion } from "../store/sesion.store";
import { CambiarPassword } from "./CambiarPassword";
import { MenuPreferencias } from "./MenuPreferencias";

interface Props {
  sync: { estado: EstadoCliente; desactivada: boolean };
  onSalir: () => void;
}

type Tono = "verde" | "ambar" | "rojo" | "gris";

const TONOS: Record<Tono, { pildora: string; punto: string }> = {
  verde: { pildora: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200", punto: "bg-emerald-400 shadow-[0_0_6px_1px_rgba(52,211,153,0.7)]" },
  ambar: { pildora: "border-amber-500/30 bg-amber-500/10 text-amber-200", punto: "bg-amber-400 shadow-[0_0_6px_1px_rgba(251,191,36,0.7)]" },
  rojo: { pildora: "border-red-500/30 bg-red-500/10 text-red-200", punto: "bg-red-400 shadow-[0_0_6px_1px_rgba(248,113,113,0.7)]" },
  gris: { pildora: "border-slate-600 bg-slate-700/40 text-slate-300", punto: "bg-slate-500" },
};

/** Estado como píldora con un punto luminoso del color del tono */
function Pildora({ tono, testid, children }: { tono: Tono; testid?: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <span data-testid={testid} className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${TONOS[tono].pildora}`}>
      <span aria-hidden="true" className={`inline-block h-2 w-2 rounded-full ${TONOS[tono].punto}`} />
      {children}
    </span>
  );
}

export function BarraEstado({ sync, onSalir }: Props): React.JSX.Element {
  const usuario = useSesion((s) => s.usuario);
  const punto = useSesion((s) => s.puntoEmision);
  const turno = useSesion((s) => s.turno);
  const cola = useColaSri();
  const impresora = useImpresora();
  const [cambiandoPassword, setCambiandoPassword] = useState(false);

  const pendientes = cola.data === undefined || cola.data === null ? null : cola.data.pendientes.length;
  const conexion = sync.desactivada
    ? { texto: "Caja independiente", color: "gris" as const }
    : sync.estado === "CONECTADO"
      ? { texto: "Sincronizada", color: "verde" as const }
      : sync.estado === "CONECTANDO"
        ? { texto: "Conectando…", color: "ambar" as const }
        : { texto: "Sin conexión LAN", color: "rojo" as const };
  const imp = impresora.data;

  return (
    <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-300">
      <div className="flex items-center gap-3">
        <span className="font-semibold text-ink">
          {usuario?.nombre} {usuario?.apellido}
        </span>
        {punto !== null ? (
          <span className="rounded-md bg-slate-700/60 px-2 py-0.5 text-xs tabular-nums text-slate-300">
            {punto.sucursal.nombre} · {punto.sucursal.codigo}-{punto.codigo}
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2" aria-label="Estado del sistema">
        <Pildora tono={conexion.color} testid="estado-sync">{conexion.texto}</Pildora>
        {pendientes !== null ? (
          <Pildora tono={pendientes === 0 ? "verde" : "ambar"} testid="estado-sri">
            SRI: {pendientes === 0 ? "al día" : `${pendientes} pendiente${pendientes === 1 ? "" : "s"}`}
          </Pildora>
        ) : null}
        {imp !== undefined ? (
          <Pildora tono={imp.conexion !== "NINGUNA" && imp.impresionTermica ? "verde" : "gris"} testid="estado-impresora">
            {imp.conexion !== "NINGUNA" && imp.impresionTermica ? "Impresora lista" : "Sin impresora"}
          </Pildora>
        ) : null}
        <Pildora tono={turno === null ? "gris" : "verde"} testid="estado-turno">
          {turno === null ? "Turno: sin abrir" : "Turno abierto"}
        </Pildora>
        <span className="ml-2 flex items-center gap-2">
          <MenuPreferencias onCambiarPassword={() => setCambiandoPassword(true)} />
          <button type="button" onClick={onSalir} className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-red-300 hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400">
            <LogOut className="h-4 w-4" aria-hidden="true" /> Salir
          </button>
        </span>
      </div>
      {cambiandoPassword ? <CambiarPassword onCerrar={() => setCambiandoPassword(false)} /> : null}
    </header>
  );
}

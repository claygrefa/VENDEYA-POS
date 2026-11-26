// ============================================================
// src/renderer/components/BarraEstado.tsx — Cajero, turno y estado de la conexión, la cola del SRI y la impresora
// ============================================================
import React, { useState } from "react";
import type { EstadoCliente } from "../../server/services/sync/syncCliente";
import { useColaSri, useImpresora } from "../hooks/consultas";
import { useSesion } from "../store/sesion.store";
import { CambiarPassword } from "./CambiarPassword";

interface Props {
  sync: { estado: EstadoCliente; desactivada: boolean };
  onSalir: () => void;
}

function Punto({ color }: { color: "verde" | "ambar" | "rojo" | "gris" }): React.JSX.Element {
  const c = { verde: "bg-emerald-400", ambar: "bg-amber-400", rojo: "bg-red-400", gris: "bg-slate-500" } as const;
  return <span aria-hidden="true" className={`inline-block h-2 w-2 rounded-full ${c[color]}`} />;
}

export function BarraEstado({ sync, onSalir }: Props): React.JSX.Element {
  const usuario = useSesion((s) => s.usuario);
  const punto = useSesion((s) => s.puntoEmision);
  const tactil = useSesion((s) => s.modoTactil);
  const alternarTactil = useSesion((s) => s.alternarTactil);
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
    <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-b border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-300">
      <div className="flex items-center gap-4">
        <span className="font-semibold text-white">VENDEYA POS</span>
        <span>
          {usuario?.nombre} {usuario?.apellido}
        </span>
        {punto !== null ? (
          <span>
            {punto.sucursal.nombre} · {punto.sucursal.codigo}-{punto.codigo}
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-4" aria-label="Estado del sistema">
        <span className="flex items-center gap-2" data-testid="estado-sync">
          <Punto color={conexion.color} />
          {conexion.texto}
        </span>
        {pendientes !== null ? (
          <span className="flex items-center gap-2" data-testid="estado-sri">
            <Punto color={pendientes === 0 ? "verde" : "ambar"} />
            SRI: {pendientes === 0 ? "al día" : `${pendientes} pendiente${pendientes === 1 ? "" : "s"}`}
          </span>
        ) : null}
        {imp !== undefined ? (
          <span className="flex items-center gap-2" data-testid="estado-impresora">
            <Punto color={imp.conexion !== "NINGUNA" && imp.impresionTermica ? "verde" : "gris"} />
            {imp.conexion !== "NINGUNA" && imp.impresionTermica ? "Impresora lista" : "Sin impresora"}
          </span>
        ) : null}
        <button type="button" onClick={alternarTactil} aria-pressed={tactil} className="rounded-lg border border-slate-600 px-3 py-1 hover:bg-slate-700">
          Modo táctil: {tactil ? "sí" : "no"}
        </button>
        <button type="button" onClick={() => setCambiandoPassword(true)} className="rounded-lg border border-slate-600 px-3 py-1 hover:bg-slate-700">
          Mi contraseña
        </button>
        <button type="button" onClick={onSalir} className="rounded-lg px-3 py-1 text-red-300 hover:bg-slate-700">
          Salir
        </button>
      </div>
      {cambiandoPassword ? <CambiarPassword onCerrar={() => setCambiandoPassword(false)} /> : null}
    </header>
  );
}

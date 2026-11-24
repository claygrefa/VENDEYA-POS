// ============================================================
// src/renderer/pages/AperturaTurnoPage.tsx — Abre el turno de caja (o retoma el que ya estaba abierto)
// ============================================================
import { useQuery } from "@tanstack/react-query";
import React, { useEffect, useState } from "react";
import { Aviso } from "../components/Modal";
import { usePuntosEmision } from "../hooks/consultas";
import { ApiError } from "../services/api";
import { usePos } from "../services/contexto";
import type { PuntoEmisionPos, TurnoPos } from "../services/tipos";
import { useSesion } from "../store/sesion.store";

/** Punto de emisión que corresponde al turno: el de su sucursal (el primero si hay varios). */
function puntoDelTurno(puntos: PuntoEmisionPos[], turno: TurnoPos): PuntoEmisionPos | null {
  return puntos.find((p) => p.sucursal.id === turno.sucursalId) ?? null;
}

export function AperturaTurnoPage({ onSalir }: { onSalir: () => void }): React.JSX.Element {
  const { api } = usePos();
  const usuario = useSesion((s) => s.usuario);
  const fijarTurno = useSesion((s) => s.fijarTurno);
  const fijarPunto = useSesion((s) => s.fijarPuntoEmision);
  const puntos = usePuntosEmision();
  const actual = useQuery({ queryKey: ["turno", "actual"], queryFn: () => api.turnoActual(), retry: false, staleTime: 0 });
  const [seleccion, setSeleccion] = useState("");
  const [monto, setMonto] = useState("0");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  // Si el cajero ya tenía un turno abierto (cerró la aplicación sin cerrar la caja), se retoma sin pedir nada
  useEffect(() => {
    if (actual.data === undefined || actual.data === null || puntos.data === undefined) return;
    fijarPunto(puntoDelTurno(puntos.data, actual.data));
    fijarTurno(actual.data);
  }, [actual.data, puntos.data, fijarPunto, fijarTurno]);

  useEffect(() => {
    if (seleccion === "" && puntos.data !== undefined && puntos.data[0] !== undefined) setSeleccion(puntos.data[0].id);
  }, [puntos.data, seleccion]);

  const abrir = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    const punto = puntos.data?.find((p) => p.id === seleccion);
    const importe = Number(monto.replace(",", "."));
    if (punto === undefined) return setError("Elija el punto de emisión");
    if (!Number.isFinite(importe) || importe < 0) return setError("El monto de apertura no es válido");
    setError(null);
    setEnviando(true);
    try {
      const turno = await api.abrirTurno(punto.sucursal.id, importe);
      fijarPunto(punto);
      fijarTurno(turno);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo abrir el turno");
    } finally {
      setEnviando(false);
    }
  };

  if (actual.isLoading || puntos.isLoading) return <p className="p-8 text-center text-slate-300">Cargando turno…</p>;
  if (puntos.isError) return <p role="alert" className="p-8 text-center text-red-300">{(puntos.error as Error).message}</p>;

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-900 p-6">
      <form onSubmit={(e) => void abrir(e)} className="w-full max-w-md space-y-4 rounded-2xl border border-slate-700 bg-slate-800 p-6" aria-label="Apertura de turno">
        <h1 className="text-xl font-bold text-white">Abrir turno de caja</h1>
        <p className="text-sm text-slate-300">
          Cajero: {usuario?.nombre} {usuario?.apellido}
        </p>
        <label className="block text-sm text-slate-300">
          Punto de emisión
          <select aria-label="Punto de emisión" value={seleccion} onChange={(e) => setSeleccion(e.target.value)} className="mt-1 h-12 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 text-white">
            {(puntos.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.sucursal.nombre} · {p.sucursal.codigo}-{p.codigo} {p.descripcion}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm text-slate-300">
          Efectivo con el que abre la caja
          <input aria-label="Monto de apertura" inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} className="mt-1 h-12 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 text-right text-white" />
        </label>
        {error !== null ? <Aviso tipo="error">{error}</Aviso> : null}
        <div className="flex justify-between gap-3">
          <button type="button" onClick={onSalir} className="rounded-lg px-4 py-3 text-slate-300 hover:text-white">
            Salir
          </button>
          <button type="submit" disabled={enviando || (puntos.data ?? []).length === 0} className="rounded-lg bg-brand-600 px-6 py-3 font-semibold text-white disabled:opacity-40">
            {enviando ? "Abriendo…" : "Abrir turno"}
          </button>
        </div>
        {(puntos.data ?? []).length === 0 ? <Aviso tipo="info">No hay puntos de emisión activos: configúrelos antes de vender.</Aviso> : null}
      </form>
    </main>
  );
}

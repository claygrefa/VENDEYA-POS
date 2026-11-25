// ============================================================
// src/renderer/pages/AjustesLicencia.tsx — Ajustes › Licencia: activar con clave, estado, validar ahora, equipos y desactivar este equipo
// ============================================================
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useState } from "react";
import type { EstadoLicencia, TipoEstadoLicencia } from "../../shared/types/licencia.types";
import { Boton, Campo, Casilla, mensajeDeError } from "../components/Gestion";
import { Aviso } from "../components/Modal";
import { CLAVE_LICENCIA, useLicencia } from "../hooks/useLicencia";
import { useAjustes } from "../services/contexto";

const TITULO: Record<TipoEstadoLicencia, string> = {
  NO_REQUERIDA: "No requerida",
  SIN_LICENCIA: "Sin activar",
  ACTIVA: "Activa",
  POR_VENCER: "Por vencer",
  GRACIA: "En período de gracia",
  VENCIDA: "Suscripción vencida",
  BLOQUEADA_OFFLINE: "Bloqueada: falta validar en línea",
  REVOCADA: "Revocada",
  INVALIDA: "No válida en este equipo",
};
const TIPO_AVISO: Record<TipoEstadoLicencia, "exito" | "info" | "error"> = {
  NO_REQUERIDA: "info", SIN_LICENCIA: "error", ACTIVA: "exito", POR_VENCER: "info", GRACIA: "info", VENCIDA: "error", BLOQUEADA_OFFLINE: "error", REVOCADA: "error", INVALIDA: "error",
};

const fecha = (iso: string | null): string => (iso === null ? "—" : new Date(iso).toLocaleDateString("es-EC"));
type Mensaje = { tipo: "error" | "exito" | "info"; texto: string } | null;

export function SeccionLicencia(): React.JSX.Element {
  const a = useAjustes();
  const qc = useQueryClient();
  const licencia = useLicencia();
  const [clave, setClave] = useState("");
  const [mensaje, setMensaje] = useState<Mensaje>(null);
  const [confirmarDesactivar, setConfirmarDesactivar] = useState(false);
  const [liberando, setLiberando] = useState<string | null>(null);

  const e: EstadoLicencia | undefined = licencia.data;
  const tieneLicencia = e !== undefined && e.claveEnmascarada !== null && e.tipo !== "NO_REQUERIDA" && e.tipo !== "SIN_LICENCIA";
  const refrescar = async (): Promise<void> => {
    await qc.invalidateQueries({ queryKey: CLAVE_LICENCIA });
  };
  const alError = (err: unknown): void => setMensaje({ tipo: "error", texto: mensajeDeError(err) });

  const dispositivos = useQuery({ queryKey: [...CLAVE_LICENCIA, "dispositivos"], queryFn: () => a.dispositivosLicencia(), enabled: tieneLicencia, retry: false });

  const activar = useMutation({
    mutationFn: (c: string) => a.activarLicencia(c.trim()),
    onSuccess: async (nuevo) => { setClave(""); setMensaje({ tipo: "exito", texto: nuevo.mensaje }); await refrescar(); },
    onError: alError,
  });
  const validar = useMutation({
    mutationFn: () => a.validarLicencia(),
    onSuccess: async (r) => {
      setMensaje(r.error === null ? { tipo: "exito", texto: "Licencia validada con el servidor" } : { tipo: "info", texto: `No se pudo validar ahora: ${r.error} Se seguirá intentando.` });
      await refrescar();
    },
    onError: alError,
  });
  const desactivar = useMutation({
    mutationFn: () => a.desactivarLicencia(),
    onSuccess: async () => { setConfirmarDesactivar(false); setMensaje({ tipo: "exito", texto: "Este equipo quedó desactivado: la plaza está libre para otro equipo" }); await refrescar(); },
    onError: alError,
  });
  const liberar = useMutation({
    mutationFn: (id: string) => a.liberarDispositivo(id),
    onSuccess: async () => { setLiberando(null); setMensaje({ tipo: "exito", texto: "Equipo liberado" }); await qc.invalidateQueries({ queryKey: [...CLAVE_LICENCIA, "dispositivos"] }); },
    onError: alError,
  });

  if (e === undefined) return licencia.isError ? <Aviso tipo="error">{mensajeDeError(licencia.error)}</Aviso> : <p className="text-slate-400">Cargando…</p>;
  if (e.tipo === "NO_REQUERIDA") {
    return <Aviso tipo="info">{e.mensaje}</Aviso>;
  }

  return (
    <div className="max-w-2xl space-y-5">
      <section aria-label="Estado de la licencia" className="space-y-2 rounded-xl border border-slate-700 bg-slate-800 p-4 text-sm text-slate-200">
        <h2 className="text-base font-semibold text-white">{TITULO[e.tipo]}</h2>
        <Aviso tipo={TIPO_AVISO[e.tipo]}>{e.mensaje}</Aviso>
        {e.claveEnmascarada !== null ? (
          <dl className="grid grid-cols-[10rem_1fr] gap-x-3 gap-y-1">
            <dt className="text-slate-400">Clave</dt><dd>{e.claveEnmascarada}</dd>
            <dt className="text-slate-400">Plan</dt><dd>{e.plan ?? "—"}</dd>
            <dt className="text-slate-400">Vence</dt><dd>{fecha(e.vence)}{e.diasParaVencer !== null && e.diasParaVencer >= 0 ? ` (${e.diasParaVencer} días)` : ""}</dd>
            <dt className="text-slate-400">Última validación</dt><dd>{fecha(e.ultimaValidacion)}</dd>
            {e.diasGraciaRestantes !== null ? (<><dt className="text-slate-400">Gracia sin conexión</dt><dd>{e.diasGraciaRestantes} días</dd></>) : null}
            <dt className="text-slate-400">Equipos del plan</dt><dd>{e.maxDispositivos ?? "—"}</dd>
          </dl>
        ) : null}
      </section>

      <form aria-label="Activar licencia" noValidate className="space-y-3" onSubmit={(ev) => { ev.preventDefault(); setMensaje(null); activar.mutate(clave); }}>
        <h2 className="text-sm font-semibold text-white">{tieneLicencia || e.tipo === "VENCIDA" ? "Usar otra clave" : "Activar licencia"}</h2>
        <Campo etiqueta="Clave de activación" valor={clave} onCambio={(v) => { setClave(v.toUpperCase()); setMensaje(null); }} placeholder="XXXX-XXXX-XXXX-XXXX" />
        <p className="text-xs text-slate-400">Necesita conexión a internet. La clave se asocia a este equipo y al RUC de su empresa.</p>
        <Boton tipo="submit" variante="primario" deshabilitado={activar.isPending || clave.trim() === ""}>
          {activar.isPending ? "Activando…" : "Activar"}
        </Boton>
      </form>

      {mensaje !== null ? <Aviso tipo={mensaje.tipo}>{mensaje.texto}</Aviso> : null}

      {e.claveEnmascarada !== null ? (
        <>
          <div className="flex gap-3">
            <Boton deshabilitado={validar.isPending} onClick={() => { setMensaje(null); validar.mutate(); }}>
              {validar.isPending ? "Validando…" : "Validar ahora"}
            </Boton>
          </div>

          <section aria-label="Equipos de la licencia" className="space-y-2">
            <h2 className="text-sm font-semibold text-white">Equipos</h2>
            {dispositivos.isError ? (
              <p className="text-sm text-slate-400">No se pudo consultar la lista de equipos ahora ({mensajeDeError(dispositivos.error)}).</p>
            ) : dispositivos.data === undefined ? (
              <p className="text-sm text-slate-400">Cargando…</p>
            ) : (
              <>
                <p className="text-sm text-slate-300">{dispositivos.data.dispositivos.length} de {dispositivos.data.maximo} plazas en uso</p>
                <ul aria-label="Equipos" className="space-y-1 text-sm text-slate-200">
                  {dispositivos.data.dispositivos.map((d) => (
                    <li key={d.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2">
                      <span>
                        {d.nombre} <span className="text-slate-400">· {d.plataforma}{d.ultimoUso !== null ? ` · último uso ${fecha(d.ultimoUso)}` : ""}</span>
                        {d.esEste ? <strong className="ml-2 text-emerald-300">Este equipo</strong> : null}
                      </span>
                      {d.esEste ? null : liberando === d.id ? (
                        <span className="flex items-center gap-2">
                          <span>¿Liberar {d.nombre}?</span>
                          <Boton variante="peligro" deshabilitado={liberar.isPending} onClick={() => liberar.mutate(d.id)}>Sí, liberar</Boton>
                          <Boton onClick={() => setLiberando(null)}>Cancelar</Boton>
                        </span>
                      ) : (
                        <Boton onClick={() => setLiberando(d.id)}>Liberar</Boton>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          <section aria-label="Desactivar este equipo" className="space-y-2 rounded-xl border border-slate-700 p-4">
            <h2 className="text-sm font-semibold text-white">Desactivar este equipo</h2>
            <p className="text-xs text-slate-400">Libera la plaza de este equipo para usarla en otro (por ejemplo, al cambiar de computadora). Necesita conexión a internet y este equipo dejará de poder vender.</p>
            <Casilla etiqueta="Entiendo que este equipo dejará de poder vender" marcada={confirmarDesactivar} onCambio={setConfirmarDesactivar} />
            <Boton variante="peligro" deshabilitado={!confirmarDesactivar || desactivar.isPending} onClick={() => desactivar.mutate()}>
              Desactivar este equipo
            </Boton>
          </section>
        </>
      ) : null}
    </div>
  );
}

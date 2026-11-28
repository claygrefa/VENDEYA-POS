// ============================================================
// src/renderer/pages/AjustesPrivacidad.tsx — Ajustes › Privacidad: reporte opcional de errores técnicos (desactivado por defecto)
// ============================================================
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useState } from "react";
import type { EstadoTelemetria } from "../../shared/types/telemetria.types";
import { Boton, Casilla, mensajeDeError } from "../components/Gestion";
import { Aviso } from "../components/Modal";
import { useAjustes } from "../services/contexto";
import { CLAVE_TELEMETRIA } from "../hooks/useReporteErrores";

type Mensaje = { tipo: "error" | "exito" | "info"; texto: string } | null;
const fechaHora = (iso: string): string => new Date(iso).toLocaleString("es-EC", { dateStyle: "medium", timeStyle: "short" });

export function SeccionPrivacidad(): React.JSX.Element {
  const a = useAjustes();
  const qc = useQueryClient();
  const [mensaje, setMensaje] = useState<Mensaje>(null);
  const [verReportes, setVerReportes] = useState(false);
  const estado = useQuery({ queryKey: CLAVE_TELEMETRIA, queryFn: () => a.telemetria(), retry: false });
  const reportes = useQuery({ queryKey: [...CLAVE_TELEMETRIA, "pendientes"], queryFn: () => a.reportesTelemetria(), enabled: verReportes, retry: false });

  const fijar = (e: EstadoTelemetria): void => {
    qc.setQueryData(CLAVE_TELEMETRIA, e);
    void qc.invalidateQueries({ queryKey: [...CLAVE_TELEMETRIA, "pendientes"] });
  };
  const alError = (e: unknown): void => setMensaje({ tipo: "error", texto: mensajeDeError(e) });
  const configurar = useMutation({
    mutationFn: (activar: boolean) => a.configurarTelemetria(activar),
    onSuccess: (e) => { fijar(e); setVerReportes(false); setMensaje({ tipo: "exito", texto: e.consentimiento ? "Reporte de errores activado" : "Reporte de errores desactivado; se borró lo que estaba pendiente" }); },
    onError: alError,
  });
  const enviar = useMutation({
    mutationFn: () => a.enviarTelemetria(),
    onSuccess: (r) => { fijar(r.estado); setMensaje({ tipo: "exito", texto: r.enviados === 0 ? "No había nada pendiente" : `Se enviaron ${r.enviados} reportes` }); },
    onError: alError,
  });
  const descartar = useMutation({
    mutationFn: () => a.descartarTelemetria(),
    onSuccess: (r) => { fijar(r.estado); setMensaje({ tipo: "info", texto: `Se descartaron ${r.descartados} reportes` }); },
    onError: alError,
  });

  if (estado.data === undefined) return estado.isError ? <Aviso tipo="error">{mensajeDeError(estado.error)}</Aviso> : <p className="text-slate-400">Cargando…</p>;
  const e = estado.data;

  return (
    <div className="max-w-3xl space-y-5">
      <section aria-label="Reporte de errores" className="space-y-3 rounded-xl border border-slate-700 bg-slate-800 p-4">
        <h2 className="text-base font-semibold text-ink">Reporte de errores</h2>
        <p className="text-sm text-slate-300">
          Si lo activa, cuando el programa falla se guarda un reporte técnico para ayudar a corregirlo. Está <strong>desactivado</strong> hasta que usted lo decida.
        </p>
        <div className="grid gap-4 text-sm md:grid-cols-2">
          <div>
            <h3 className="font-semibold text-emerald-300">Qué se reúne</h3>
            <ul className="list-disc pl-5 text-slate-300">
              <li>Versión del programa y sistema operativo</li>
              <li>El mensaje técnico del error y dónde ocurrió</li>
              <li>Un código al azar de esta instalación (no identifica su negocio)</li>
            </ul>
          </div>
          <div>
            <h3 className="font-semibold text-red-300">Qué NUNCA se reúne</h3>
            <ul className="list-disc pl-5 text-slate-300">
              <li>Ventas, clientes, productos ni precios</li>
              <li>Contraseñas, claves, certificados ni RUC o cédulas</li>
              <li>Correos, direcciones de red ni su nombre de usuario de Windows</li>
            </ul>
          </div>
        </div>
        <Casilla etiqueta="Enviar reportes de errores técnicos" marcada={e.consentimiento} onCambio={(v) => { setMensaje(null); configurar.mutate(v); }} />
        {e.consentimiento && e.desde !== null ? <p className="text-xs text-slate-400">Activado el {fechaHora(e.desde)}. Puede desactivarlo cuando quiera.</p> : null}
      </section>

      {mensaje !== null ? <Aviso tipo={mensaje.tipo}>{mensaje.texto}</Aviso> : null}

      {e.consentimiento ? (
        <section aria-label="Reportes pendientes" className="space-y-3">
          <h2 className="text-base font-semibold text-ink">Reportes pendientes: {e.pendientes}</h2>
          {!e.destinoConfigurado ? <Aviso tipo="info">Este equipo no tiene un servidor de destino configurado: los reportes se conservan aquí para que pueda revisarlos y no se envían a ninguna parte.</Aviso> : null}
          {e.ultimoEnvio !== null ? <p className="text-xs text-slate-400">Último envío: {fechaHora(e.ultimoEnvio)}</p> : null}
          <div className="flex flex-wrap gap-3">
            <Boton onClick={() => setVerReportes((v) => !v)}>{verReportes ? "Ocultar reportes" : "Ver reportes pendientes"}</Boton>
            <Boton variante="primario" deshabilitado={!e.destinoConfigurado || e.pendientes === 0 || enviar.isPending} onClick={() => { setMensaje(null); enviar.mutate(); }}>Enviar ahora</Boton>
            <Boton variante="peligro" deshabilitado={e.pendientes === 0 || descartar.isPending} onClick={() => { setMensaje(null); descartar.mutate(); }}>Descartar pendientes</Boton>
          </div>
          {verReportes ? (
            reportes.data === undefined ? (
              <p className="text-sm text-slate-400">{reportes.isError ? mensajeDeError(reportes.error) : "Cargando…"}</p>
            ) : reportes.data.reportes.length === 0 ? (
              <p className="text-sm text-slate-400">No hay reportes pendientes.</p>
            ) : (
              <>
                <p className="text-xs text-slate-400">Esto es exactamente lo que se enviaría:</p>
                <pre aria-label="Vista previa de los reportes" className="max-h-80 overflow-auto rounded-lg border border-slate-700 bg-slate-950 p-3 text-xs text-slate-200">{JSON.stringify(reportes.data.reportes, null, 2)}</pre>
              </>
            )
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

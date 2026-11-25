// ============================================================
// src/renderer/pages/SriMonitorPage.tsx — Monitor de comprobantes electrónicos del SRI (SriMonitor)
// ============================================================
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useState } from "react";
import { Aviso, Modal } from "../components/Modal";
import { aNumero, Boton, Campo, Paginador, Seleccion, Tabla, guardarArchivo, mensajeDeError } from "../components/Gestion";
import { useGestion } from "../services/contexto";
import type { ComprobanteListado, MensajeSri } from "../services/gestion.api";
import { tienePermiso, useSesion } from "../store/sesion.store";

const TIPOS: Record<string, string> = { "01": "Factura", "03": "Liquidación", "04": "Nota de crédito", "06": "Guía de remisión", "07": "Retención" };
const REINTENTABLES = ["PENDIENTE", "RECHAZADO", "DEVUELTO"];
const COLOR_ESTADO: Record<string, string> = { AUTORIZADO: "text-emerald-300", PENDIENTE: "text-amber-300", EN_PROCESO: "text-sky-300", RECHAZADO: "text-red-300", DEVUELTO: "text-red-300", ANULADO: "text-slate-400" };

/** Mensajes del SRI guardados como JSON en el comprobante (vacío si no hay o no se pueden leer). */
export function mensajesDe(c: Pick<ComprobanteListado, "mensajesRespuesta">): MensajeSri[] {
  if (c.mensajesRespuesta === null) return [];
  try {
    const r = JSON.parse(c.mensajesRespuesta) as unknown;
    return Array.isArray(r) ? (r as MensajeSri[]) : [];
  } catch {
    return [];
  }
}

export function SriMonitorPage(): React.JSX.Element {
  const g = useGestion();
  const qc = useQueryClient();
  const usuario = useSesion((s) => s.usuario);
  const puedeReintentar = tienePermiso(usuario, "sri:crear");
  const [estado, setEstado] = useState("");
  const [tipo, setTipo] = useState("");
  const [pagina, setPagina] = useState(1);
  const [detalle, setDetalle] = useState<ComprobanteListado | null>(null);
  const [aviso, setAviso] = useState<{ tipo: "error" | "exito"; texto: string } | null>(null);

  const lista = useQuery({ queryKey: ["colaSri", "lista", estado, tipo, pagina], queryFn: () => g.comprobantes(estado, tipo, pagina), placeholderData: (p) => p, refetchInterval: 20_000 });
  const cola = useQuery({ queryKey: ["colaSri", "resumen"], queryFn: () => g.colaSri(), retry: false, refetchInterval: 20_000 });

  const reintentar = useMutation({
    mutationFn: (c: ComprobanteListado) => g.reintentar(c.id),
    onSuccess: async () => { setAviso({ tipo: "exito", texto: "Comprobante en cola: se enviará al SRI en unos segundos" }); setDetalle(null); await qc.invalidateQueries({ queryKey: ["colaSri"] }); },
    onError: (e) => setAviso({ tipo: "error", texto: mensajeDeError(e) }),
  });
  const descargarRide = useMutation({
    mutationFn: async (c: ComprobanteListado) => { const r = await g.ride(c.id); guardarArchivo(r.nombre, r.blob); },
    onError: (e) => setAviso({ tipo: "error", texto: mensajeDeError(e) }),
  });

  const porEstado = cola.data?.porEstado ?? {};
  return (
    <section aria-label="Comprobantes SRI" className="space-y-4">
      <h1 className="text-xl font-semibold text-white">Comprobantes electrónicos</h1>
      <ul aria-label="Resumen por estado" className="flex flex-wrap gap-3 text-sm">
        {["PENDIENTE", "EN_PROCESO", "AUTORIZADO", "RECHAZADO", "DEVUELTO"].map((e) => (
          <li key={e} className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2">
            <span className={COLOR_ESTADO[e]}>{e.replace("_", " ")}</span>: <strong className="text-white">{porEstado[e] ?? 0}</strong>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-end gap-3">
        <Seleccion etiqueta="Estado" valor={estado} onCambio={(v) => { setEstado(v); setPagina(1); }} opciones={[{ valor: "", titulo: "Todos" }, ...["PENDIENTE", "EN_PROCESO", "AUTORIZADO", "RECHAZADO", "DEVUELTO", "ANULADO"].map((e) => ({ valor: e, titulo: e.replace("_", " ") }))]} />
        <Seleccion etiqueta="Tipo de comprobante" valor={tipo} onCambio={(v) => { setTipo(v); setPagina(1); }} opciones={[{ valor: "", titulo: "Todos" }, { valor: "01", titulo: "Factura" }, { valor: "04", titulo: "Nota de crédito" }]} />
      </div>
      {aviso !== null ? <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso> : null}
      {lista.isError ? <Aviso tipo="error">{mensajeDeError(lista.error)}</Aviso> : null}

      <Tabla etiqueta="Comprobantes" filas={lista.data?.items} clave={(c) => c.id} vacio="No hay comprobantes con ese filtro"
        columnas={[
          { titulo: "Fecha", celda: (c) => c.fechaEmision.slice(0, 10) },
          { titulo: "Tipo", celda: (c) => TIPOS[c.tipoComprobante] ?? c.tipoComprobante },
          { titulo: "Número", celda: (c) => `${c.serie}-${c.secuencial}` },
          { titulo: "Estado", celda: (c) => <span className={COLOR_ESTADO[c.estado] ?? ""}>{c.estado.replace("_", " ")}</span> },
          { titulo: "Intentos", derecha: true, celda: (c) => c.intentosEnvio },
          { titulo: "Último mensaje", celda: (c) => mensajesDe(c)[0]?.mensaje ?? c.colaSRI?.ultimoError ?? "" },
          { titulo: "Acciones", celda: (c) => (
            <span className="flex gap-2">
              <Boton onClick={() => setDetalle(c)}>{`Detalle ${c.serie}-${c.secuencial}`}</Boton>
              <Boton onClick={() => descargarRide.mutate(c)}>{`RIDE ${c.serie}-${c.secuencial}`}</Boton>
              {puedeReintentar && REINTENTABLES.includes(c.estado) ? <Boton variante="primario" onClick={() => reintentar.mutate(c)}>{`Reintentar ${c.serie}-${c.secuencial}`}</Boton> : null}
            </span>
          ) },
        ]} />
      <Paginador pagina={pagina} total={lista.data?.total ?? 0} porPagina={15} onCambio={setPagina} />

      <AnexoAts />
      {detalle !== null ? <Detalle c={detalle} puedeReintentar={puedeReintentar} onReintentar={() => reintentar.mutate(detalle)} onCerrar={() => setDetalle(null)} /> : null}
    </section>
  );
}

function Detalle({ c, puedeReintentar, onReintentar, onCerrar }: { c: ComprobanteListado; puedeReintentar: boolean; onReintentar: () => void; onCerrar: () => void }): React.JSX.Element {
  const mensajes = mensajesDe(c);
  return (
    <Modal titulo={`${TIPOS[c.tipoComprobante] ?? "Comprobante"} ${c.serie}-${c.secuencial}`} ancho="lg" ayuda="ESC cierra">
      <dl className="space-y-1 text-sm text-slate-300">
        <div className="flex justify-between"><dt>Estado</dt><dd className={COLOR_ESTADO[c.estado] ?? ""}>{c.estado.replace("_", " ")}</dd></div>
        <div className="flex justify-between"><dt>Ambiente</dt><dd>{c.ambiente === "2" ? "Producción" : "Pruebas"}</dd></div>
        <div><dt>Clave de acceso</dt><dd className="break-all font-mono text-xs text-white">{c.claveAcceso}</dd></div>
        {c.proximoIntento !== null ? <div className="flex justify-between"><dt>Próximo intento</dt><dd>{c.proximoIntento.slice(0, 16).replace("T", " ")}</dd></div> : null}
      </dl>
      {c.colaSRI?.ultimoError != null ? <div className="mt-3"><Aviso tipo="info">{c.colaSRI.ultimoError}</Aviso></div> : null}
      <h3 className="mb-2 mt-4 font-medium text-white">Mensajes del SRI</h3>
      {mensajes.length === 0 ? <p className="text-sm text-slate-500">El SRI no ha enviado mensajes.</p> : (
        <ul className="space-y-2" aria-label="Mensajes del SRI">
          {mensajes.map((m, i) => (
            <li key={`${m.identificador}-${i}`} className="rounded-lg border border-slate-700 bg-slate-900 p-3 text-sm">
              <span className={m.tipo === "ERROR" ? "text-red-300" : "text-amber-300"}>{m.tipo} {m.identificador}</span> — {m.mensaje}
              {m.informacionAdicional !== null ? <p className="mt-1 text-xs text-slate-400">{m.informacionAdicional}</p> : null}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex justify-end gap-2">
        {puedeReintentar && REINTENTABLES.includes(c.estado) ? <Boton variante="primario" onClick={onReintentar}>Reintentar envío</Boton> : null}
        <Boton onClick={onCerrar}>Cerrar</Boton>
      </div>
    </Modal>
  );
}

/** Descarga del Anexo Transaccional Simplificado de un periodo. */
function AnexoAts(): React.JSX.Element | null {
  const g = useGestion();
  const usuario = useSesion((s) => s.usuario);
  const ahora = new Date(Date.now() - 5 * 3_600_000);
  const [anio, setAnio] = useState(String(ahora.getUTCFullYear()));
  const [mes, setMes] = useState(String(ahora.getUTCMonth() + 1));
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState<string | null>(null);
  const descargar = useMutation({
    mutationFn: async () => {
      const a = aNumero(anio);
      const m = aNumero(mes);
      if (a === undefined || m === undefined || Number.isNaN(a) || Number.isNaN(m)) throw new Error("Indique el año y el mes");
      const r = await g.ats(a, m);
      guardarArchivo(r.nombre, r.blob);
      return r.nombre;
    },
    onSuccess: (n) => { setError(null); setListo(`Archivo ${n} descargado: revíselo en DIMM antes de presentarlo`); },
    onError: (e) => { setListo(null); setError(mensajeDeError(e)); },
  });
  if (!tienePermiso(usuario, "reportes:exportar")) return null;
  return (
    <form aria-label="Anexo transaccional" onSubmit={(e) => { e.preventDefault(); descargar.mutate(); }} className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-700 bg-slate-800/60 p-4">
      <h2 className="w-full font-medium text-white">Anexo Transaccional Simplificado (ATS)</h2>
      <Campo etiqueta="Año" tipo="number" valor={anio} onCambio={setAnio} />
      <Campo etiqueta="Mes" tipo="number" valor={mes} onCambio={setMes} />
      <Boton tipo="submit" deshabilitado={descargar.isPending}>Descargar ATS</Boton>
      {error !== null ? <div className="w-full"><Aviso tipo="error">{error}</Aviso></div> : null}
      {listo !== null ? <div className="w-full"><Aviso tipo="exito">{listo}</Aviso></div> : null}
    </form>
  );
}

// ============================================================
// src/renderer/pages/CajaPage.tsx — Turno de caja: resumen, ingresos/egresos, ventas (reimprimir y anular) y cierre ciego
// ============================================================
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useState } from "react";
import { Aviso, Modal } from "../components/Modal";
import { aNumero, Boton, Campo, Paginador, Seleccion, Tabla, mensajeDeError } from "../components/Gestion";
import { useGestion } from "../services/contexto";
import type { ReporteTurno, VentaListada } from "../services/gestion.api";
import { dinero } from "../services/totales";
import { FORMAS_PAGO } from "../services/tipos";
import { tienePermiso, useSesion } from "../store/sesion.store";

const etiquetaPago = (f: string): string => FORMAS_PAGO.find((x) => x.valor === f)?.etiqueta ?? f;

export function CajaPage(): React.JSX.Element {
  const g = useGestion();
  const turno = useSesion((s) => s.turno);
  const usuario = useSesion((s) => s.usuario);
  const fijarTurno = useSesion((s) => s.fijarTurno);
  const qc = useQueryClient();
  const [modal, setModal] = useState<"movimiento" | "cierre" | null>(null);
  const [aviso, setAviso] = useState<{ tipo: "error" | "exito"; texto: string } | null>(null);
  const [cerrado, setCerrado] = useState<ReporteTurno | null>(null);

  const reporte = useQuery({ queryKey: ["turno", "reporte", turno?.id], queryFn: () => g.reporteTurno((turno as { id: string }).id), enabled: turno !== null });

  const imprimir = async (): Promise<void> => {
    if (turno === null) return;
    try {
      await g.imprimirArqueo(turno.id);
      setAviso({ tipo: "exito", texto: "Arqueo enviado a la impresora" });
    } catch (e) {
      setAviso({ tipo: "error", texto: mensajeDeError(e) });
    }
  };

  // Tras el cierre se muestra el resultado (con el arqueo ya visible) y recién al aceptar se vuelve a la apertura de turno
  if (cerrado !== null) {
    return (
      <section aria-label="Turno cerrado" className="mx-auto max-w-lg space-y-4">
        <Aviso tipo="exito">Turno cerrado</Aviso>
        <Resumen r={cerrado} />
        <Boton variante="primario" onClick={() => { void qc.invalidateQueries({ queryKey: ["turno"] }); fijarTurno(null); }}>Aceptar</Boton>
      </section>
    );
  }
  if (turno === null) return <p className="p-6 text-slate-400">No hay un turno abierto.</p>;

  return (
    <section aria-label="Caja" className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-white">Caja</h1>
        <div className="flex gap-2">
          <Boton onClick={() => setModal("movimiento")}>Ingreso / egreso</Boton>
          <Boton onClick={() => void imprimir()}>Imprimir arqueo</Boton>
          <Boton variante="peligro" onClick={() => setModal("cierre")}>Cerrar turno</Boton>
        </div>
      </div>
      {aviso !== null ? <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso> : null}
      {reporte.isError ? <Aviso tipo="error">{mensajeDeError(reporte.error)}</Aviso> : null}
      {reporte.data !== undefined ? <Resumen r={reporte.data} /> : null}
      <VentasDelTurno turnoId={turno.id} puedeAnular={tienePermiso(usuario, "ventas:anular")} onAviso={setAviso} />
      {modal === "movimiento" ? <FormularioMovimiento turnoId={turno.id} onCerrar={() => setModal(null)} /> : null}
      {modal === "cierre" ? <FormularioCierre turnoId={turno.id} onCerrado={(r) => { setModal(null); setCerrado(r); }} onCerrar={() => setModal(null)} /> : null}
    </section>
  );
}

function Resumen({ r }: { r: ReporteTurno }): React.JSX.Element {
  const e = r.efectivo;
  return (
    <div aria-label="Resumen del turno" className="grid gap-4 md:grid-cols-2">
      <dl className="space-y-1 rounded-xl border border-slate-700 bg-slate-800/60 p-4 text-sm">
        <Fila t="Cajero" v={r.turno.cajero} />
        <Fila t="Apertura" v={`${r.turno.fechaApertura.slice(0, 16).replace("T", " ")} · ${dinero(r.turno.montoApertura)}`} />
        <Fila t={`Ventas (${r.ventas.cantidad})`} v={dinero(r.ventas.total)} />
        {r.ventas.anuladas.cantidad > 0 ? <Fila t={`Anuladas (${r.ventas.anuladas.cantidad})`} v={dinero(r.ventas.anuladas.total)} /> : null}
        <Fila t="Ingresos de caja" v={dinero(r.movimientos.ingresos)} />
        <Fila t="Egresos de caja" v={dinero(r.movimientos.egresos)} />
      </dl>
      <dl className="space-y-1 rounded-xl border border-slate-700 bg-slate-800/60 p-4 text-sm">
        <p className="mb-1 text-xs uppercase tracking-wider text-slate-400">Cobros por forma de pago</p>
        {r.porFormaPago.map((f) => <Fila key={f.formaPago} t={etiquetaPago(f.formaPago)} v={dinero(f.neto)} />)}
        {r.porFormaPago.length === 0 ? <p className="text-slate-500">Sin cobros todavía</p> : null}
        {e !== null ? (
          <div className="mt-2 border-t border-slate-700 pt-2">
            <Fila t="Efectivo esperado" v={dinero(e.esperado)} />
            {e.contado !== null ? <Fila t="Efectivo contado" v={dinero(e.contado)} /> : null}
            {e.diferencia !== null ? <Fila t="Diferencia" v={dinero(e.diferencia)} /> : null}
          </div>
        ) : <p className="mt-2 border-t border-slate-700 pt-2 text-xs text-slate-500">El efectivo esperado se muestra al cerrar (cierre ciego).</p>}
      </dl>
    </div>
  );
}

function Fila({ t, v }: { t: string; v: string }): React.JSX.Element {
  return (
    <div className="flex justify-between text-slate-300">
      <dt>{t}</dt>
      <dd className="font-medium text-white">{v}</dd>
    </div>
  );
}

function VentasDelTurno({ turnoId, puedeAnular, onAviso }: { turnoId: string; puedeAnular: boolean; onAviso: (a: { tipo: "error" | "exito"; texto: string }) => void }): React.JSX.Element {
  const g = useGestion();
  const qc = useQueryClient();
  const [pagina, setPagina] = useState(1);
  const [anular, setAnular] = useState<VentaListada | null>(null);
  const { data, isError, error } = useQuery({ queryKey: ["ventas", turnoId, pagina], queryFn: () => g.ventas(turnoId, pagina), placeholderData: (p) => p });

  const reimprimir = async (v: VentaListada): Promise<void> => {
    try {
      await g.reimprimir(v.id);
      onAviso({ tipo: "exito", texto: `Ticket ${v.numero} enviado a la impresora` });
    } catch (e) {
      onAviso({ tipo: "error", texto: mensajeDeError(e) });
    }
  };

  return (
    <div className="space-y-2">
      <h2 className="font-medium text-white">Ventas del turno</h2>
      {isError ? <Aviso tipo="error">{mensajeDeError(error)}</Aviso> : null}
      <Tabla etiqueta="Ventas del turno" filas={data?.items} clave={(v) => v.id} vacio="Todavía no hay ventas en este turno"
        columnas={[
          { titulo: "Hora", celda: (v) => v.createdAt.slice(11, 16) }, { titulo: "Número", celda: (v) => v.numero }, { titulo: "Cliente", celda: (v) => v.clienteNombre ?? "Consumidor Final" },
          { titulo: "Estado", celda: (v) => (v.estado === "ANULADA" ? <span className="text-red-300">Anulada</span> : "Completada") },
          { titulo: "Factura", celda: (v) => v.comprobante?.estado ?? "—" },
          { titulo: "Total", derecha: true, celda: (v) => dinero(v.total + v.propina) },
          { titulo: "Acciones", celda: (v) => (
            <span className="flex gap-2">
              <Boton onClick={() => void reimprimir(v)}>{`Reimprimir ${v.numero}`}</Boton>
              {puedeAnular && v.estado === "COMPLETADA" ? <Boton variante="peligro" onClick={() => setAnular(v)}>{`Anular ${v.numero}`}</Boton> : null}
            </span>
          ) },
        ]} />
      <Paginador pagina={pagina} total={data?.total ?? 0} porPagina={10} onCambio={setPagina} />
      {anular !== null ? <FormularioAnulacion venta={anular} onCerrar={() => setAnular(null)} onAnulada={async () => { await qc.invalidateQueries({ queryKey: ["ventas"] }); await qc.invalidateQueries({ queryKey: ["turno"] }); await qc.invalidateQueries({ queryKey: ["productos"] }); onAviso({ tipo: "exito", texto: `Venta ${anular.numero} anulada` }); setAnular(null); }} /> : null}
    </div>
  );
}

function FormularioAnulacion({ venta, onAnulada, onCerrar }: { venta: VentaListada; onAnulada: () => Promise<void>; onCerrar: () => void }): React.JSX.Element {
  const g = useGestion();
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => {
      if (motivo.trim().length < 5) throw new Error("El motivo debe tener al menos 5 caracteres");
      return g.anularVenta(venta.id, motivo.trim());
    },
    onSuccess: onAnulada,
    onError: (e) => setError(mensajeDeError(e)),
  });
  return (
    <Modal titulo={`Anular venta ${venta.numero}`} ancho="sm" ayuda="ESC cancela">
      <form onSubmit={(e) => { e.preventDefault(); setError(null); m.mutate(); }} className="space-y-3">
        <p className="text-sm text-slate-300">Se devuelve el inventario y se revierte el cobro. Si la factura ya fue autorizada se emite una nota de crédito.</p>
        <Campo etiqueta="Motivo de la anulación" valor={motivo} onCambio={setMotivo} autofoco />
        {error !== null ? <Aviso tipo="error">{error}</Aviso> : null}
        <div className="flex justify-end gap-2">
          <Boton onClick={onCerrar}>Cancelar</Boton>
          <Boton tipo="submit" variante="peligro" deshabilitado={m.isPending}>Anular venta</Boton>
        </div>
      </form>
    </Modal>
  );
}

function FormularioMovimiento({ turnoId, onCerrar }: { turnoId: string; onCerrar: () => void }): React.JSX.Element {
  const g = useGestion();
  const qc = useQueryClient();
  const [tipo, setTipo] = useState("EGRESO");
  const [concepto, setConcepto] = useState("");
  const [monto, setMonto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => {
      const n = aNumero(monto);
      if (n === undefined || Number.isNaN(n) || n <= 0) throw new Error("Indique un monto mayor que cero");
      return g.movimiento(turnoId, { tipo, concepto: concepto.trim(), monto: n });
    },
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["turno"] }); onCerrar(); },
    onError: (e) => setError(mensajeDeError(e)),
  });
  return (
    <Modal titulo="Ingreso o egreso de caja" ancho="sm" ayuda="ESC cancela">
      <form onSubmit={(e) => { e.preventDefault(); setError(null); m.mutate(); }} className="space-y-3">
        <Seleccion etiqueta="Tipo de movimiento" valor={tipo} onCambio={setTipo} opciones={[{ valor: "INGRESO", titulo: "Ingreso (fondo adicional)" }, { valor: "EGRESO", titulo: "Egreso (pago, retiro)" }]} />
        <Campo etiqueta="Concepto" valor={concepto} onCambio={setConcepto} autofoco />
        <Campo etiqueta="Monto" tipo="number" valor={monto} onCambio={setMonto} />
        {error !== null ? <Aviso tipo="error">{error}</Aviso> : null}
        <div className="flex justify-end gap-2">
          <Boton onClick={onCerrar}>Cancelar</Boton>
          <Boton tipo="submit" variante="primario" deshabilitado={m.isPending}>Registrar</Boton>
        </div>
      </form>
    </Modal>
  );
}

function FormularioCierre({ turnoId, onCerrado, onCerrar }: { turnoId: string; onCerrado: (r: ReporteTurno) => void; onCerrar: () => void }): React.JSX.Element {
  const g = useGestion();
  const [contado, setContado] = useState("");
  const [obs, setObs] = useState("");
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => {
      const n = aNumero(contado);
      if (n === undefined || Number.isNaN(n) || n < 0) throw new Error("Indique el efectivo contado en caja");
      return g.cerrarTurno(turnoId, { efectivoContado: n, ...(obs.trim() !== "" ? { observaciones: obs.trim() } : {}) });
    },
    onSuccess: onCerrado,
    onError: (e) => setError(mensajeDeError(e)),
  });
  return (
    <Modal titulo="Cerrar turno" ancho="sm" ayuda="ESC cancela">
      <form onSubmit={(e) => { e.preventDefault(); setError(null); m.mutate(); }} className="space-y-3">
        <p className="text-sm text-slate-300">Cuente el efectivo de la caja y escríbalo. El sistema compara con lo esperado al cerrar; no se muestra antes.</p>
        <Campo etiqueta="Efectivo contado" tipo="number" valor={contado} onCambio={setContado} autofoco />
        <Campo etiqueta="Observaciones" valor={obs} onCambio={setObs} />
        {error !== null ? <Aviso tipo="error">{error}</Aviso> : null}
        <div className="flex justify-end gap-2">
          <Boton onClick={onCerrar}>Cancelar</Boton>
          <Boton tipo="submit" variante="peligro" deshabilitado={m.isPending}>{m.isPending ? "Cerrando…" : "Cerrar turno"}</Boton>
        </div>
      </form>
    </Modal>
  );
}

// ============================================================
// src/renderer/pages/ClientesPage.tsx — Clientes (alta y edición) y cuentas por cobrar con abonos
// ============================================================
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useState } from "react";
import { Aviso, Modal } from "../components/Modal";
import { aNumero, Boton, Campo, Paginador, Pestanas, Seleccion, Tabla, mensajeDeError } from "../components/Gestion";
import { useGestion } from "../services/contexto";
import type { CuentaPorCobrar } from "../services/gestion.api";
import { dinero } from "../services/totales";
import { tienePermiso, useSesion } from "../store/sesion.store";

type Pestana = "clientes" | "cobrar";
type ClienteFila = Awaited<ReturnType<ReturnType<typeof useGestion>["clientes"]>>["items"][number];

export function ClientesPage(): React.JSX.Element {
  const [pestana, setPestana] = useState<Pestana>("clientes");
  return (
    <section aria-label="Clientes" className="space-y-4">
      <h1 className="text-xl font-semibold text-white">Clientes</h1>
      <Pestanas etiqueta="Secciones de clientes" activa={pestana} onCambio={setPestana} opciones={[{ id: "clientes", titulo: "Clientes" }, { id: "cobrar", titulo: "Cuentas por cobrar" }]} />
      {pestana === "clientes" ? <Lista /> : <PorCobrar />}
    </section>
  );
}

function Lista(): React.JSX.Element {
  const g = useGestion();
  const usuario = useSesion((s) => s.usuario);
  const [busqueda, setBusqueda] = useState("");
  const [pagina, setPagina] = useState(1);
  const [edicion, setEdicion] = useState<{ cliente: ClienteFila | null } | null>(null);
  const { data, isFetching, isError, error } = useQuery({ queryKey: ["clientes", "gestion", busqueda, pagina], queryFn: () => g.clientes(busqueda, pagina), placeholderData: (p) => p });
  return (
    <div className="space-y-3">
      <div className="flex gap-3">
        <input aria-label="Buscar cliente" placeholder="Nombre, cédula o RUC" value={busqueda} onChange={(e) => { setBusqueda(e.target.value); setPagina(1); }} className="h-10 flex-1 rounded-lg border border-slate-600 bg-slate-900 px-3 text-white" />
        {tienePermiso(usuario, "clientes:crear") ? <Boton variante="primario" onClick={() => setEdicion({ cliente: null })}>Nuevo cliente</Boton> : null}
      </div>
      {isError ? <Aviso tipo="error">{mensajeDeError(error)}</Aviso> : null}
      <Tabla etiqueta="Clientes" cargando={isFetching} filas={data?.items} clave={(c) => c.id}
        columnas={[
          { titulo: "Identificación", celda: (c) => c.identificacion },
          { titulo: "Razón social", celda: (c) => c.razonSocial },
          { titulo: "Teléfono", celda: (c) => c.telefono ?? "" },
          { titulo: "Crédito", derecha: true, celda: (c) => (c.limiteCredito > 0 ? `${dinero(c.limiteCredito)} / ${c.diasCredito} d` : "—") },
          { titulo: "Acciones", celda: (c) => (tienePermiso(usuario, "clientes:actualizar") && c.tipoIdentificacion !== "07" ? <Boton onClick={() => setEdicion({ cliente: c })}>{`Editar ${c.razonSocial}`}</Boton> : "") },
        ]} />
      <Paginador pagina={pagina} total={data?.total ?? 0} porPagina={15} onCambio={setPagina} />
      {edicion !== null ? <FormularioCliente cliente={edicion.cliente} onCerrar={() => setEdicion(null)} /> : null}
    </div>
  );
}

function FormularioCliente({ cliente, onCerrar }: { cliente: ClienteFila | null; onCerrar: () => void }): React.JSX.Element {
  const g = useGestion();
  const qc = useQueryClient();
  const [f, setF] = useState({
    tipo: cliente?.tipoIdentificacion ?? "05", identificacion: cliente?.identificacion ?? "", razonSocial: cliente?.razonSocial ?? "", email: cliente?.email ?? "",
    telefono: cliente?.telefono ?? "", direccion: cliente?.direccion ?? "", limite: String(cliente?.limiteCredito ?? 0), dias: String(cliente?.diasCredito ?? 0), descuento: String(cliente?.descuentoHabitual ?? 0),
  });
  const [error, setError] = useState<string | null>(null);
  const poner = (k: keyof typeof f) => (v: string): void => setF((x) => ({ ...x, [k]: v }));
  const guardar = useMutation({
    mutationFn: () => {
      const limite = aNumero(f.limite) ?? 0;
      const dias = aNumero(f.dias) ?? 0;
      const desc = aNumero(f.descuento) ?? 0;
      if ([limite, dias, desc].some((n) => Number.isNaN(n) || n < 0)) throw new Error("Revise el límite, los días de crédito y el descuento");
      return g.guardarCliente(cliente?.id ?? null, {
        tipoIdentificacion: f.tipo, identificacion: f.identificacion.trim(), razonSocial: f.razonSocial.trim(), limiteCredito: limite, diasCredito: Math.round(dias), descuentoHabitual: desc,
        email: f.email.trim() === "" ? null : f.email.trim(), telefono: f.telefono.trim() === "" ? null : f.telefono.trim(), direccion: f.direccion.trim() === "" ? null : f.direccion.trim(),
      });
    },
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["clientes"] }); onCerrar(); },
    onError: (e) => setError(mensajeDeError(e)),
  });
  return (
    <Modal titulo={cliente === null ? "Nuevo cliente" : `Editar ${cliente.razonSocial}`} ancho="lg" ayuda="ESC cancela">
      <form onSubmit={(e) => { e.preventDefault(); setError(null); guardar.mutate(); }} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Seleccion etiqueta="Tipo de identificación" valor={f.tipo} onCambio={poner("tipo")} opciones={[{ valor: "05", titulo: "Cédula" }, { valor: "04", titulo: "RUC" }, { valor: "06", titulo: "Pasaporte" }, { valor: "08", titulo: "Identificación del exterior" }]} />
          <Campo etiqueta="Identificación" valor={f.identificacion} onCambio={poner("identificacion")} autofoco />
          <div className="col-span-2"><Campo etiqueta="Razón social" valor={f.razonSocial} onCambio={poner("razonSocial")} /></div>
          <Campo etiqueta="Correo electrónico" tipo="email" valor={f.email} onCambio={poner("email")} />
          <Campo etiqueta="Teléfono" valor={f.telefono} onCambio={poner("telefono")} />
          <div className="col-span-2"><Campo etiqueta="Dirección" valor={f.direccion} onCambio={poner("direccion")} /></div>
          <Campo etiqueta="Límite de crédito" tipo="number" valor={f.limite} onCambio={poner("limite")} />
          <Campo etiqueta="Días de crédito" tipo="number" valor={f.dias} onCambio={poner("dias")} />
          <Campo etiqueta="Descuento habitual %" tipo="number" valor={f.descuento} onCambio={poner("descuento")} />
        </div>
        {error !== null ? <Aviso tipo="error">{error}</Aviso> : null}
        <div className="flex justify-end gap-2">
          <Boton onClick={onCerrar}>Cancelar</Boton>
          <Boton tipo="submit" variante="primario" deshabilitado={guardar.isPending}>Guardar</Boton>
        </div>
      </form>
    </Modal>
  );
}

function PorCobrar(): React.JSX.Element {
  const g = useGestion();
  const [pagina, setPagina] = useState(1);
  const [vencidas, setVencidas] = useState(false);
  const [abono, setAbono] = useState<CuentaPorCobrar | null>(null);
  const { data, isError, error } = useQuery({ queryKey: ["clientes", "cobrar", pagina, vencidas], queryFn: () => g.cuentasPorCobrar(pagina, vencidas), placeholderData: (p) => p });
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm text-slate-300">
        <input type="checkbox" aria-label="Solo vencidas" checked={vencidas} onChange={(e) => { setVencidas(e.target.checked); setPagina(1); }} /> Solo vencidas
      </label>
      {isError ? <Aviso tipo="error">{mensajeDeError(error)}</Aviso> : null}
      <Tabla etiqueta="Cuentas por cobrar" filas={data?.items} clave={(c) => c.id} vacio="No hay cuentas por cobrar"
        columnas={[
          { titulo: "Cliente", celda: (c) => c.cliente.razonSocial }, { titulo: "Venta", celda: (c) => c.venta.numero },
          { titulo: "Vence", celda: (c) => c.fechaVencimiento.slice(0, 10) }, { titulo: "Estado", celda: (c) => c.estado },
          { titulo: "Total", derecha: true, celda: (c) => dinero(c.montoTotal) }, { titulo: "Saldo", derecha: true, celda: (c) => dinero(c.saldo) },
          { titulo: "Acciones", celda: (c) => (c.saldo > 0 && c.estado !== "ANULADA" ? <Boton onClick={() => setAbono(c)}>{`Abonar ${c.venta.numero}`}</Boton> : "") },
        ]} />
      <Paginador pagina={pagina} total={data?.total ?? 0} porPagina={15} onCambio={setPagina} />
      {abono !== null ? <FormularioPago titulo={`Abono a ${abono.cliente.razonSocial}`} saldo={abono.saldo} clave="clientes" enviar={(d) => g.abonar(abono.id, d)} onCerrar={() => setAbono(null)} /> : null}
    </div>
  );
}

/** Abono (cliente) o pago (proveedor): monto, forma y referencia. */
export function FormularioPago({ titulo, saldo, clave, enviar, onCerrar }: { titulo: string; saldo: number; clave: string; enviar: (datos: Record<string, unknown>) => Promise<unknown>; onCerrar: () => void }): React.JSX.Element {
  const qc = useQueryClient();
  const [monto, setMonto] = useState(saldo.toFixed(2));
  const [forma, setForma] = useState("EFECTIVO");
  const [referencia, setReferencia] = useState("");
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => {
      const n = aNumero(monto);
      if (n === undefined || Number.isNaN(n) || n <= 0) throw new Error("Indique un monto mayor que cero");
      if (n > saldo + 0.005) throw new Error(`El monto supera el saldo (${dinero(saldo)})`);
      return enviar({ monto: n, formaPago: forma, ...(referencia.trim() !== "" ? { referencia: referencia.trim() } : {}) });
    },
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: [clave] }); onCerrar(); },
    onError: (e) => setError(mensajeDeError(e)),
  });
  return (
    <Modal titulo={titulo} ancho="sm" ayuda="ESC cancela">
      <form onSubmit={(e) => { e.preventDefault(); setError(null); m.mutate(); }} className="space-y-3">
        <p className="text-sm text-slate-400">Saldo pendiente: {dinero(saldo)}</p>
        <Campo etiqueta="Monto" tipo="number" valor={monto} onCambio={setMonto} autofoco />
        <Seleccion etiqueta="Forma de pago" valor={forma} onCambio={setForma} opciones={[{ valor: "EFECTIVO", titulo: "Efectivo" }, { valor: "TRANSFERENCIA", titulo: "Transferencia" }, { valor: "CHEQUE", titulo: "Cheque" }, { valor: "TARJETA_DEBITO", titulo: "Tarjeta de débito" }, { valor: "TARJETA_CREDITO", titulo: "Tarjeta de crédito" }]} />
        <Campo etiqueta="Referencia" valor={referencia} onCambio={setReferencia} />
        {error !== null ? <Aviso tipo="error">{error}</Aviso> : null}
        <div className="flex justify-end gap-2">
          <Boton onClick={onCerrar}>Cancelar</Boton>
          <Boton tipo="submit" variante="primario" deshabilitado={m.isPending}>Registrar</Boton>
        </div>
      </form>
    </Modal>
  );
}

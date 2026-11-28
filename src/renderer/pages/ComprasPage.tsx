// ============================================================
// src/renderer/pages/ComprasPage.tsx — Compras, proveedores y cuentas por pagar
// ============================================================
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useState } from "react";
import { Aviso, Modal } from "../components/Modal";
import { aNumero, Boton, Campo, Paginador, Pestanas, Seleccion, Tabla, mensajeDeError } from "../components/Gestion";
import { useGestion, usePos } from "../services/contexto";
import type { CuentaPorPagar, Proveedor } from "../services/gestion.api";
import type { ProductoPos } from "../services/tipos";
import { dinero, round2 } from "../services/totales";
import { tienePermiso, useSesion } from "../store/sesion.store";
import { FormularioPago } from "./ClientesPage";

type Pestana = "compras" | "proveedores" | "pagar";

export function ComprasPage(): React.JSX.Element {
  const usuario = useSesion((s) => s.usuario);
  const [pestana, setPestana] = useState<Pestana>("compras");
  const opciones = [{ id: "compras" as const, titulo: "Compras" }, ...(tienePermiso(usuario, "proveedores:leer") ? [{ id: "proveedores" as const, titulo: "Proveedores" }, { id: "pagar" as const, titulo: "Cuentas por pagar" }] : [])];
  return (
    <section aria-label="Compras" className="space-y-4">
      <h1 className="text-xl font-semibold text-ink">Compras y proveedores</h1>
      <Pestanas etiqueta="Secciones de compras" activa={pestana} onCambio={setPestana} opciones={opciones} />
      {pestana === "compras" ? <Compras /> : pestana === "proveedores" ? <Proveedores /> : <PorPagar />}
    </section>
  );
}

function Compras(): React.JSX.Element {
  const g = useGestion();
  const [busqueda, setBusqueda] = useState("");
  const [pagina, setPagina] = useState(1);
  const [nueva, setNueva] = useState(false);
  const { data, isError, error } = useQuery({ queryKey: ["compras", busqueda, pagina], queryFn: () => g.compras(busqueda, pagina), placeholderData: (p) => p });
  return (
    <div className="space-y-3">
      <div className="flex gap-3">
        <input aria-label="Buscar compra" placeholder="Proveedor o número de documento" value={busqueda} onChange={(e) => { setBusqueda(e.target.value); setPagina(1); }} className="h-10 flex-1 rounded-lg border border-slate-600 bg-slate-900 px-3 text-ink" />
        <Boton variante="primario" onClick={() => setNueva(true)}>Registrar compra</Boton>
      </div>
      {isError ? <Aviso tipo="error">{mensajeDeError(error)}</Aviso> : null}
      <Tabla etiqueta="Compras" filas={data?.items} clave={(c) => c.id} vacio="Aún no hay compras"
        columnas={[{ titulo: "Fecha", celda: (c) => c.fecha.slice(0, 10) }, { titulo: "Documento", celda: (c) => c.numeroFactura }, { titulo: "Proveedor", celda: (c) => c.proveedor }, { titulo: "Pago", celda: (c) => (c.formaPago === "CREDITO" ? "Crédito" : "Contado") }, { titulo: "Total", derecha: true, celda: (c) => dinero(c.total) }, { titulo: "Estado", celda: (c) => c.estado }]} />
      <Paginador pagina={pagina} total={data?.total ?? 0} porPagina={15} onCambio={setPagina} />
      {nueva ? <FormularioCompra onCerrar={() => setNueva(false)} /> : null}
    </div>
  );
}

interface LineaCompra {
  producto: ProductoPos;
  cantidad: string;
  costo: string;
}

function FormularioCompra({ onCerrar }: { onCerrar: () => void }): React.JSX.Element {
  const g = useGestion();
  const { api } = usePos();
  const qc = useQueryClient();
  const puntoEmision = useSesion((s) => s.puntoEmision);
  const [busquedaProveedor, setBusquedaProveedor] = useState("");
  const [proveedorId, setProveedorId] = useState("");
  const [documento, setDocumento] = useState("");
  const [tipoDocumento, setTipoDocumento] = useState("FACTURA");
  const [autorizacion, setAutorizacion] = useState("");
  const [formaPago, setFormaPago] = useState("CONTADO");
  const [dias, setDias] = useState("");
  const [lineas, setLineas] = useState<LineaCompra[]>([]);
  const [busquedaProducto, setBusquedaProducto] = useState("");
  const [error, setError] = useState<string | null>(null);

  const proveedores = useQuery({ queryKey: ["proveedores", "selector", busquedaProveedor], queryFn: () => g.proveedores(busquedaProveedor) });
  const productos = useQuery({ queryKey: ["productos", "compra", busquedaProducto], queryFn: () => api.productos(busquedaProducto, 6), enabled: busquedaProducto.trim().length >= 2 });
  const total = round2(lineas.reduce((a, l) => a + (aNumero(l.cantidad) ?? 0) * (aNumero(l.costo) ?? 0), 0));

  const registrar = useMutation({
    mutationFn: () => {
      if (proveedorId === "") throw new Error("Elija el proveedor");
      if (puntoEmision === null) throw new Error("No hay una sucursal activa: abra el turno de caja");
      if (lineas.length === 0) throw new Error("Agregue al menos un producto");
      const items = lineas.map((l) => ({ productoId: l.producto.id, cantidad: aNumero(l.cantidad), costoUnitario: aNumero(l.costo) }));
      if (items.some((i) => i.cantidad === undefined || Number.isNaN(i.cantidad) || (i.cantidad ?? 0) <= 0 || i.costoUnitario === undefined || Number.isNaN(i.costoUnitario) || (i.costoUnitario ?? 0) <= 0)) throw new Error("Cada línea necesita cantidad y costo mayores que cero");
      const d = aNumero(dias);
      return g.crearCompra({ proveedorId, sucursalId: puntoEmision.sucursal.id, numeroFactura: documento.trim(), tipoDocumento, formaPago, lineas: items, ...(autorizacion.trim() !== "" ? { autorizacion: autorizacion.trim() } : {}), ...(formaPago === "CREDITO" && d !== undefined && !Number.isNaN(d) ? { diasCredito: Math.round(d) } : {}) });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["compras"] });
      await qc.invalidateQueries({ queryKey: ["productos"] });
      await qc.invalidateQueries({ queryKey: ["pagar"] });
      onCerrar();
    },
    onError: (e) => setError(mensajeDeError(e)),
  });

  const ponerLinea = (i: number, cambios: Partial<LineaCompra>): void => setLineas((ls) => ls.map((l, k) => (k === i ? { ...l, ...cambios } : l)));

  return (
    <Modal titulo="Registrar compra" ancho="lg" ayuda="ESC cancela">
      <form onSubmit={(e) => { e.preventDefault(); setError(null); registrar.mutate(); }} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Campo etiqueta="Buscar proveedor" valor={busquedaProveedor} onCambio={setBusquedaProveedor} autofoco />
            <Seleccion etiqueta="Proveedor" valor={proveedorId} onCambio={setProveedorId} opciones={[{ valor: "", titulo: "— Elija —" }, ...(proveedores.data?.items ?? []).filter((p) => p.status === "ACTIVO").map((p) => ({ valor: p.id, titulo: `${p.razonSocial} (${p.ruc})` }))]} />
          </div>
          <div className="space-y-3">
            <Campo etiqueta="Número de documento" valor={documento} onCambio={setDocumento} placeholder="001-001-000000123" />
            <Seleccion etiqueta="Tipo de documento" valor={tipoDocumento} onCambio={setTipoDocumento} opciones={[{ valor: "FACTURA", titulo: "Factura" }, { valor: "NOTA_VENTA", titulo: "Nota de venta" }, { valor: "LIQUIDACION", titulo: "Liquidación de compra (la emito yo)" }]} />
          </div>
          <Campo etiqueta="Autorización del proveedor" valor={autorizacion} onCambio={setAutorizacion} placeholder="10 a 49 dígitos (opcional)" />
          <div className="grid grid-cols-2 gap-3">
            <Seleccion etiqueta="Forma de pago" valor={formaPago} onCambio={setFormaPago} opciones={[{ valor: "CONTADO", titulo: "Contado" }, { valor: "CREDITO", titulo: "Crédito" }]} />
            {formaPago === "CREDITO" ? <Campo etiqueta="Días de crédito" tipo="number" valor={dias} onCambio={setDias} placeholder="Los del proveedor" /> : <span />}
          </div>
        </div>

        <div className="rounded-xl border border-slate-700 p-3">
          <Campo etiqueta="Buscar producto a comprar" valor={busquedaProducto} onCambio={setBusquedaProducto} placeholder="Nombre o código (mínimo 2 letras)" />
          <ul className="mt-2 flex flex-wrap gap-2">
            {(productos.data?.items ?? []).filter((p) => p.tipo === "BIEN").map((p) => (
              <li key={p.id}>
                <Boton onClick={() => { setLineas((ls) => (ls.some((l) => l.producto.id === p.id) ? ls : [...ls, { producto: p, cantidad: "1", costo: "" }])); setBusquedaProducto(""); }}>{`Agregar ${p.nombre}`}</Boton>
              </li>
            ))}
          </ul>
          <ul className="mt-3 space-y-2" aria-label="Productos de la compra">
            {lineas.map((l, i) => (
              <li key={l.producto.id} className="grid grid-cols-[1fr_6rem_7rem_auto] items-end gap-2">
                <span className="text-sm text-ink">{l.producto.nombre}</span>
                <Campo etiqueta={`Cantidad de ${l.producto.nombre}`} tipo="number" valor={l.cantidad} onCambio={(v) => ponerLinea(i, { cantidad: v })} />
                <Campo etiqueta={`Costo de ${l.producto.nombre}`} tipo="number" valor={l.costo} onCambio={(v) => ponerLinea(i, { costo: v })} />
                <Boton variante="peligro" onClick={() => setLineas((ls) => ls.filter((_, k) => k !== i))}>{`Quitar ${l.producto.nombre}`}</Boton>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-right text-sm text-slate-300">Subtotal sin IVA: <strong className="text-ink">{dinero(total)}</strong></p>
        </div>
        {error !== null ? <Aviso tipo="error">{error}</Aviso> : null}
        <div className="flex justify-end gap-2">
          <Boton onClick={onCerrar}>Cancelar</Boton>
          <Boton tipo="submit" variante="primario" deshabilitado={registrar.isPending}>{registrar.isPending ? "Registrando…" : "Registrar compra"}</Boton>
        </div>
      </form>
    </Modal>
  );
}

function Proveedores(): React.JSX.Element {
  const g = useGestion();
  const usuario = useSesion((s) => s.usuario);
  const [busqueda, setBusqueda] = useState("");
  const [pagina, setPagina] = useState(1);
  const [edicion, setEdicion] = useState<{ proveedor: Proveedor | null } | null>(null);
  const { data, isError, error } = useQuery({ queryKey: ["proveedores", busqueda, pagina], queryFn: () => g.proveedores(busqueda, pagina), placeholderData: (p) => p });
  return (
    <div className="space-y-3">
      <div className="flex gap-3">
        <input aria-label="Buscar proveedor" placeholder="Razón social o RUC" value={busqueda} onChange={(e) => { setBusqueda(e.target.value); setPagina(1); }} className="h-10 flex-1 rounded-lg border border-slate-600 bg-slate-900 px-3 text-ink" />
        {tienePermiso(usuario, "proveedores:crear") ? <Boton variante="primario" onClick={() => setEdicion({ proveedor: null })}>Nuevo proveedor</Boton> : null}
      </div>
      {isError ? <Aviso tipo="error">{mensajeDeError(error)}</Aviso> : null}
      <Tabla etiqueta="Proveedores" filas={data?.items} clave={(p) => p.id}
        columnas={[{ titulo: "RUC", celda: (p) => p.ruc }, { titulo: "Razón social", celda: (p) => p.razonSocial }, { titulo: "Teléfono", celda: (p) => p.telefono ?? "" }, { titulo: "Plazo", derecha: true, celda: (p) => `${p.diasPago} d` }, { titulo: "Estado", celda: (p) => p.status }, { titulo: "Acciones", celda: (p) => (tienePermiso(usuario, "proveedores:actualizar") ? <Boton onClick={() => setEdicion({ proveedor: p })}>{`Editar ${p.razonSocial}`}</Boton> : "") }]} />
      <Paginador pagina={pagina} total={data?.total ?? 0} porPagina={15} onCambio={setPagina} />
      {edicion !== null ? <FormularioProveedor proveedor={edicion.proveedor} onCerrar={() => setEdicion(null)} /> : null}
    </div>
  );
}

function FormularioProveedor({ proveedor, onCerrar }: { proveedor: Proveedor | null; onCerrar: () => void }): React.JSX.Element {
  const g = useGestion();
  const qc = useQueryClient();
  const [f, setF] = useState({ ruc: proveedor?.ruc ?? "", razonSocial: proveedor?.razonSocial ?? "", email: proveedor?.email ?? "", telefono: proveedor?.telefono ?? "", diasPago: String(proveedor?.diasPago ?? 30), status: proveedor?.status ?? "ACTIVO" });
  const [error, setError] = useState<string | null>(null);
  const poner = (k: keyof typeof f) => (v: string): void => setF((x) => ({ ...x, [k]: v }));
  const guardar = useMutation({
    mutationFn: () => {
      const dias = aNumero(f.diasPago) ?? 0;
      if (Number.isNaN(dias) || dias < 0) throw new Error("El plazo de pago no es válido");
      return g.guardarProveedor(proveedor?.id ?? null, { ruc: f.ruc.trim(), razonSocial: f.razonSocial.trim(), email: f.email.trim() === "" ? null : f.email.trim(), telefono: f.telefono.trim() === "" ? null : f.telefono.trim(), diasPago: Math.round(dias), ...(proveedor !== null ? { status: f.status } : {}) });
    },
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["proveedores"] }); onCerrar(); },
    onError: (e) => setError(mensajeDeError(e)),
  });
  return (
    <Modal titulo={proveedor === null ? "Nuevo proveedor" : `Editar ${proveedor.razonSocial}`} ancho="md" ayuda="ESC cancela">
      <form onSubmit={(e) => { e.preventDefault(); setError(null); guardar.mutate(); }} className="space-y-3">
        <Campo etiqueta="RUC" valor={f.ruc} onCambio={poner("ruc")} autofoco />
        <Campo etiqueta="Razón social" valor={f.razonSocial} onCambio={poner("razonSocial")} />
        <div className="grid grid-cols-2 gap-3">
          <Campo etiqueta="Correo electrónico" tipo="email" valor={f.email} onCambio={poner("email")} />
          <Campo etiqueta="Teléfono" valor={f.telefono} onCambio={poner("telefono")} />
          <Campo etiqueta="Plazo de pago (días)" tipo="number" valor={f.diasPago} onCambio={poner("diasPago")} />
          {proveedor !== null ? <Seleccion etiqueta="Estado" valor={f.status} onCambio={poner("status")} opciones={[{ valor: "ACTIVO", titulo: "Activo" }, { valor: "INACTIVO", titulo: "Inactivo" }]} /> : null}
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

function PorPagar(): React.JSX.Element {
  const g = useGestion();
  const usuario = useSesion((s) => s.usuario);
  const [pagina, setPagina] = useState(1);
  const [vencidas, setVencidas] = useState(false);
  const [pago, setPago] = useState<CuentaPorPagar | null>(null);
  const { data, isError, error } = useQuery({ queryKey: ["pagar", pagina, vencidas], queryFn: () => g.cuentasPorPagar(pagina, vencidas), placeholderData: (p) => p });
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm text-slate-300">
        <input type="checkbox" aria-label="Solo vencidas" checked={vencidas} onChange={(e) => { setVencidas(e.target.checked); setPagina(1); }} /> Solo vencidas
      </label>
      {isError ? <Aviso tipo="error">{mensajeDeError(error)}</Aviso> : null}
      <Tabla etiqueta="Cuentas por pagar" filas={data?.items} clave={(c) => c.id} vacio="No hay cuentas por pagar"
        columnas={[{ titulo: "Proveedor", celda: (c) => c.proveedor.razonSocial }, { titulo: "Documento", celda: (c) => c.compra.numeroFactura }, { titulo: "Vence", celda: (c) => c.fechaVencimiento.slice(0, 10) }, { titulo: "Estado", celda: (c) => c.estado }, { titulo: "Total", derecha: true, celda: (c) => dinero(c.montoTotal) }, { titulo: "Saldo", derecha: true, celda: (c) => dinero(c.saldo) }, { titulo: "Acciones", celda: (c) => (c.saldo > 0 && c.estado !== "ANULADA" && tienePermiso(usuario, "proveedores:actualizar") ? <Boton onClick={() => setPago(c)}>{`Pagar ${c.compra.numeroFactura}`}</Boton> : "") }]} />
      <Paginador pagina={pagina} total={data?.total ?? 0} porPagina={15} onCambio={setPagina} />
      {pago !== null ? <FormularioPago titulo={`Pago a ${pago.proveedor.razonSocial}`} saldo={pago.saldo} clave="pagar" enviar={(d) => g.pagar(pago.id, d)} onCerrar={() => setPago(null)} /> : null}
    </div>
  );
}

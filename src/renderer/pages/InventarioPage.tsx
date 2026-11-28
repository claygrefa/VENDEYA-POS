// ============================================================
// src/renderer/pages/InventarioPage.tsx — Productos, kardex, ajustes y alertas de stock y vencimiento
// ============================================================
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useState } from "react";
import { TARIFAS_IVA } from "../../shared/constants/sri.constants";
import { Aviso, Modal } from "../components/Modal";
import { aNumero, Boton, Campo, Casilla, Paginador, Pestanas, Seleccion, Tabla, mensajeDeError } from "../components/Gestion";
import { useGestion } from "../services/contexto";
import type { ProductoGestion } from "../services/gestion.api";
import { cantidadTexto, dinero } from "../services/totales";
import { tienePermiso, useSesion } from "../store/sesion.store";

type Pestana = "productos" | "alertas";

export function InventarioPage(): React.JSX.Element {
  const [pestana, setPestana] = useState<Pestana>("productos");
  return (
    <section aria-label="Inventario" className="space-y-4">
      <h1 className="text-xl font-semibold text-ink">Inventario</h1>
      <Pestanas etiqueta="Secciones del inventario" activa={pestana} onCambio={setPestana} opciones={[{ id: "productos", titulo: "Productos" }, { id: "alertas", titulo: "Alertas" }]} />
      {pestana === "productos" ? <Productos /> : <Alertas />}
    </section>
  );
}

function Productos(): React.JSX.Element {
  const g = useGestion();
  const usuario = useSesion((s) => s.usuario);
  const puedeCrear = tienePermiso(usuario, "inventario:crear");
  const [busqueda, setBusqueda] = useState("");
  const [pagina, setPagina] = useState(1);
  const [modal, setModal] = useState<{ tipo: "producto"; producto: ProductoGestion | null } | { tipo: "ajuste"; producto: ProductoGestion } | { tipo: "kardex"; producto: ProductoGestion } | null>(null);
  const { data, isFetching, isError, error } = useQuery({ queryKey: ["productos", "gestion", busqueda, pagina], queryFn: () => g.productos(busqueda, pagina), placeholderData: (p) => p });

  return (
    <div className="space-y-3">
      <div className="flex gap-3">
        <input aria-label="Buscar producto" placeholder="Nombre, código o código de barras" value={busqueda} onChange={(e) => { setBusqueda(e.target.value); setPagina(1); }} className="h-10 flex-1 rounded-lg border border-slate-600 bg-slate-900 px-3 text-ink" />
        {puedeCrear ? <Boton variante="primario" onClick={() => setModal({ tipo: "producto", producto: null })}>Nuevo producto</Boton> : null}
      </div>
      {isError ? <Aviso tipo="error">{mensajeDeError(error)}</Aviso> : null}
      <Tabla
        etiqueta="Productos"
        cargando={isFetching}
        filas={data?.items}
        clave={(p) => p.id}
        columnas={[
          { titulo: "Código", celda: (p) => p.codigo },
          { titulo: "Producto", celda: (p) => p.nombre },
          { titulo: "Existencia", derecha: true, celda: (p) => (p.tipo === "BIEN" ? <span className={p.stockActual <= p.stockMinimo ? "text-amber-300" : ""}>{`${cantidadTexto(p.stockActual)} ${p.unidadMedida.codigo}`}</span> : "—") },
          { titulo: "Mínimo", derecha: true, celda: (p) => cantidadTexto(p.stockMinimo) },
          { titulo: "Precio", derecha: true, celda: (p) => dinero(p.precioVenta) },
          {
            titulo: "Acciones",
            celda: (p) => (
              <span className="flex gap-2">
                <Boton onClick={() => setModal({ tipo: "producto", producto: p })}>{`Editar ${p.nombre}`}</Boton>
                {p.tipo === "BIEN" ? <Boton onClick={() => setModal({ tipo: "kardex", producto: p })}>{`Kardex ${p.nombre}`}</Boton> : null}
                {p.tipo === "BIEN" ? <Boton onClick={() => setModal({ tipo: "ajuste", producto: p })}>{`Ajustar ${p.nombre}`}</Boton> : null}
              </span>
            ),
          },
        ]}
      />
      <Paginador pagina={pagina} total={data?.total ?? 0} porPagina={15} onCambio={setPagina} />
      {modal?.tipo === "producto" ? <FormularioProducto producto={modal.producto} onCerrar={() => setModal(null)} /> : null}
      {modal?.tipo === "ajuste" ? <FormularioAjuste producto={modal.producto} onCerrar={() => setModal(null)} /> : null}
      {modal?.tipo === "kardex" ? <VistaKardex producto={modal.producto} onCerrar={() => setModal(null)} /> : null}
    </div>
  );
}

function FormularioProducto({ producto, onCerrar }: { producto: ProductoGestion | null; onCerrar: () => void }): React.JSX.Element {
  const g = useGestion();
  const qc = useQueryClient();
  const catalogos = useQuery({ queryKey: ["catalogos"], queryFn: () => g.catalogos(), staleTime: 300_000 });
  const [f, setF] = useState({
    codigo: producto?.codigo ?? "",
    codigoBarras: producto?.codigoBarras ?? "",
    nombre: producto?.nombre ?? "",
    tipo: producto?.tipo ?? "BIEN",
    categoriaId: producto?.categoriaId ?? "",
    unidadMedidaId: producto?.unidadMedidaId ?? "",
    precioCompra: String(producto?.precioCompra ?? 0),
    precioVenta: producto === null ? "" : String(producto.precioVenta),
    stockMinimo: String(producto?.stockMinimo ?? 0),
    aplicaIva: producto?.aplicaIva ?? true,
    codigoIvaSRI: producto?.codigoIvaSRI ?? "4",
    requiereLote: producto?.requiereLote ?? false,
    tieneVencimiento: producto?.tieneVencimiento ?? false,
  });
  const [error, setError] = useState<string | null>(null);
  const cat = f.categoriaId !== "" ? f.categoriaId : (catalogos.data?.categorias[0]?.id ?? "");
  const uni = f.unidadMedidaId !== "" ? f.unidadMedidaId : (catalogos.data?.unidades.find((u) => u.codigo === "UN")?.id ?? catalogos.data?.unidades[0]?.id ?? "");
  const poner = <K extends keyof typeof f>(k: K) => (v: (typeof f)[K]): void => setF((x) => ({ ...x, [k]: v }));

  const guardar = useMutation({
    mutationFn: () => {
      const venta = aNumero(f.precioVenta);
      const compra = aNumero(f.precioCompra) ?? 0;
      const minimo = aNumero(f.stockMinimo) ?? 0;
      if (venta === undefined || Number.isNaN(venta) || venta <= 0) throw new Error("El precio de venta debe ser mayor que cero");
      if (Number.isNaN(compra) || compra < 0 || Number.isNaN(minimo) || minimo < 0) throw new Error("Revise el costo y el stock mínimo");
      return g.guardarProducto(producto?.id ?? null, {
        codigo: f.codigo.trim(), codigoBarras: f.codigoBarras.trim() === "" ? null : f.codigoBarras.trim(), nombre: f.nombre.trim(), tipo: f.tipo,
        categoriaId: cat, unidadMedidaId: uni, precioCompra: compra, precioVenta: venta, stockMinimo: minimo,
        aplicaIva: f.aplicaIva, codigoIvaSRI: f.aplicaIva ? f.codigoIvaSRI : "0", requiereLote: f.requiereLote, tieneVencimiento: f.tieneVencimiento,
      });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["productos"] });
      onCerrar();
    },
    onError: (e) => setError(mensajeDeError(e)),
  });

  return (
    <Modal titulo={producto === null ? "Nuevo producto" : `Editar ${producto.nombre}`} ancho="lg" ayuda="ESC cancela">
      <form onSubmit={(e) => { e.preventDefault(); setError(null); guardar.mutate(); }} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Campo etiqueta="Código" valor={f.codigo} onCambio={poner("codigo")} autofoco />
          <Campo etiqueta="Código de barras" valor={f.codigoBarras} onCambio={poner("codigoBarras")} />
          <div className="col-span-2"><Campo etiqueta="Nombre" valor={f.nombre} onCambio={poner("nombre")} /></div>
          <Seleccion etiqueta="Tipo" valor={f.tipo} onCambio={poner("tipo")} opciones={[{ valor: "BIEN", titulo: "Bien (con inventario)" }, { valor: "SERVICIO", titulo: "Servicio" }]} />
          <Seleccion etiqueta="Categoría" valor={cat} onCambio={poner("categoriaId")} opciones={(catalogos.data?.categorias ?? []).map((c) => ({ valor: c.id, titulo: c.nombre }))} />
          <Seleccion etiqueta="Unidad de medida" valor={uni} onCambio={poner("unidadMedidaId")} opciones={(catalogos.data?.unidades ?? []).map((u) => ({ valor: u.id, titulo: `${u.nombre} (${u.codigo})` }))} />
          <Campo etiqueta="Stock mínimo" tipo="number" valor={f.stockMinimo} onCambio={poner("stockMinimo")} />
          <Campo etiqueta="Costo de compra" tipo="number" valor={f.precioCompra} onCambio={poner("precioCompra")} />
          <Campo etiqueta="Precio de venta (sin IVA)" tipo="number" valor={f.precioVenta} onCambio={poner("precioVenta")} />
        </div>
        <div className="flex flex-wrap items-end gap-6">
          <Casilla etiqueta="Aplica IVA" marcada={f.aplicaIva} onCambio={poner("aplicaIva")} />
          {f.aplicaIva ? <Seleccion etiqueta="Tarifa de IVA" valor={f.codigoIvaSRI} onCambio={poner("codigoIvaSRI")} opciones={TARIFAS_IVA.filter((t) => t.vigente && t.porcentaje > 0).map((t) => ({ valor: t.codigo, titulo: t.descripcion }))} /> : null}
          <Casilla etiqueta="Maneja lotes" marcada={f.requiereLote} onCambio={poner("requiereLote")} />
          <Casilla etiqueta="Tiene vencimiento" marcada={f.tieneVencimiento} onCambio={poner("tieneVencimiento")} />
        </div>
        {error !== null ? <Aviso tipo="error">{error}</Aviso> : null}
        <div className="flex justify-end gap-2">
          <Boton onClick={onCerrar}>Cancelar</Boton>
          <Boton tipo="submit" variante="primario" deshabilitado={guardar.isPending}>{guardar.isPending ? "Guardando…" : "Guardar"}</Boton>
        </div>
      </form>
    </Modal>
  );
}

function FormularioAjuste({ producto, onCerrar }: { producto: ProductoGestion; onCerrar: () => void }): React.JSX.Element {
  const g = useGestion();
  const qc = useQueryClient();
  const [tipo, setTipo] = useState("ENTRADA");
  const [cantidad, setCantidad] = useState("");
  const [costo, setCosto] = useState(String(producto.precioCompra));
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const ajustar = useMutation({
    mutationFn: () => {
      const c = aNumero(cantidad);
      if (c === undefined || Number.isNaN(c) || c <= 0) throw new Error("Indique una cantidad mayor que cero");
      const costoNum = aNumero(costo);
      return g.ajustar({ productoId: producto.id, tipo, cantidad: c, motivo: motivo.trim(), ...(tipo === "ENTRADA" ? { costoUnitario: costoNum ?? 0 } : {}) });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["productos"] });
      onCerrar();
    },
    onError: (e) => setError(mensajeDeError(e)),
  });
  return (
    <Modal titulo={`Ajuste de ${producto.nombre}`} ayuda="ESC cancela" ancho="sm">
      <form onSubmit={(e) => { e.preventDefault(); setError(null); ajustar.mutate(); }} className="space-y-3">
        <p className="text-sm text-slate-400">Existencia actual: {cantidadTexto(producto.stockActual)} {producto.unidadMedida.codigo}</p>
        <Seleccion etiqueta="Tipo de ajuste" valor={tipo} onCambio={setTipo} opciones={[{ valor: "ENTRADA", titulo: "Entrada (suma)" }, { valor: "SALIDA", titulo: "Salida (resta: merma, rotura…)" }]} />
        <Campo etiqueta="Cantidad" tipo="number" valor={cantidad} onCambio={setCantidad} autofoco />
        {tipo === "ENTRADA" ? <Campo etiqueta="Costo unitario" tipo="number" valor={costo} onCambio={setCosto} /> : null}
        <Campo etiqueta="Motivo" valor={motivo} onCambio={setMotivo} placeholder="Mínimo 5 caracteres" />
        {error !== null ? <Aviso tipo="error">{error}</Aviso> : null}
        <div className="flex justify-end gap-2">
          <Boton onClick={onCerrar}>Cancelar</Boton>
          <Boton tipo="submit" variante="primario" deshabilitado={ajustar.isPending}>Registrar ajuste</Boton>
        </div>
      </form>
    </Modal>
  );
}

function VistaKardex({ producto, onCerrar }: { producto: ProductoGestion; onCerrar: () => void }): React.JSX.Element {
  const g = useGestion();
  const [pagina, setPagina] = useState(1);
  const { data, isError, error } = useQuery({ queryKey: ["kardex", producto.id, pagina], queryFn: () => g.kardex(producto.id, pagina), placeholderData: (p) => p });
  return (
    <Modal titulo={`Kardex de ${producto.nombre}`} ancho="lg" ayuda="ESC cierra">
      {data !== undefined ? (
        <p className="mb-3 text-sm text-slate-300">
          Existencia: <strong className="text-ink">{cantidadTexto(data.producto.stockActual)}</strong> · Costo promedio: <strong className="text-ink">{dinero(data.producto.costoPromedio)}</strong>
        </p>
      ) : null}
      {isError ? <Aviso tipo="error">{mensajeDeError(error)}</Aviso> : null}
      <Tabla
        etiqueta="Movimientos de kardex"
        filas={data?.items}
        clave={(m) => m.id}
        vacio="Sin movimientos"
        columnas={[
          { titulo: "Fecha", celda: (m) => m.fecha.slice(0, 16).replace("T", " ") },
          { titulo: "Movimiento", celda: (m) => m.tipoMovimiento.replace("_", " ") },
          { titulo: "Cantidad", derecha: true, celda: (m) => cantidadTexto(m.cantidad) },
          { titulo: "Costo", derecha: true, celda: (m) => dinero(m.costoUnitario) },
          { titulo: "Saldo", derecha: true, celda: (m) => cantidadTexto(m.stockResultante) },
          { titulo: "Detalle", celda: (m) => m.observacion ?? "" },
        ]}
      />
      <Paginador pagina={pagina} total={data?.total ?? 0} porPagina={10} onCambio={setPagina} />
      <div className="mt-3 flex justify-end"><Boton onClick={onCerrar}>Cerrar</Boton></div>
    </Modal>
  );
}

function Alertas(): React.JSX.Element {
  const g = useGestion();
  const stock = useQuery({ queryKey: ["productos", "alertas-stock"], queryFn: () => g.alertasStock() });
  const venc = useQuery({ queryKey: ["productos", "alertas-vencimiento"], queryFn: () => g.alertasVencimiento(30), retry: false });
  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-2 font-medium text-ink">Stock bajo el mínimo</h2>
        <Tabla etiqueta="Productos bajo el mínimo" filas={stock.data?.items} clave={(a) => a.productoId} vacio="Todo el inventario está sobre su mínimo"
          columnas={[{ titulo: "Código", celda: (a) => a.codigo }, { titulo: "Producto", celda: (a) => a.nombre }, { titulo: "Existencia", derecha: true, celda: (a) => cantidadTexto(a.stockActual) }, { titulo: "Mínimo", derecha: true, celda: (a) => cantidadTexto(a.stockMinimo) }, { titulo: "Faltan", derecha: true, celda: (a) => cantidadTexto(a.faltante) }]} />
      </div>
      <div>
        <h2 className="mb-2 font-medium text-ink">Lotes vencidos y por vencer (30 días)</h2>
        {venc.isError ? <Aviso tipo="info">{mensajeDeError(venc.error)}</Aviso> : (
          <Tabla etiqueta="Lotes por vencer" filas={[...(venc.data?.vencidos ?? []), ...(venc.data?.porVencer ?? [])]} clave={(l) => l.loteId} vacio="No hay lotes vencidos ni por vencer"
            columnas={[{ titulo: "Producto", celda: (l) => `${l.codigo} · ${l.nombre}` }, { titulo: "Lote", celda: (l) => l.numeroLote }, { titulo: "Existencia", derecha: true, celda: (l) => cantidadTexto(l.cantidadActual) }, { titulo: "Vence", celda: (l) => String(l.fechaVencimiento).slice(0, 10) }, { titulo: "Estado", celda: (l) => (l.diasRestantes < 0 ? <span className="text-red-300">Vencido hace {-l.diasRestantes} día(s)</span> : <span className="text-amber-300">Vence en {l.diasRestantes} día(s)</span>) }]} />
        )}
      </div>
    </div>
  );
}

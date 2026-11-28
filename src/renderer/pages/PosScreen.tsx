// ============================================================
// src/renderer/pages/PosScreen.tsx — Pantalla principal de venta
//
// Teclado: F2 buscar · F4 cliente · F6 carritos en espera · F8 cobrar · ESC cierra/cancela.
// Escáner: una ráfaga rápida terminada en Enter se resuelve en el servidor (producto, presentación o etiqueta de balanza);
// lo que escribe una persona se busca como texto.
// ============================================================
import { useQueryClient } from "@tanstack/react-query";
import { Pause } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CobroPendienteSchema, type CobroPendiente } from "../../shared/schemas/venta.schema";
import { BuscadorProductos } from "../components/BuscadorProductos";
import { CarritoPanel } from "../components/CarritoPanel";
import { guardarArchivo } from "../components/Gestion";
import { Aviso, Modal } from "../components/Modal";
import { ModalCarritosEnEspera } from "../components/ModalCarritosEnEspera";
import { ModalCliente } from "../components/ModalCliente";
import { ModalCobro, type DatosCobro } from "../components/ModalCobro";
import { ModalLinea, type ResultadoLinea } from "../components/ModalLinea";
import { claveProductos, useBalanza } from "../hooks/consultas";
import { useAtajos } from "../hooks/useAtajos";
import { useEscaneo } from "../hooks/useEscaneo";
import { ApiError } from "../services/api";
import { guardarCarritosEnEspera, leerCarritosEnEspera, type CarritoEnEspera } from "../services/carritosEnEspera";
import { operarCobroPendiente } from "../services/cobroPendiente";
import { usePos } from "../services/contexto";
import type { PresentacionPos, ProductoPos, VentaEmitidaPos } from "../services/tipos";
import { calcularCarrito, dinero, type LineaCarrito } from "../services/totales";
import { useCarrito } from "../store/carrito.store";
import { useSesion } from "../store/sesion.store";

type Modal =
  | { tipo: "cobro" }
  | { tipo: "cliente" }
  | { tipo: "espera"; carritos: CarritoEnEspera[]; error: string | null }
  | { tipo: "linea"; clave: string }
  | { tipo: "nueva"; producto: ProductoPos; presentacion: PresentacionPos | null };

const UNIDADES_DE_PESO = ["KG", "LB", "G"];

export function PosScreen(): React.JSX.Element {
  const { api } = usePos();
  const qc = useQueryClient();
  const tactil = useSesion((s) => s.modoTactil);
  const punto = useSesion((s) => s.puntoEmision);
  const usuario = useSesion((s) => s.usuario);
  const fijarTurno = useSesion((s) => s.fijarTurno);
  const lineas = useCarrito((s) => s.lineas);
  const cliente = useCarrito((s) => s.cliente);
  const carrito = useCarrito;
  const calculo = useMemo(() => calcularCarrito(lineas), [lineas]);
  const balanza = useBalanza();

  const [busqueda, setBusqueda] = useState("");
  const [categoriaId, setCategoriaId] = useState<string>();
  const [modal, setModal] = useState<Modal | null>(null);
  const [aviso, setAviso] = useState<{ tipo: "error" | "exito" | "info"; texto: string } | null>(null);
  const [confirmacion, setConfirmacion] = useState<VentaEmitidaPos | null>(null);
  const [errorCobro, setErrorCobro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [pendiente, setPendiente] = useState<CobroPendiente | null>(null);
  const [confirmandoDescarte, setConfirmandoDescarte] = useState(false);
  const [estadoAlmacen, setEstadoAlmacen] = useState<"leyendo" | "listo" | "error">("leyendo");
  const enCurso = useRef(false);
  const revisionCarrito = useRef(0);
  const refBusqueda = useRef<HTMLInputElement>(null);
  const modalAbierto = useRef(false);
  modalAbierto.current = modal !== null || pendiente !== null || estadoAlmacen !== "listo";

  useEffect(() => {
    if (usuario === null) return;
    let activo = true;
    setEstadoAlmacen("leyendo");
    void operarCobroPendiente(usuario, { tipo: "leer" }).then((cobro) => {
      if (!activo) return;
      setPendiente(cobro);
      setEstadoAlmacen("listo");
    }).catch(() => {
      if (activo) setEstadoAlmacen("error");
    });
    return () => { activo = false; };
  }, [usuario]);

  // Los avisos se retiran solos (los errores duran más)
  useEffect(() => {
    if (aviso === null) return;
    const t = setTimeout(() => setAviso(null), aviso.tipo === "error" ? 7_000 : 3_000);
    return () => clearTimeout(t);
  }, [aviso]);

  const enfocarBusqueda = useCallback((): void => {
    refBusqueda.current?.focus();
    refBusqueda.current?.select();
  }, []);

  // ── Agregar al carrito ─────────────────────────────────────

  const elegirProducto = useCallback(
    (producto: ProductoPos, presentacion: PresentacionPos | null = null, cantidad?: number): void => {
      setConfirmacion(null);
      // Productos a granel: se pide el peso o la cantidad antes de agregarlos
      if (cantidad === undefined && presentacion === null && producto.unidadMedida.permiteDecimales) {
        setModal({ tipo: "nueva", producto, presentacion });
        return;
      }
      carrito.getState().agregar({ producto, presentacion, cantidad: cantidad ?? 1 });
      setBusqueda("");
    },
    [carrito]
  );

  const escanear = useCallback(
    async (codigo: string): Promise<void> => {
      if (modalAbierto.current) return; // con un diálogo abierto el lector no debe tocar el carrito de fondo
      const revision = revisionCarrito.current;
      setBusqueda("");
      try {
        const r = await api.escanear(codigo);
        if (modalAbierto.current || revision !== revisionCarrito.current) return;
        if (r.tipo === "PRODUCTO") elegirProducto(r.producto);
        else elegirProducto(r.producto, r.presentacion, r.cantidad);
        if (r.tipo === "BALANZA") setAviso({ tipo: "exito", texto: `${r.producto.nombre}: ${r.cantidad} ${r.producto.unidadMedida.codigo}` });
      } catch (e) {
        setAviso({ tipo: "error", texto: e instanceof ApiError ? e.message : "No se pudo leer el código" });
      }
    },
    [api, elegirProducto]
  );

  const digitar = useCallback(
    async (texto: string): Promise<void> => {
      if (modalAbierto.current) return;
      const revision = revisionCarrito.current;
      const t = texto.trim();
      try {
        const r = await qc.fetchQuery({ queryKey: claveProductos(t, categoriaId), queryFn: () => api.productos(t, undefined, categoriaId), staleTime: 15_000 });
        if (modalAbierto.current || revision !== revisionCarrito.current) return;
        const exacto = r.items.find((p) => p.codigo === t || p.codigoBarras === t);
        const elegido = exacto ?? (r.items.length === 1 ? r.items[0] : undefined);
        if (elegido !== undefined) elegirProducto(elegido);
        else if (r.items.length === 0 && /^\d{6,}$/.test(t)) await escanear(t); // código tecleado a mano
      } catch (e) {
        setAviso({ tipo: "error", texto: e instanceof ApiError ? e.message : "No se pudo buscar" });
      }
    },
    [api, qc, categoriaId, elegirProducto, escanear]
  );

  const { procesarTecla } = useEscaneo({ alEscanear: (c) => void escanear(c), alDigitar: (t) => void digitar(t) });

  // ── Atajos ─────────────────────────────────────────────────

  const abrirCobro = (): void => {
    if (modal !== null || pendiente !== null || estadoAlmacen !== "listo" || lineas.length === 0) return;
    if (calculo.hayErrores) return setAviso({ tipo: "error", texto: "Corrija el descuento de la línea marcada antes de cobrar" });
    setErrorCobro(null);
    setModal({ tipo: "cobro" });
  };
  const nuevaVenta = (): void => {
    setConfirmacion(null);
    enfocarBusqueda();
  };

  const abrirEnEspera = (): void => {
    if (usuario === null || modalAbierto.current || enCurso.current) return;
    try {
      const carritos = leerCarritosEnEspera(usuario);
      revisionCarrito.current += 1;
      setModal({ tipo: "espera", carritos, error: null });
    } catch {
      setAviso({ tipo: "error", texto: "No se pudieron leer los carritos en espera de esta caja" });
    }
  };

  const cambiarCarritoEnEspera = (id?: string): void => {
    if (usuario === null || modal?.tipo !== "espera" || pendiente !== null || enCurso.current) return;
    const actual = carrito.getState();
    if (id === undefined && actual.lineas.length === 0) return;
    try {
      const guardados = leerCarritosEnEspera(usuario);
      const recuperado = guardados.find((c) => c.id === id);
      if (id !== undefined && recuperado === undefined) {
        setModal({ tipo: "espera", carritos: guardados, error: "Ese carrito ya no está disponible" });
        return;
      }
      const siguientes = guardados.filter((c) => c.id !== id);
      if (actual.lineas.length > 0) {
        siguientes.unshift({
          id: globalThis.crypto.randomUUID(), guardadoEn: new Date().toISOString(), lineas: actual.lineas, cliente: actual.cliente,
        });
      }
      guardarCarritosEnEspera(usuario, siguientes);
      carrito.setState({ lineas: recuperado?.lineas ?? [], cliente: recuperado?.cliente ?? null });
      setBusqueda("");
      setConfirmacion(null);
      setModal(null);
      setAviso({ tipo: "exito", texto: recuperado === undefined ? "Carrito guardado en espera" : "Carrito recuperado" });
    } catch {
      setModal({ ...modal, error: "No se pudieron guardar los cambios. El carrito actual sigue disponible." });
    }
  };

  useAtajos({
    F2: () => {
      if (modal === null) enfocarBusqueda();
    },
    F4: () => {
      if (modal === null && pendiente === null) setModal({ tipo: "cliente" });
    },
    F6: abrirEnEspera,
    F8: abrirCobro,
    Escape: () => {
      if (modal !== null) {
        if (!enviando) setModal(null);
      } else if (confirmacion !== null) nuevaVenta();
      else if (busqueda !== "") {
        setBusqueda("");
        enfocarBusqueda();
      }
    },
  });

  useEffect(() => {
    if (modal === null && confirmacion === null) refBusqueda.current?.focus();
  }, [modal, confirmacion, estadoAlmacen]);

  // ── Cobro ──────────────────────────────────────────────────

  const cobrar = async (d: DatosCobro): Promise<void> => {
    if (usuario === null || punto === null || enCurso.current || pendiente !== null) return;
    setErrorCobro(null);
    // El precio nunca se envía: lo resuelve el servidor (lista del cliente, presentación, producto)
    const entrada = {
      intentoId: globalThis.crypto.randomUUID(),
      puntoEmisionId: punto.id,
      ...(cliente !== null ? { clienteId: cliente.id } : {}),
      lineas: lineas.map((l) => ({
        productoId: l.productoId,
        ...(l.presentacionId !== null ? { presentacionId: l.presentacionId } : {}),
        cantidad: l.cantidad,
        descuento: l.descuento,
        tipoDescuento: l.tipoDescuento,
      })),
      pagos: d.pagos.map((p) => ({ formaPago: p.formaPago, monto: p.monto })),
      propina: d.propina,
      emitirFactura: d.emitirFactura,
    };
    const valida = CobroPendienteSchema.safeParse(entrada);
    if (!valida.success) {
      setErrorCobro(valida.error.issues.map((i) => i.message).join("; "));
      return;
    }
    enCurso.current = true;
    setEnviando(true);
    try {
      await operarCobroPendiente(usuario, { tipo: "guardar", cobro: valida.data });
    } catch {
      setEnviando(false);
      setErrorCobro("No se pudo guardar el intento de cobro en esta caja");
      try {
        const guardado = await operarCobroPendiente(usuario, { tipo: "leer" });
        if (guardado !== null) {
          setPendiente(guardado);
          setModal(null);
        }
      } catch {
        setEstadoAlmacen("error");
      }
      return;
    } finally {
      enCurso.current = false;
    }
    setPendiente(valida.data);
    await enviarCobro(valida.data);
  };

  const enviarCobro = async (venta: CobroPendiente): Promise<void> => {
    if (usuario === null || enCurso.current) return;
    enCurso.current = true;
    setEnviando(true);
    setErrorCobro(null);
    try {
      const emitida = await api.crearVenta(venta);
      await operarCobroPendiente(usuario, { tipo: "retirar", intentoId: venta.intentoId });
      carrito.getState().vaciar();
      setModal(null);
      setBusqueda("");
      setConfirmacion(emitida);
      setPendiente(null);
      void qc.invalidateQueries({ queryKey: ["productos"] });
      void qc.invalidateQueries({ queryKey: ["colaSri"] });
    } catch (e) {
      if (e instanceof ApiError) {
        setErrorCobro(e.message);
        const definitivo = [400, 402, 404, 409].includes(e.status) &&
          !["DUPLICADO", "ERROR_INTERNO"].includes(e.codigo);
        if (definitivo) {
          try {
            await operarCobroPendiente(usuario, { tipo: "retirar", intentoId: venta.intentoId });
          } catch {
            setErrorCobro("No se pudo cerrar el intento guardado en esta caja");
            setModal(null);
            return;
          }
          setPendiente(null);
          if (e.codigo === "COBRO_ARCHIVADO") {
            carrito.getState().vaciar();
            setModal(null);
            setAviso({ tipo: "info", texto: e.message });
            void qc.invalidateQueries({ queryKey: ["productos"] });
            void qc.invalidateQueries({ queryKey: ["colaSri"] });
          } else if (modal === null) setAviso({ tipo: "error", texto: e.message });
        } else setModal(null);
        // Sin turno abierto (lo cerraron desde otra caja o un supervisor): se vuelve a la apertura; el carrito se conserva
        if (e.codigo === "TURNO_REQUERIDO") fijarTurno(null);
      } else {
        setErrorCobro("No se pudo confirmar el resultado del cobro");
        setModal(null);
      }
    } finally {
      enCurso.current = false;
      setEnviando(false);
    }
  };

  /**
   * Salida de un cobro que no se logra confirmar. Primero lo cierra el servidor (si ya lo había registrado lo dice y no se descarta);
   * solo después se borra el intento guardado en esta caja. El carrito se conserva para volver a cobrar.
   */
  const descartarPendiente = async (): Promise<void> => {
    if (usuario === null || pendiente === null || enCurso.current) return;
    enCurso.current = true;
    setEnviando(true);
    try {
      await api.descartarCobro(pendiente.intentoId);
      await operarCobroPendiente(usuario, { tipo: "retirar", intentoId: pendiente.intentoId });
      setPendiente(null);
      setErrorCobro(null);
      setAviso({ tipo: "info", texto: "Cobro descartado: no se registró ninguna venta. El carrito se conservó para volver a cobrar." });
    } catch (e) {
      setErrorCobro(e instanceof ApiError ? e.message : "No se pudo descartar el cobro. Intente de nuevo.");
    } finally {
      setConfirmandoDescarte(false);
      enCurso.current = false;
      setEnviando(false);
    }
  };

  const guardarFactura = async (): Promise<void> => {
    if (confirmacion === null) return;
    try {
      const { blob, nombre } = await api.facturaPdf(confirmacion.id);
      guardarArchivo(nombre, blob);
      setAviso({ tipo: "exito", texto: `Factura guardada: ${nombre}` });
    } catch (e) {
      setAviso({ tipo: "error", texto: e instanceof ApiError ? e.message : "No se pudo guardar la factura" });
    }
  };

  const reimprimir = async (): Promise<void> => {
    if (confirmacion === null) return;
    try {
      await api.reimprimir(confirmacion.id);
      setAviso({ tipo: "exito", texto: "Ticket enviado a la impresora" });
    } catch (e) {
      setAviso({ tipo: "error", texto: e instanceof ApiError ? e.message : "No se pudo imprimir" });
    }
  };

  // ── Edición de una línea ───────────────────────────────────

  const lineaEnEdicion: LineaCarrito | undefined = modal?.tipo === "linea" ? lineas.find((l) => l.clave === modal.clave) : undefined;
  const hayBalanza = balanza.data?.habilitada === true && balanza.data.puerto !== null;

  const aceptarNueva = (producto: ProductoPos, presentacion: PresentacionPos | null, r: ResultadoLinea): void => {
    carrito.getState().agregar({ producto, presentacion, cantidad: r.cantidad });
    setModal(null);
    setBusqueda("");
  };

  const aceptarLinea = (l: LineaCarrito, r: ResultadoLinea): void => {
    carrito.getState().fijarCantidad(l.clave, r.cantidad);
    carrito.getState().fijarDescuento(l.clave, r.descuento, r.tipoDescuento);
    setModal(null);
  };

  if (estadoAlmacen !== "listo") {
    return <div className="p-6 text-white" role="status">{estadoAlmacen === "leyendo"
      ? "Revisando cobros pendientes…" : "No se pudo leer el registro de cobros de esta caja. Vuelve a abrir la aplicación."}</div>;
  }

  if (pendiente !== null && modal === null) {
    return (
      <div className="flex flex-col items-start gap-4 p-6 text-white">
        <h1 className="text-xl font-semibold">Cobro pendiente de confirmación</h1>
        {errorCobro !== null && <Aviso tipo="error">{errorCobro}</Aviso>}
        <button type="button" className="btn-primary" disabled={enviando} onClick={() => void enviarCobro(pendiente)}>
          {enviando ? "Consultando…" : "Recuperar cobro"}
        </button>
        {/* Solo tras un intento fallido: con la conexión caída lo normal es recuperarlo, no descartarlo */}
        {errorCobro !== null && (
          <button type="button" className="rounded-lg border border-red-500/60 px-4 py-2 text-sm text-red-200 hover:bg-red-950/40" disabled={enviando} onClick={() => setConfirmandoDescarte(true)}>
            Descartar cobro pendiente
          </button>
        )}
        {confirmandoDescarte && (
          <Modal titulo="Descartar cobro pendiente" ancho="sm" ayuda="ESC cancela">
            <div className="space-y-3">
              <p className="text-sm text-slate-300">
                El servidor verificará que el cobro no se haya registrado. Si no se registró, se cancela y no se creará ninguna venta con esta clave; el carrito se conserva. Si ya se registró, se le avisará y deberá usar «Recuperar cobro».
              </p>
              <div className="flex justify-end gap-2">
                <button type="button" className="rounded-lg bg-slate-700 px-4 py-2 text-sm text-white" onClick={() => setConfirmandoDescarte(false)}>Cancelar</button>
                <button type="button" className="rounded-lg bg-red-700 px-4 py-2 text-sm text-white" disabled={enviando} onClick={() => void descartarPendiente()}>Sí, descartar</button>
              </div>
            </div>
          </Modal>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-slate-900 text-white" data-tactil={tactil ? "si" : "no"}>
      {aviso !== null ? (
        <div className="px-4 pt-2">
          <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 gap-4 p-4">
        <div className="flex min-w-0 flex-1 flex-col">
          <BuscadorProductos ref={refBusqueda} busqueda={busqueda} categoriaId={categoriaId} onCategoria={setCategoriaId} onBusqueda={setBusqueda} onTecla={(k) => procesarTecla(k)} onElegir={(p) => elegirProducto(p)} tactil={tactil} />
        </div>

        <aside className="flex w-[clamp(20rem,34vw,26rem)] shrink-0 flex-col rounded-2xl border border-slate-700 bg-slate-800/60 p-4">
          {confirmacion !== null ? (
            <Confirmacion venta={confirmacion} onNueva={nuevaVenta} onReimprimir={() => void reimprimir()} onGuardar={() => void guardarFactura()} />
          ) : (
            <>
              <CarritoPanel
                lineas={lineas}
                calculo={calculo}
                clienteNombre={cliente?.razonSocial ?? "Consumidor Final"}
                tactil={tactil}
                onMas={(l) => carrito.getState().fijarCantidad(l.clave, l.cantidad + 1)}
                onMenos={(l) => carrito.getState().fijarCantidad(l.clave, l.cantidad - 1)}
                onQuitar={(l) => carrito.getState().quitar(l.clave)}
                onEditar={(l) => setModal({ tipo: "linea", clave: l.clave })}
                onCliente={() => setModal({ tipo: "cliente" })}
              />
              <div className="mt-3 grid shrink-0 grid-cols-3 gap-2 text-sm">
                <button type="button" onClick={() => setModal({ tipo: "cliente" })} className={`rounded-xl bg-slate-700 px-2 text-white hover:bg-slate-600 ${tactil ? "min-h-14" : "min-h-10"}`}>
                  Cliente (F4)
                </button>
                <button type="button" onClick={abrirEnEspera} className={`inline-flex items-center justify-center gap-1 rounded-xl border border-slate-600 px-2 text-white hover:bg-slate-700 ${tactil ? "min-h-14" : "min-h-10"}`}>
                  <Pause className="h-4 w-4 shrink-0" aria-hidden="true" /> En espera (F6)
                </button>
                <button type="button" onClick={() => carrito.getState().vaciar()} disabled={lineas.length === 0} className={`rounded-xl bg-slate-700 px-2 text-white hover:bg-slate-600 disabled:opacity-40 ${tactil ? "min-h-14" : "min-h-10"}`}>
                  Vaciar
                </button>
                <button type="button" onClick={abrirCobro} disabled={lineas.length === 0} className={`col-span-3 rounded-xl bg-emerald-700 font-semibold text-white hover:bg-emerald-600 disabled:opacity-40 ${tactil ? "min-h-14 text-lg" : "min-h-11 text-base"}`}>
                  Cobrar (F8)
                </button>
              </div>
            </>
          )}
        </aside>
      </div>

      {modal?.tipo === "cobro" ? (
        <ModalCobro
          total={calculo.totales.total}
          clienteNombre={cliente?.razonSocial ?? "Consumidor Final"}
          esConsumidorFinal={cliente === null}
          tactil={tactil}
          error={errorCobro}
          enviando={enviando}
          onConfirmar={(d) => void cobrar(d)}
          onCancelar={() => setModal(null)}
        />
      ) : null}
      {modal?.tipo === "espera" ? (
        <ModalCarritosEnEspera carritos={modal.carritos} hayCarrito={lineas.length > 0} error={modal.error}
          onSuspender={() => cambiarCarritoEnEspera()} onRecuperar={(c) => cambiarCarritoEnEspera(c.id)} onCerrar={() => setModal(null)} />
      ) : null}
      {modal?.tipo === "cliente" ? (
        <ModalCliente
          actual={cliente}
          tactil={tactil}
          onElegir={(c) => {
            carrito.getState().fijarCliente(c);
            setModal(null);
          }}
          onCancelar={() => setModal(null)}
        />
      ) : null}
      {modal?.tipo === "nueva" ? (
        <ModalLinea
          titulo={modal.producto.nombre}
          unidad={modal.producto.unidadMedida.codigo}
          permiteDecimales={modal.producto.unidadMedida.permiteDecimales}
          productoId={UNIDADES_DE_PESO.includes(modal.producto.unidadMedida.codigo) ? modal.producto.id : null}
          balanzaDisponible={hayBalanza}
          inicial={{ cantidad: 0, descuento: 0, tipoDescuento: "VALOR" }}
          conDescuento={false}
          tactil={tactil}
          onAceptar={(r) => aceptarNueva(modal.producto, modal.presentacion, r)}
          onCancelar={() => setModal(null)}
        />
      ) : null}
      {lineaEnEdicion !== undefined ? (
        <ModalLinea
          titulo={lineaEnEdicion.nombre}
          unidad={lineaEnEdicion.unidad}
          permiteDecimales={lineaEnEdicion.permiteDecimales}
          productoId={UNIDADES_DE_PESO.includes(lineaEnEdicion.unidad) && lineaEnEdicion.presentacionId === null ? lineaEnEdicion.productoId : null}
          balanzaDisponible={hayBalanza}
          inicial={{ cantidad: lineaEnEdicion.cantidad, descuento: lineaEnEdicion.descuento, tipoDescuento: lineaEnEdicion.tipoDescuento }}
          conDescuento
          tactil={tactil}
          onAceptar={(r) => aceptarLinea(lineaEnEdicion, r)}
          onCancelar={() => setModal(null)}
        />
      ) : null}
    </div>
  );
}

function Confirmacion({ venta, onNueva, onReimprimir, onGuardar }: { venta: VentaEmitidaPos; onNueva: () => void; onReimprimir: () => void; onGuardar: () => void }): React.JSX.Element {
  const cambio = venta.pagos.reduce((a, p) => a + p.cambio, 0);
  return (
    <section aria-label="Venta registrada" className="flex flex-1 flex-col justify-between">
      <div className="space-y-3">
        <Aviso tipo="exito">Venta {venta.numero} registrada</Aviso>
        <p className="text-4xl font-bold text-white" data-testid="total-confirmado">
          {dinero(venta.total + venta.propina)}
        </p>
        {cambio > 0 ? (
          <p className="text-2xl font-semibold text-emerald-300" data-testid="cambio-confirmado">
            Cambio: {dinero(cambio)}
          </p>
        ) : null}
        {venta.comprobante !== null ? (
          <p className="text-sm text-slate-300">Factura electrónica {venta.comprobante.estado === "AUTORIZADO" ? "autorizada" : "generada: se enviará al SRI en segundo plano"}.</p>
        ) : null}
        {venta.advertencias.map((a) => (
          <Aviso key={a} tipo="info">
            {a}
          </Aviso>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        {venta.comprobante !== null ? (
          <button type="button" onClick={onGuardar} className="col-span-2 h-12 rounded-xl border border-slate-500 text-white hover:bg-slate-700">
            Guardar factura (PDF)
          </button>
        ) : null}
        <button type="button" onClick={onReimprimir} className="h-12 rounded-xl bg-slate-700 text-white">
          Reimprimir ticket
        </button>
        <button type="button" data-autofocus autoFocus onClick={onNueva} className="h-12 rounded-xl bg-brand-600 font-semibold text-white">
          Nueva venta
        </button>
      </div>
    </section>
  );
}

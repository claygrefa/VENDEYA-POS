// ============================================================
// src/renderer/pages/AjustesPage.tsx — Ajustes del negocio (solo configuracion:actualizar):
// empresa y ambiente SRI, giro y módulos, impresora, balanza, certificado de firma y red local (sincronización entre cajas)
// ============================================================
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useEffect, useState } from "react";
import { GIROS, REGIMENES, TIPOS_CONTRIBUYENTE } from "../../shared/schemas/setup.schema";
import { Boton, Campo, Casilla, Pestanas, Seleccion, aNumero, mensajeDeError } from "../components/Gestion";
import { Aviso } from "../components/Modal";
import { archivoABase64, type AjustesNegocio, type ConfiguracionBalanza, type ConfiguracionImpresora, type InformacionCertificado } from "../services/ajustes.api";
import { useActualizacion } from "../hooks/useActualizacion";
import { useAjustes, usePos } from "../services/contexto";
import type { EstadoActualizacion } from "../../shared/types/actualizacion.types";
import { ETIQUETA_GIRO, ETIQUETA_REGIMEN, ETIQUETA_TIPO } from "./SetupWizard";

type Seccion = "empresa" | "modulos" | "impresora" | "balanza" | "certificado" | "red" | "actualizaciones";
const SECCIONES: ReadonlyArray<{ id: Seccion; titulo: string }> = [
  { id: "empresa", titulo: "Empresa" },
  { id: "modulos", titulo: "Giro y módulos" },
  { id: "impresora", titulo: "Impresora" },
  { id: "balanza", titulo: "Balanza" },
  { id: "certificado", titulo: "Certificado de firma" },
  { id: "red", titulo: "Red local" },
  { id: "actualizaciones", titulo: "Actualizaciones" },
];

export const ETIQUETA_MODULO: Record<string, string> = {
  moduloLotes: "Lotes de productos",
  moduloVencimientos: "Control de vencimientos",
  moduloMesas: "Mesas (restaurante)",
  moduloComandasCocina: "Comandas de cocina",
  moduloBalanza: "Balanza para productos por peso",
  moduloListasPrecios: "Listas de precios",
  moduloCuentasPorCobrar: "Crédito a clientes (cuentas por cobrar)",
  moduloCuentasPorPagar: "Crédito de proveedores (cuentas por pagar)",
  emitirFacturas: "Emitir facturas",
  emitirNotasCredito: "Emitir notas de crédito",
  emitirRetenciones: "Emitir retenciones",
  emitirGuiasRemision: "Emitir guías de remisión",
  emitirLiquidaciones: "Emitir liquidaciones de compra",
  impresionTermica: "Imprimir ticket al cobrar",
  aperturaGaveta: "Abrir la gaveta de dinero al cobrar en efectivo",
  lecturaCodigoBarras: "Lector de códigos de barras",
  sincronizacionLAN: "Sincronizar varias cajas en la red local",
};
const opciones = (ids: ReadonlyArray<string>, etiquetas: Record<string, string>): Array<{ valor: string; titulo: string }> => ids.map((v) => ({ valor: v, titulo: etiquetas[v] ?? v }));
type Mensaje = { tipo: "error" | "exito"; texto: string } | null;

export function AjustesPage(): React.JSX.Element {
  const [seccion, setSeccion] = useState<Seccion>("empresa");
  return (
    <section aria-label="Ajustes" className="space-y-2">
      <h1 className="text-xl font-semibold text-white">Ajustes</h1>
      <Pestanas etiqueta="Secciones de ajustes" opciones={SECCIONES} activa={seccion} onCambio={setSeccion} />
      {seccion === "empresa" ? <SeccionEmpresa /> : null}
      {seccion === "modulos" ? <SeccionModulos /> : null}
      {seccion === "impresora" ? <SeccionImpresora /> : null}
      {seccion === "balanza" ? <SeccionBalanza /> : null}
      {seccion === "certificado" ? <SeccionCertificado /> : null}
      {seccion === "red" ? <SeccionRed /> : null}
      {seccion === "actualizaciones" ? <SeccionActualizaciones /> : null}
    </section>
  );
}

function useAjustesNegocio() {
  const a = useAjustes();
  return useQuery({ queryKey: ["ajustes", "negocio"], queryFn: () => a.ajustes() });
}

function Cargando({ consulta }: { consulta: { isPending: boolean; isError: boolean; error: unknown } }): React.JSX.Element | null {
  if (consulta.isPending) return <p className="text-slate-400">Cargando…</p>;
  if (consulta.isError) return <Aviso tipo="error">{mensajeDeError(consulta.error)}</Aviso>;
  return null;
}

// ── Empresa ──────────────────────────────────────────────────

function SeccionEmpresa(): React.JSX.Element {
  const a = useAjustes();
  const qc = useQueryClient();
  const q = useAjustesNegocio();
  const [f, setF] = useState<AjustesNegocio["empresa"] | null>(null);
  const [produccionConfirmada, setProduccionConfirmada] = useState(false);
  const [mensaje, setMensaje] = useState<Mensaje>(null);
  useEffect(() => {
    if (q.data !== undefined) setF(q.data.empresa);
  }, [q.data]);

  const guardar = useMutation({
    mutationFn: (e: AjustesNegocio["empresa"]) => {
      const { ruc: _ruc, ...datos } = e;
      return a.actualizarEmpresa({ ...datos, resolucionAgente: datos.resolucionAgente === "" ? null : datos.resolucionAgente, contribuyenteEspecial: datos.contribuyenteEspecial === "" ? null : datos.contribuyenteEspecial });
    },
    onSuccess: async () => { setMensaje({ tipo: "exito", texto: "Datos de la empresa guardados" }); setProduccionConfirmada(false); await qc.invalidateQueries({ queryKey: ["ajustes", "negocio"] }); },
    onError: (e) => setMensaje({ tipo: "error", texto: mensajeDeError(e) }),
  });

  if (f === null || q.data === undefined) return <Cargando consulta={q} />;
  const cambiar = <K extends keyof typeof f>(k: K, v: (typeof f)[K]): void => { setMensaje(null); setF({ ...f, [k]: v }); };
  const pasaAProduccion = f.ambienteSRI === "PRODUCCION" && q.data.empresa.ambienteSRI !== "PRODUCCION";
  return (
    <form noValidate aria-label="Datos de la empresa" className="max-w-2xl space-y-3" onSubmit={(e) => { e.preventDefault(); guardar.mutate(f); }}>
      <Campo etiqueta="RUC" valor={f.ruc} onCambio={() => undefined} deshabilitado />
      <Campo etiqueta="Razón social" valor={f.razonSocial} onCambio={(v) => cambiar("razonSocial", v)} />
      <Campo etiqueta="Nombre comercial" valor={f.nombreComercial} onCambio={(v) => cambiar("nombreComercial", v)} />
      <Campo etiqueta="Dirección de la matriz" valor={f.direccionMatriz} onCambio={(v) => cambiar("direccionMatriz", v)} />
      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta="Teléfono" valor={f.telefono} onCambio={(v) => cambiar("telefono", v)} />
        <Campo etiqueta="Correo electrónico" tipo="email" valor={f.email} onCambio={(v) => cambiar("email", v)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Seleccion etiqueta="Tipo de contribuyente" valor={f.tipoContribuyente} onCambio={(v) => cambiar("tipoContribuyente", v)} opciones={opciones(TIPOS_CONTRIBUYENTE, ETIQUETA_TIPO)} />
        <Seleccion etiqueta="Régimen tributario" valor={f.regimenTributario} onCambio={(v) => cambiar("regimenTributario", v)} opciones={opciones(REGIMENES, ETIQUETA_REGIMEN)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta="Contribuyente especial (resolución)" valor={f.contribuyenteEspecial ?? ""} onCambio={(v) => cambiar("contribuyenteEspecial", v)} />
        <Campo etiqueta="Resolución de agente de retención" valor={f.resolucionAgente ?? ""} onCambio={(v) => cambiar("resolucionAgente", v)} />
      </div>
      <div className="flex gap-6">
        <Casilla etiqueta="Obligado a llevar contabilidad" marcada={f.obligadoContabilidad} onCambio={(v) => cambiar("obligadoContabilidad", v)} />
        <Casilla etiqueta="Agente de retención" marcada={f.agenteRetencion} onCambio={(v) => cambiar("agenteRetencion", v)} />
      </div>
      <Seleccion etiqueta="Ambiente del SRI" valor={f.ambienteSRI} onCambio={(v) => { setProduccionConfirmada(false); cambiar("ambienteSRI", v as "PRUEBAS" | "PRODUCCION"); }} opciones={[{ valor: "PRUEBAS", titulo: "Pruebas (sin validez tributaria)" }, { valor: "PRODUCCION", titulo: "Producción" }]} />
      {pasaAProduccion ? (
        <div className="space-y-1">
          <Aviso tipo="info">En producción los comprobantes tienen validez tributaria y se envían al SRI real. Verifique que el certificado sea el definitivo.</Aviso>
          <Casilla etiqueta="Entiendo que los comprobantes tendrán validez tributaria" marcada={produccionConfirmada} onCambio={setProduccionConfirmada} />
        </div>
      ) : null}
      {mensaje !== null ? <Aviso tipo={mensaje.tipo}>{mensaje.texto}</Aviso> : null}
      <Boton tipo="submit" variante="primario" deshabilitado={guardar.isPending || (pasaAProduccion && !produccionConfirmada)}>
        Guardar
      </Boton>
    </form>
  );
}

// ── Giro y módulos ───────────────────────────────────────────

function SeccionModulos(): React.JSX.Element {
  const a = useAjustes();
  const qc = useQueryClient();
  const q = useAjustesNegocio();
  const [giro, setGiro] = useState("");
  const [confirmar, setConfirmar] = useState(false);
  const [mensaje, setMensaje] = useState<Mensaje>(null);
  useEffect(() => {
    if (q.data !== undefined) setGiro(q.data.giroNegocio);
  }, [q.data]);

  const alExito = (texto: string) => async (): Promise<void> => {
    setMensaje({ tipo: "exito", texto });
    setConfirmar(false);
    await qc.invalidateQueries({ queryKey: ["ajustes"] });
  };
  const alError = (e: unknown): void => setMensaje({ tipo: "error", texto: mensajeDeError(e) });
  const cambiarModulo = useMutation({ mutationFn: (m: Record<string, boolean>) => a.actualizarModulos(m), onSuccess: alExito("Módulo actualizado"), onError: alError });
  const aplicar = useMutation({ mutationFn: (g: string) => a.aplicarGiro(g), onSuccess: alExito("Giro aplicado: los módulos quedaron como los define ese giro"), onError: alError });

  if (q.data === undefined) return <Cargando consulta={q} />;
  return (
    <div className="max-w-2xl space-y-5">
      <div className="space-y-2">
        <Seleccion etiqueta="Giro del negocio" valor={giro} onCambio={(v) => { setGiro(v); setConfirmar(false); setMensaje(null); }} opciones={opciones(GIROS, ETIQUETA_GIRO)} />
        {giro !== q.data.giroNegocio ? (
          <div className="space-y-2">
            <Aviso tipo="info">Cambiar de giro reemplaza los módulos activos por los de ese giro (se pierden los ajustes manuales de módulos).</Aviso>
            <Casilla etiqueta="Entiendo que se reajustan los módulos" marcada={confirmar} onCambio={setConfirmar} />
            <Boton variante="primario" deshabilitado={!confirmar || aplicar.isPending} onClick={() => aplicar.mutate(giro)}>
              Aplicar giro
            </Boton>
          </div>
        ) : null}
      </div>
      <fieldset className="space-y-2 rounded-xl border border-slate-700 p-4">
        <legend className="px-2 text-sm font-medium text-slate-300">Módulos activos</legend>
        {Object.entries(q.data.modulos).map(([clave, activo]) => (
          <Casilla key={clave} etiqueta={ETIQUETA_MODULO[clave] ?? clave} marcada={activo} onCambio={(v) => cambiarModulo.mutate({ [clave]: v })} />
        ))}
      </fieldset>
      {mensaje !== null ? <Aviso tipo={mensaje.tipo}>{mensaje.texto}</Aviso> : null}
    </div>
  );
}

// ── Impresora ────────────────────────────────────────────────

function SeccionImpresora(): React.JSX.Element {
  const a = useAjustes();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["ajustes", "impresora"], queryFn: () => a.impresora() });
  const [f, setF] = useState<{ conexion: string; direccion: string; puerto: string; ancho: string } | null>(null);
  const [mensaje, setMensaje] = useState<Mensaje>(null);
  useEffect(() => {
    const c: ConfiguracionImpresora | undefined = q.data;
    if (c !== undefined) setF({ conexion: c.conexion, direccion: c.direccion ?? "", puerto: String(c.puerto), ancho: String(c.ancho) });
  }, [q.data]);

  const guardar = useMutation({
    mutationFn: (x: NonNullable<typeof f>) => {
      const puerto = aNumero(x.puerto);
      return a.configurarImpresora({ conexion: x.conexion, ...(x.conexion !== "NINGUNA" ? { direccion: x.direccion.trim() } : {}), ...(puerto !== undefined && !Number.isNaN(puerto) ? { puerto } : {}), ancho: Number(x.ancho) });
    },
    onSuccess: async () => { setMensaje({ tipo: "exito", texto: "Impresora guardada" }); await qc.invalidateQueries({ queryKey: ["ajustes", "impresora"] }); },
    onError: (e) => setMensaje({ tipo: "error", texto: mensajeDeError(e) }),
  });
  const probar = useMutation({
    mutationFn: () => a.probarImpresora(),
    onSuccess: () => setMensaje({ tipo: "exito", texto: "Se envió una página de prueba a la impresora" }),
    onError: (e) => setMensaje({ tipo: "error", texto: mensajeDeError(e) }),
  });

  if (f === null) return <Cargando consulta={q} />;
  const cambiar = (k: keyof typeof f, v: string): void => { setMensaje(null); setF({ ...f, [k]: v }); };
  return (
    <form noValidate aria-label="Impresora térmica" className="max-w-xl space-y-3" onSubmit={(e) => { e.preventDefault(); guardar.mutate(f); }}>
      <Seleccion etiqueta="Conexión" valor={f.conexion} onCambio={(v) => cambiar("conexion", v)} opciones={[{ valor: "NINGUNA", titulo: "Sin impresora" }, { valor: "RED", titulo: "Impresora en red (IP)" }, { valor: "SISTEMA", titulo: "Impresora instalada en Windows" }]} />
      {f.conexion !== "NINGUNA" ? <Campo etiqueta={f.conexion === "RED" ? "Dirección IP o nombre del equipo" : "Nombre de la impresora"} valor={f.direccion} onCambio={(v) => cambiar("direccion", v)} /> : null}
      {f.conexion === "RED" ? <Campo etiqueta="Puerto" tipo="number" valor={f.puerto} onCambio={(v) => cambiar("puerto", v)} /> : null}
      <Seleccion etiqueta="Ancho del papel" valor={f.ancho} onCambio={(v) => cambiar("ancho", v)} opciones={[{ valor: "80", titulo: "80 mm" }, { valor: "58", titulo: "58 mm" }]} />
      <p className="text-xs text-slate-400">Imprimir al cobrar y abrir la gaveta se activan en «Giro y módulos».</p>
      {mensaje !== null ? <Aviso tipo={mensaje.tipo}>{mensaje.texto}</Aviso> : null}
      <div className="flex gap-3">
        <Boton tipo="submit" variante="primario" deshabilitado={guardar.isPending}>Guardar</Boton>
        <Boton deshabilitado={probar.isPending || q.data?.conexion === "NINGUNA"} onClick={() => probar.mutate()}>Imprimir prueba</Boton>
      </div>
    </form>
  );
}

// ── Balanza ──────────────────────────────────────────────────

const BAUDIOS = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200];

function SeccionBalanza(): React.JSX.Element {
  const a = useAjustes();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["ajustes", "balanza"], queryFn: () => a.balanza() });
  const [f, setF] = useState<{ puerto: string; baudios: string; protocolo: string; etiqueta: string } | null>(null);
  const [mensaje, setMensaje] = useState<Mensaje>(null);
  useEffect(() => {
    const c: ConfiguracionBalanza | undefined = q.data;
    if (c !== undefined) setF({ puerto: c.puerto ?? "", baudios: String(c.baudios), protocolo: c.protocolo, etiqueta: c.etiqueta });
  }, [q.data]);

  const guardar = useMutation({
    mutationFn: (x: NonNullable<typeof f>) => a.configurarBalanza({ ...(x.puerto.trim() !== "" ? { puerto: x.puerto.trim() } : {}), baudios: Number(x.baudios), protocolo: x.protocolo, etiqueta: x.etiqueta }),
    onSuccess: async () => { setMensaje({ tipo: "exito", texto: "Balanza guardada" }); await qc.invalidateQueries({ queryKey: ["ajustes", "balanza"] }); },
    onError: (e) => setMensaje({ tipo: "error", texto: mensajeDeError(e) }),
  });

  if (f === null) return <Cargando consulta={q} />;
  const cambiar = (k: keyof typeof f, v: string): void => { setMensaje(null); setF({ ...f, [k]: v }); };
  return (
    <form noValidate aria-label="Balanza" className="max-w-xl space-y-3" onSubmit={(e) => { e.preventDefault(); guardar.mutate(f); }}>
      {q.data?.habilitada === false ? <Aviso tipo="info">El módulo de balanza está desactivado: actívelo en «Giro y módulos» para pesar al vender.</Aviso> : null}
      <Campo etiqueta="Puerto serie (COM3, /dev/ttyUSB0…)" valor={f.puerto} onCambio={(v) => cambiar("puerto", v)} placeholder="Vacío si no hay balanza" />
      <div className="grid grid-cols-2 gap-3">
        <Seleccion etiqueta="Velocidad (baudios)" valor={f.baudios} onCambio={(v) => cambiar("baudios", v)} opciones={BAUDIOS.map((b) => ({ valor: String(b), titulo: String(b) }))} />
        <Seleccion etiqueta="Protocolo" valor={f.protocolo} onCambio={(v) => cambiar("protocolo", v)} opciones={[{ valor: "GENERICO", titulo: "Genérico" }, { valor: "CAS", titulo: "CAS" }]} />
      </div>
      <Seleccion etiqueta="La etiqueta de la balanza lleva" valor={f.etiqueta} onCambio={(v) => cambiar("etiqueta", v)} opciones={[{ valor: "PESO", titulo: "El peso" }, { valor: "PRECIO", titulo: "El precio" }]} />
      {mensaje !== null ? <Aviso tipo={mensaje.tipo}>{mensaje.texto}</Aviso> : null}
      <Boton tipo="submit" variante="primario" deshabilitado={guardar.isPending}>Guardar</Boton>
    </form>
  );
}

// ── Certificado de firma ─────────────────────────────────────

const fechaLarga = (iso: string | null): string => (iso === null ? "—" : new Date(iso).toLocaleDateString("es-EC"));

function SeccionCertificado(): React.JSX.Element {
  const a = useAjustes();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["ajustes", "certificado"], queryFn: () => a.certificado() });
  const [archivo, setArchivo] = useState<File | null>(null);
  const [clave, setClave] = useState("");
  const [confirmarTitular, setConfirmarTitular] = useState(false);
  const [mensaje, setMensaje] = useState<Mensaje>(null);

  const cargar = useMutation({
    mutationFn: async () => {
      if (archivo === null) throw new Error("Elija el archivo del certificado (.p12 o .pfx)");
      return a.cargarCertificado({ archivoBase64: await archivoABase64(archivo), password: clave, ...(confirmarTitular ? { confirmarTitular: true } : {}) });
    },
    onSuccess: async () => {
      setMensaje({ tipo: "exito", texto: "Certificado guardado" });
      setArchivo(null); setClave(""); setConfirmarTitular(false);
      await qc.invalidateQueries({ queryKey: ["ajustes", "certificado"] });
    },
    onError: (e) => setMensaje({ tipo: "error", texto: mensajeDeError(e) }),
  });
  const quitar = useMutation({
    mutationFn: () => a.quitarCertificado(),
    onSuccess: async () => { setMensaje({ tipo: "exito", texto: "Certificado eliminado: no se podrá firmar hasta cargar otro" }); await qc.invalidateQueries({ queryKey: ["ajustes", "certificado"] }); },
    onError: (e) => setMensaje({ tipo: "error", texto: mensajeDeError(e) }),
  });

  const c: InformacionCertificado | undefined = q.data;
  if (c === undefined) return <Cargando consulta={q} />;
  return (
    <div className="max-w-xl space-y-4">
      <div aria-label="Estado del certificado" className="space-y-2 rounded-xl border border-slate-700 bg-slate-800 p-4 text-sm text-slate-200">
        {c.cargado ? (
          <>
            <p><span className="text-slate-400">Titular:</span> {c.titular}</p>
            <p><span className="text-slate-400">Emisor:</span> {c.emisor}</p>
            <p><span className="text-slate-400">Vence:</span> {fechaLarga(c.vencimiento)} {c.diasRestantes !== null ? `(${c.diasRestantes} días)` : ""}</p>
            {c.advertencia !== null ? <Aviso tipo={c.vencido ? "error" : "info"}>{c.advertencia}</Aviso> : <Aviso tipo="exito">Certificado vigente</Aviso>}
          </>
        ) : (
          <Aviso tipo="info">No hay un certificado cargado: los comprobantes no se pueden firmar ni enviar al SRI.</Aviso>
        )}
      </div>
      <form noValidate aria-label="Cargar certificado" className="space-y-3" onSubmit={(e) => { e.preventDefault(); setMensaje(null); cargar.mutate(); }}>
        <h2 className="text-sm font-semibold text-white">{c.cargado ? "Renovar certificado" : "Cargar certificado"}</h2>
        <label className="block text-sm text-slate-300">
          Archivo del certificado
          <input aria-label="Archivo del certificado" type="file" accept=".p12,.pfx" onChange={(e) => { setArchivo(e.target.files?.[0] ?? null); setMensaje(null); }} className="mt-1 block w-full text-sm text-slate-300" />
        </label>
        <Campo etiqueta="Contraseña del certificado" tipo="password" valor={clave} onCambio={(v) => { setClave(v); setMensaje(null); }} />
        <Casilla etiqueta="Confirmo que el titular es correcto aunque el RUC no figure en el certificado" marcada={confirmarTitular} onCambio={setConfirmarTitular} />
        {mensaje !== null ? <Aviso tipo={mensaje.tipo}>{mensaje.texto}</Aviso> : null}
        <div className="flex gap-3">
          <Boton tipo="submit" variante="primario" deshabilitado={cargar.isPending || archivo === null || clave === ""}>{c.cargado ? "Reemplazar certificado" : "Guardar certificado"}</Boton>
          {c.cargado ? <Boton variante="peligro" deshabilitado={quitar.isPending} onClick={() => quitar.mutate()}>Quitar certificado</Boton> : null}
        </div>
      </form>
    </div>
  );
}

// ── Red local ────────────────────────────────────────────────

function SeccionRed(): React.JSX.Element {
  const a = useAjustes();
  const { api } = usePos();
  const qc = useQueryClient();
  const negocio = useAjustesNegocio();
  const cajas = useQuery({ queryKey: ["ajustes", "cajas"], queryFn: () => a.cajasConectadas(), refetchInterval: 15_000, enabled: negocio.data?.modulos["sincronizacionLAN"] === true });
  const [mensaje, setMensaje] = useState<Mensaje>(null);
  const alternar = useMutation({
    mutationFn: (v: boolean) => a.actualizarModulos({ sincronizacionLAN: v }),
    onSuccess: async () => { setMensaje({ tipo: "exito", texto: "Sincronización actualizada" }); await qc.invalidateQueries({ queryKey: ["ajustes"] }); },
    onError: (e) => setMensaje({ tipo: "error", texto: mensajeDeError(e) }),
  });

  if (negocio.data === undefined) return <Cargando consulta={negocio} />;
  const activa = negocio.data.modulos["sincronizacionLAN"] === true;
  return (
    <div className="max-w-xl space-y-4">
      <Casilla etiqueta={ETIQUETA_MODULO["sincronizacionLAN"] as string} marcada={activa} onCambio={(v) => alternar.mutate(v)} />
      <p className="text-sm text-slate-400">Esta caja se identifica como <strong className="text-slate-200">{api.http.cajaId}</strong> y atiende en <strong className="text-slate-200">{api.http.baseUrl}</strong>. Las otras cajas del local se conectan a esa dirección.</p>
      {mensaje !== null ? <Aviso tipo={mensaje.tipo}>{mensaje.texto}</Aviso> : null}
      <div>
        <h2 className="mb-2 text-sm font-semibold text-white">Cajas conectadas ahora</h2>
        {!activa ? (
          <p className="text-sm text-slate-500">Active la sincronización para ver las cajas conectadas.</p>
        ) : cajas.data === undefined ? (
          <Cargando consulta={cajas} />
        ) : cajas.data.cajas.length === 0 ? (
          <p className="text-sm text-slate-500">Ninguna caja conectada.</p>
        ) : (
          <ul aria-label="Cajas conectadas" className="space-y-1 text-sm text-slate-200">
            {cajas.data.cajas.map((c, i) => (
              <li key={`${c.cajaId}-${i}`} className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2">
                {c.cajaId}
                {typeof c["usuario"] === "string" ? ` · ${c["usuario"]}` : ""}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── Actualizaciones ──────────────────────────────────────────

export function textoDeEstado(e: EstadoActualizacion | null): string {
  if (e === null) return "Sin información todavía";
  switch (e.tipo) {
    case "desactivado": return e.motivo;
    case "inactivo": return "Todavía no se ha buscado";
    case "buscando": return "Buscando actualizaciones…";
    case "al-dia": return `Tiene la última versión (revisado el ${new Date(e.revisado).toLocaleString("es-EC")})`;
    case "descargando": return `Descargando la versión ${e.version}… ${e.porcentaje}%`;
    case "lista": return e.aviso ?? `La versión ${e.version} está lista: se instalará al cerrar la aplicación`;
    case "error": return e.mensaje;
  }
}

function SeccionActualizaciones(): React.JSX.Element {
  const a = useActualizacion();
  const version = useQuery({
    queryKey: ["ajustes", "version"],
    queryFn: () => (window as Partial<Window>).vendeya?.invoke<string>("app:get-version") ?? Promise.resolve(null),
  });
  const ocupada = a.estado?.tipo === "buscando" || a.estado?.tipo === "descargando";
  return (
    <div className="max-w-xl space-y-4">
      <p className="text-sm text-slate-300">
        Versión instalada: <strong className="text-white">{version.data ?? (a.disponible ? "…" : "solo disponible en la aplicación instalada")}</strong>
      </p>
      <p aria-label="Estado de las actualizaciones" className="rounded-xl border border-slate-700 bg-slate-800 p-4 text-sm text-slate-200">
        {a.disponible ? textoDeEstado(a.estado) : "Las actualizaciones automáticas funcionan en la aplicación instalada."}
      </p>
      <p className="text-xs text-slate-400">Las actualizaciones se descargan en segundo plano y se instalan al cerrar la aplicación. Antes de instalar se hace una copia de seguridad de la base de datos y nunca se reinicia con una venta en curso.</p>
      <Boton variante="primario" deshabilitado={!a.disponible || ocupada || a.estado?.tipo === "desactivado" || a.estado?.tipo === "lista"} onClick={() => void a.buscar()}>
        Buscar actualizaciones
      </Boton>
    </div>
  );
}

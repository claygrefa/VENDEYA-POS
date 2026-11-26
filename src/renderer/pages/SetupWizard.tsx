// ============================================================
// src/renderer/pages/SetupWizard.tsx — Asistente de configuración inicial (3 pasos) para un equipo recién instalado
//   1. Empresa: RUC, razón social, régimen, ambiente SRI y la sucursal matriz (punto de emisión 001-001)
//   2. Certificado de firma electrónica (.p12): se valida antes de guardar nada; se puede dejar para después
//   3. Giro del negocio y usuario administrador
// ============================================================
import { useQueryClient } from "@tanstack/react-query";
import React, { useState } from "react";
import { DatosEmpresaSchema, GIROS, REGIMENES, SetupSchema, TIPOS_CONTRIBUYENTE, validarRucEcuatoriano } from "../../shared/schemas/setup.schema";
import { Boton, Campo, Casilla, Seleccion, mensajeDeError } from "../components/Gestion";
import { Aviso } from "../components/Modal";
import { AjustesApi, archivoABase64, type CertificadoValidado } from "../services/ajustes.api";
import { useAjustes, usePos } from "../services/contexto";
import { useSesion } from "../store/sesion.store";
import type { UsuarioSesion } from "../services/tipos";

export const ETIQUETA_GIRO: Record<string, string> = {
  RETAIL_GENERAL: "Comercio / tienda en general",
  FERRETERIA: "Ferretería",
  FARMACIA: "Farmacia (lotes y vencimientos)",
  RESTAURANTE: "Restaurante (mesas y comandas)",
  SERVICIOS: "Servicios",
  DISTRIBUIDOR: "Distribuidor (listas de precios y crédito)",
};
export const ETIQUETA_TIPO: Record<string, string> = {
  PERSONA_NATURAL: "Persona natural",
  SOCIEDAD: "Sociedad",
  PERSONA_NATURAL_OBLIGADA: "Persona natural obligada a llevar contabilidad",
  MICRO_EMPRESA: "Microempresa",
  RIMPE_EMPRENDEDOR: "RIMPE emprendedor",
  RIMPE_NEGOCIO_POPULAR: "RIMPE negocio popular",
};
export const ETIQUETA_REGIMEN: Record<string, string> = {
  GENERAL: "General",
  RIMPE_EMPRENDEDOR: "RIMPE emprendedor",
  RIMPE_NEGOCIO_POPULAR: "RIMPE negocio popular",
  MICROEMPRESA: "Microempresa",
};
const opciones = (ids: ReadonlyArray<string>, etiquetas: Record<string, string>): Array<{ valor: string; titulo: string }> => ids.map((v) => ({ valor: v, titulo: etiquetas[v] ?? v }));

const PASOS = ["Empresa", "Certificado", "Administrador"] as const;

interface FormEmpresa {
  ruc: string;
  razonSocial: string;
  nombreComercial: string;
  direccionMatriz: string;
  telefono: string;
  email: string;
  tipoContribuyente: string;
  regimenTributario: string;
  obligadoContabilidad: boolean;
  ambienteSRI: "PRUEBAS" | "PRODUCCION";
  sucursalNombre: string;
}

interface FormAdmin {
  giro: string;
  nombre: string;
  apellido: string;
  username: string;
  password: string;
  repetir: string;
}

interface Terminado {
  token: string;
  usuario: UsuarioSesion;
  certificado: { estado: "cargado" | "omitido" | "fallo"; detalle: string };
}

const primerError = (r: { success: false; error: { issues: Array<{ message: string }> } }): string => r.error.issues[0]?.message ?? "Revise los datos";

export function SetupWizard(): React.JSX.Element {
  const { api } = usePos();
  const ajustes = useAjustes();
  const qc = useQueryClient();
  const iniciar = useSesion((s) => s.iniciar);

  const [paso, setPaso] = useState(0);
  const [empresa, setEmpresa] = useState<FormEmpresa>({
    ruc: "", razonSocial: "", nombreComercial: "", direccionMatriz: "", telefono: "", email: "",
    tipoContribuyente: "PERSONA_NATURAL", regimenTributario: "GENERAL", obligadoContabilidad: false, ambienteSRI: "PRUEBAS", sucursalNombre: "Matriz",
  });
  const [confirmarRuc, setConfirmarRuc] = useState(false);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [claveP12, setClaveP12] = useState("");
  const [confirmarTitular, setConfirmarTitular] = useState(false);
  const [validado, setValidado] = useState<CertificadoValidado | null>(null);
  const [admin, setAdmin] = useState<FormAdmin>({ giro: "RETAIL_GENERAL", nombre: "", apellido: "", username: "", password: "", repetir: "" });
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [terminado, setTerminado] = useState<Terminado | null>(null);

  const cambiarEmpresa = <K extends keyof FormEmpresa>(k: K, v: FormEmpresa[K]): void => {
    setError(null);
    setEmpresa((e) => ({ ...e, [k]: v }));
  };
  const cambiarAdmin = <K extends keyof FormAdmin>(k: K, v: FormAdmin[K]): void => {
    setError(null);
    setAdmin((a) => ({ ...a, [k]: v }));
  };

  const rucValido = validarRucEcuatoriano(empresa.ruc);
  const rucPideConfirmar = /^\d{13}$/.test(empresa.ruc) && !rucValido;

  const datosEmpresa = (): Record<string, unknown> => ({
    ruc: empresa.ruc.trim(), razonSocial: empresa.razonSocial, nombreComercial: empresa.nombreComercial, direccionMatriz: empresa.direccionMatriz, telefono: empresa.telefono, email: empresa.email,
    tipoContribuyente: empresa.tipoContribuyente, regimenTributario: empresa.regimenTributario, obligadoContabilidad: empresa.obligadoContabilidad, ambienteSRI: empresa.ambienteSRI,
  });

  const siguienteDesdeEmpresa = (): void => {
    const r = DatosEmpresaSchema.safeParse(datosEmpresa());
    if (!r.success) return setError(primerError(r));
    if (empresa.sucursalNombre.trim().length < 2) return setError("Indique el nombre de la sucursal");
    if (rucPideConfirmar && !confirmarRuc) return setError("El RUC no pasa la verificación del dígito verificador: revíselo o marque que es correcto");
    setError(null);
    setPaso(1);
  };

  const validarCertificado = async (): Promise<void> => {
    if (archivo === null) return setError("Elija el archivo del certificado (.p12 o .pfx)");
    if (claveP12 === "") return setError("Escriba la contraseña del certificado");
    setOcupado(true);
    setError(null);
    try {
      const archivoBase64 = await archivoABase64(archivo);
      setValidado(await ajustes.validarCertificadoSetup({ archivoBase64, password: claveP12, ruc: empresa.ruc.trim(), ...(confirmarTitular ? { confirmarTitular: true } : {}) }));
    } catch (e) {
      setValidado(null);
      setError(mensajeDeError(e));
    } finally {
      setOcupado(false);
    }
  };

  const siguienteDesdeCertificado = (): void => {
    if (archivo !== null && validado === null) return setError("Valide el certificado antes de continuar, o quite el archivo para configurarlo después");
    setError(null);
    setPaso(2);
  };

  const finalizar = async (): Promise<void> => {
    if (admin.password !== admin.repetir) return setError("Las contraseñas no coinciden");
    const alta = {
      empresa: { ...datosEmpresa(), agenteRetencion: false },
      confirmarRuc,
      sucursal: { nombre: empresa.sucursalNombre, direccion: empresa.direccionMatriz, telefono: empresa.telefono },
      giro: admin.giro,
      admin: { username: admin.username.trim(), password: admin.password, nombre: admin.nombre, apellido: admin.apellido },
    };
    const r = SetupSchema.safeParse(alta);
    if (!r.success) return setError(primerError(r));
    setOcupado(true);
    setError(null);
    try {
      await ajustes.inicializar(alta as Parameters<typeof ajustes.inicializar>[0]);
      const sesion = await api.login(alta.admin.username, alta.admin.password);
      // Con la sesión del administrador ya se puede guardar el certificado (el asistente solo lo había validado)
      let certificado: Terminado["certificado"] = { estado: "omitido", detalle: "Quedó pendiente: cárguelo en Ajustes antes de emitir facturas electrónicas." };
      if (archivo !== null && validado !== null) {
        try {
          const archivoBase64 = await archivoABase64(archivo);
          const conSesion = new AjustesApi(api.http.conSesion(sesion.token));
          await conSesion.cargarCertificado({ archivoBase64, password: claveP12, ...(confirmarTitular ? { confirmarTitular: true } : {}) });
          certificado = { estado: "cargado", detalle: `Certificado de ${validado.titular}, vigente hasta el ${new Date(validado.vigenteHasta).toLocaleDateString("es-EC")}.` };
        } catch (e) {
          certificado = { estado: "fallo", detalle: `No se pudo guardar el certificado (${mensajeDeError(e)}). Cárguelo en Ajustes.` };
        }
      }
      setTerminado({ token: sesion.token, usuario: sesion.usuario, certificado });
    } catch (e) {
      setError(mensajeDeError(e));
      // Si otro equipo (o un intento anterior) ya configuró el sistema, se vuelve al ingreso normal
      void qc.invalidateQueries({ queryKey: ["setup", "estado"] });
    } finally {
      setOcupado(false);
    }
  };

  const comenzar = (): void => {
    if (terminado === null) return;
    qc.setQueryData(["setup", "estado"], { configurado: true });
    iniciar(terminado.token, terminado.usuario);
  };

  if (terminado !== null) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-900 p-6">
        <section aria-label="Configuración terminada" className="w-full max-w-lg space-y-4 rounded-2xl border border-slate-700 bg-slate-800 p-6 shadow-xl">
          <h1 className="text-xl font-bold text-white">¡Todo listo!</h1>
          <p className="text-sm text-slate-300">
            {empresa.razonSocial} quedó configurada con la sucursal «{empresa.sucursalNombre}» y el punto de emisión 001-001. Entrará como <strong>{terminado.usuario.username}</strong>.
          </p>
          <Aviso tipo={terminado.certificado.estado === "cargado" ? "exito" : "info"}>{terminado.certificado.detalle}</Aviso>
          <p className="text-sm text-slate-400">En «Ajustes» puede configurar la impresora, la balanza, los módulos y la sincronización entre cajas.</p>
          <Boton variante="primario" onClick={comenzar}>
            Comenzar
          </Boton>
        </section>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-900 p-6">
      <section aria-label="Asistente de configuración" className="w-full max-w-2xl space-y-5 rounded-2xl border border-slate-700 bg-slate-800 p-6 shadow-xl">
        <header className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-lg font-bold text-white">VP</div>
            <div>
              <h1 className="text-xl font-bold text-white">Bienvenido a VENDEYA POS</h1>
              <p className="text-xs uppercase tracking-widest text-brand-300">Configuración inicial</p>
            </div>
          </div>
          <ol aria-label="Pasos" className="flex gap-2 text-xs">
            {PASOS.map((p, i) => (
              <li key={p} aria-current={i === paso ? "step" : undefined} className={`flex-1 rounded-lg px-3 py-2 text-center ${i === paso ? "bg-brand-600 text-white" : i < paso ? "bg-slate-700 text-emerald-300" : "bg-slate-900 text-slate-500"}`}>
                {i + 1}. {p}
              </li>
            ))}
          </ol>
        </header>

        {paso === 0 ? (
          <form noValidate aria-label="Datos de la empresa" className="space-y-3" onSubmit={(e) => { e.preventDefault(); siguienteDesdeEmpresa(); }}>
            <div className="grid grid-cols-2 gap-3">
              <Campo etiqueta="RUC" valor={empresa.ruc} onCambio={(v) => cambiarEmpresa("ruc", v.replace(/\D/g, "").slice(0, 13))} autofoco />
              <Seleccion etiqueta="Tipo de contribuyente" valor={empresa.tipoContribuyente} onCambio={(v) => cambiarEmpresa("tipoContribuyente", v)} opciones={opciones(TIPOS_CONTRIBUYENTE, ETIQUETA_TIPO)} />
            </div>
            {rucPideConfirmar ? (
              <div className="space-y-1">
                <Aviso tipo="info">El RUC no pasa la verificación del dígito verificador. Si lo digitó bien (el SRI tiene casos especiales), confírmelo.</Aviso>
                <Casilla etiqueta="El RUC es correcto" marcada={confirmarRuc} onCambio={setConfirmarRuc} />
              </div>
            ) : null}
            <Campo etiqueta="Razón social" valor={empresa.razonSocial} onCambio={(v) => cambiarEmpresa("razonSocial", v)} />
            <Campo etiqueta="Nombre comercial" valor={empresa.nombreComercial} onCambio={(v) => cambiarEmpresa("nombreComercial", v)} />
            <Campo etiqueta="Dirección de la matriz" valor={empresa.direccionMatriz} onCambio={(v) => cambiarEmpresa("direccionMatriz", v)} />
            <div className="grid grid-cols-2 gap-3">
              <Campo etiqueta="Teléfono" valor={empresa.telefono} onCambio={(v) => cambiarEmpresa("telefono", v)} />
              <Campo etiqueta="Correo electrónico" tipo="email" valor={empresa.email} onCambio={(v) => cambiarEmpresa("email", v)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Seleccion etiqueta="Régimen tributario" valor={empresa.regimenTributario} onCambio={(v) => cambiarEmpresa("regimenTributario", v)} opciones={opciones(REGIMENES, ETIQUETA_REGIMEN)} />
              <Seleccion etiqueta="Ambiente del SRI" valor={empresa.ambienteSRI} onCambio={(v) => cambiarEmpresa("ambienteSRI", v as "PRUEBAS" | "PRODUCCION")} opciones={[{ valor: "PRUEBAS", titulo: "Pruebas (no tiene validez tributaria)" }, { valor: "PRODUCCION", titulo: "Producción" }]} />
            </div>
            <Casilla etiqueta="Obligado a llevar contabilidad" marcada={empresa.obligadoContabilidad} onCambio={(v) => cambiarEmpresa("obligadoContabilidad", v)} />
            <Campo etiqueta="Nombre de la sucursal" valor={empresa.sucursalNombre} onCambio={(v) => cambiarEmpresa("sucursalNombre", v)} />
            <p className="text-xs text-slate-400">Se creará el establecimiento 001 con el punto de emisión 001 (facturas 001-001-000000001).</p>
            {error !== null ? <Aviso tipo="error">{error}</Aviso> : null}
            <div className="flex justify-end">
              <Boton tipo="submit" variante="primario">
                Siguiente
              </Boton>
            </div>
          </form>
        ) : null}

        {paso === 1 ? (
          <form noValidate aria-label="Certificado de firma electrónica" className="space-y-3" onSubmit={(e) => { e.preventDefault(); siguienteDesdeCertificado(); }}>
            <p className="text-sm text-slate-300">El certificado de firma electrónica (archivo .p12 o .pfx) lo emite una entidad autorizada y es necesario para emitir facturas electrónicas. Puede cargarlo ahora o más tarde en Ajustes.</p>
            <label className="block text-sm text-slate-300">
              Archivo del certificado
              <input
                aria-label="Archivo del certificado"
                type="file"
                accept=".p12,.pfx"
                onChange={(e) => {
                  setArchivo(e.target.files?.[0] ?? null);
                  setValidado(null);
                  setError(null);
                }}
                className="mt-1 block w-full text-sm text-slate-300"
              />
            </label>
            <Campo etiqueta="Contraseña del certificado" tipo="password" valor={claveP12} onCambio={(v) => { setClaveP12(v); setValidado(null); setError(null); }} />
            <Casilla etiqueta="Confirmo que el titular es correcto aunque el RUC no figure en el certificado" marcada={confirmarTitular} onCambio={(v) => { setConfirmarTitular(v); setValidado(null); }} />
            <Boton variante="normal" onClick={() => void validarCertificado()} deshabilitado={ocupado || archivo === null}>
              {ocupado ? "Validando…" : "Validar certificado"}
            </Boton>
            {validado !== null ? (
              <div className="space-y-2" aria-label="Resultado de la validación">
                <Aviso tipo="exito">
                  Certificado válido de <strong>{validado.titular}</strong>, emitido por {validado.emisor}. Vigente hasta el {new Date(validado.vigenteHasta).toLocaleDateString("es-EC")} ({validado.diasRestantes} días).
                </Aviso>
                {validado.advertencias.map((a) => (
                  <Aviso key={a} tipo="info">
                    {a}
                  </Aviso>
                ))}
              </div>
            ) : null}
            {error !== null ? <Aviso tipo="error">{error}</Aviso> : null}
            <div className="flex justify-between">
              <Boton onClick={() => { setError(null); setPaso(0); }}>Atrás</Boton>
              <Boton tipo="submit" variante="primario">
                {archivo === null ? "Omitir por ahora" : "Siguiente"}
              </Boton>
            </div>
          </form>
        ) : null}

        {paso === 2 ? (
          <form noValidate aria-label="Giro y administrador" className="space-y-3" onSubmit={(e) => { e.preventDefault(); void finalizar(); }}>
            <Seleccion etiqueta="Giro del negocio" valor={admin.giro} onCambio={(v) => cambiarAdmin("giro", v)} opciones={opciones(GIROS, ETIQUETA_GIRO)} />
            <p className="text-xs text-slate-400">El giro activa los módulos que su negocio necesita; podrá ajustarlos después.</p>
            <h2 className="pt-2 text-sm font-semibold text-white">Usuario administrador</h2>
            <div className="grid grid-cols-2 gap-3">
              <Campo etiqueta="Nombre" valor={admin.nombre} onCambio={(v) => cambiarAdmin("nombre", v)} />
              <Campo etiqueta="Apellido" valor={admin.apellido} onCambio={(v) => cambiarAdmin("apellido", v)} />
            </div>
            <Campo etiqueta="Usuario" valor={admin.username} onCambio={(v) => cambiarAdmin("username", v.toLowerCase())} />
            <div className="grid grid-cols-2 gap-3">
              <Campo etiqueta="Contraseña" tipo="password" valor={admin.password} onCambio={(v) => cambiarAdmin("password", v)} />
              <Campo etiqueta="Repita la contraseña" tipo="password" valor={admin.repetir} onCambio={(v) => cambiarAdmin("repetir", v)} />
            </div>
            <p className="text-xs text-slate-400">Mínimo 8 caracteres con letras y números. Anótela: es quien administra el sistema.</p>
            {error !== null ? <Aviso tipo="error">{error}</Aviso> : null}
            <div className="flex justify-between">
              <Boton onClick={() => { setError(null); setPaso(1); }}>Atrás</Boton>
              <Boton tipo="submit" variante="primario" deshabilitado={ocupado}>
                {ocupado ? "Configurando…" : "Finalizar"}
              </Boton>
            </div>
          </form>
        ) : null}
      </section>
    </main>
  );
}

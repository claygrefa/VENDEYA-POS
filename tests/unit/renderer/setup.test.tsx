// @vitest-environment jsdom
// ============================================================
// tests/unit/renderer/setup.test.tsx — Asistente de configuración inicial y pantalla de Ajustes (API simulada)
// ============================================================
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useSesion } from "../../../src/renderer/store/sesion.store";
import { ApiSimulada, renderizarPos, servidorBasico, USUARIO, usuarioDe } from "../../helpers/renderer/entorno";

const ADMIN = { ...USUARIO, id: "u-admin", username: "dueno", nombre: "Ana", apellido: "Torres", rol: "ADMIN", permisos: ["configuracion:leer", "configuracion:actualizar", "caja:crear", "caja:leer", "ventas:crear", "clientes:leer", "reportes:leer"] };
const EMPRESA = { ruc: "1790016919001", razonSocial: "COMERCIAL ANDINA S.A.", nombreComercial: "ANDINA", direccionMatriz: "Av. Amazonas N34-12", telefono: "022345678", email: "info@andina.ec", tipoContribuyente: "SOCIEDAD", regimenTributario: "GENERAL", obligadoContabilidad: true, agenteRetencion: false, resolucionAgente: null, contribuyenteEspecial: null, ambienteSRI: "PRUEBAS" };
const MODULOS = { moduloLotes: false, moduloMesas: true, moduloBalanza: false, emitirFacturas: true, impresionTermica: true, sincronizacionLAN: false };
const SIN_CERT = { cargado: false, titular: null, emisor: null, huella: null, vencimiento: null, diasRestantes: null, vencido: false, advertencia: null };

function servidorNuevo(): ApiSimulada {
  return servidorBasico(new ApiSimulada())
    .en("GET /api/setup/estado", { cuerpo: { configurado: false } })
    .en("POST /api/setup", { status: 201, cuerpo: { empresaId: "e1" } })
    .en("POST /api/auth/login", { cuerpo: { token: "tok-admin", usuario: ADMIN } })
    .en("POST /api/setup/certificado", { cuerpo: { titular: "ANA TORRES", emisor: "BCE", vigenteHasta: "2028-05-01T00:00:00.000Z", diasRestantes: 700, advertencias: [] } })
    .en("PUT /api/configuracion/certificado", { cuerpo: { certificado: { ...SIN_CERT, cargado: true } } })
    .en("GET /api/turnos/actual", { status: 409, cuerpo: { error: "TURNO_REQUERIDO", mensaje: "Abra un turno" } });
}

async function escribir(usuario: ReturnType<typeof renderizarPos>["usuario"], etiqueta: string, texto: string, en: HTMLElement = document.body): Promise<void> {
  const campo = within(en).getByLabelText(etiqueta);
  await usuario.clear(campo);
  await usuario.type(campo, texto);
}

async function llenarEmpresa(usuario: ReturnType<typeof renderizarPos>["usuario"], ruc = EMPRESA.ruc): Promise<HTMLElement> {
  const form = await screen.findByRole("form", { name: "Datos de la empresa" });
  await escribir(usuario, "RUC", ruc, form);
  await escribir(usuario, "Razón social", EMPRESA.razonSocial, form);
  await escribir(usuario, "Nombre comercial", EMPRESA.nombreComercial, form);
  await escribir(usuario, "Dirección de la matriz", EMPRESA.direccionMatriz, form);
  await escribir(usuario, "Teléfono", EMPRESA.telefono, form);
  await escribir(usuario, "Correo electrónico", EMPRESA.email, form);
  return form;
}

describe("Asistente de configuración inicial", () => {
  it("un equipo sin empresa muestra el asistente en lugar del ingreso; uno configurado, el ingreso", async () => {
    renderizarPos({ api: servidorNuevo(), conSesion: false });
    expect(await screen.findByRole("region", { name: "Asistente de configuración" })).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Ingreso" })).toBeNull();
  });

  it("si el servidor no informa el estado se deja el ingreso normal", async () => {
    const api = servidorBasico(new ApiSimulada()).en("GET /api/setup/estado", { status: 500, cuerpo: { error: "ERROR_INTERNO", mensaje: "x" } });
    renderizarPos({ api, conSesion: false });
    expect(await screen.findByRole("form", { name: "Ingreso" })).toBeInTheDocument();
  });

  it("paso 1: valida los datos y pide confirmar un RUC con dígito verificador incorrecto", async () => {
    const { usuario } = renderizarPos({ api: servidorNuevo(), conSesion: false });
    const form = await llenarEmpresa(usuario, "1790016918001");
    expect(within(form).getByText(/no pasa la verificación del dígito verificador/)).toBeInTheDocument();
    await usuario.click(within(form).getByRole("button", { name: "Siguiente" }));
    expect(within(form).getByRole("alert")).toHaveTextContent("marque que es correcto");
    await usuario.click(within(form).getByLabelText("El RUC es correcto"));
    await usuario.click(within(form).getByRole("button", { name: "Siguiente" }));
    expect(await screen.findByRole("form", { name: "Certificado de firma electrónica" })).toBeInTheDocument();
  });

  it("paso 1: los datos incompletos o inválidos se señalan sin avanzar", async () => {
    const { usuario } = renderizarPos({ api: servidorNuevo(), conSesion: false });
    const form = await llenarEmpresa(usuario);
    await escribir(usuario, "Teléfono", "abc", form);
    await usuario.click(within(form).getByRole("button", { name: "Siguiente" }));
    expect(within(form).getByRole("alert")).toHaveTextContent("Teléfono inválido");
    await escribir(usuario, "Teléfono", "022345678", form);
    await escribir(usuario, "Correo electrónico", "no-es-correo", form);
    await usuario.click(within(form).getByRole("button", { name: "Siguiente" }));
    expect(within(form).getByRole("alert")).toHaveTextContent("Email inválido");
    expect(screen.queryByRole("form", { name: "Certificado de firma electrónica" })).toBeNull();
  });

  it("recorre los 3 pasos, crea la empresa, entra como administrador y guarda el certificado con su sesión", async () => {
    const api = servidorNuevo();
    const { usuario } = renderizarPos({ api, conSesion: false });
    const f1 = await llenarEmpresa(usuario);
    await usuario.click(within(f1).getByRole("button", { name: "Siguiente" }));

    const f2 = await screen.findByRole("form", { name: "Certificado de firma electrónica" });
    await usuario.upload(within(f2).getByLabelText("Archivo del certificado"), new File(["contenido-p12"], "firma.p12"));
    await escribir(usuario, "Contraseña del certificado", "Clave-P12", f2);
    await usuario.click(within(f2).getByRole("button", { name: "Siguiente" }));
    expect(within(f2).getByRole("alert")).toHaveTextContent("Valide el certificado");
    await usuario.click(within(f2).getByRole("button", { name: "Validar certificado" }));
    expect(await within(f2).findByText(/ANA TORRES/)).toBeInTheDocument();
    expect(api.llamadasA("POST /api/setup/certificado")[0]?.cuerpo).toMatchObject({ ruc: EMPRESA.ruc, password: "Clave-P12", archivoBase64: btoa("contenido-p12") });
    await usuario.click(within(f2).getByRole("button", { name: "Siguiente" }));

    const f3 = await screen.findByRole("form", { name: "Giro y administrador" });
    await usuario.selectOptions(within(f3).getByLabelText("Giro del negocio"), "RESTAURANTE");
    await escribir(usuario, "Nombre", "Ana", f3);
    await escribir(usuario, "Apellido", "Torres", f3);
    await escribir(usuario, "Usuario", "dueno", f3);
    await escribir(usuario, "Contraseña", "Clave-Segura1", f3);
    await escribir(usuario, "Repita la contraseña", "otra-clave1", f3);
    await usuario.click(within(f3).getByRole("button", { name: "Finalizar" }));
    expect(within(f3).getByRole("alert")).toHaveTextContent("no coinciden");
    expect(api.llamadasA("POST /api/setup")).toHaveLength(0);

    await escribir(usuario, "Repita la contraseña", "Clave-Segura1", f3);
    await usuario.click(within(f3).getByRole("button", { name: "Finalizar" }));
    const listo = await screen.findByRole("region", { name: "Configuración terminada" });
    expect(within(listo).getByText(/Certificado de ANA TORRES/)).toBeInTheDocument();

    expect(api.llamadasA("POST /api/setup")[0]?.cuerpo).toMatchObject({
      empresa: { ruc: EMPRESA.ruc, razonSocial: EMPRESA.razonSocial, tipoContribuyente: "PERSONA_NATURAL", regimenTributario: "GENERAL", ambienteSRI: "PRUEBAS", obligadoContabilidad: false },
      confirmarRuc: false,
      sucursal: { nombre: "Matriz", direccion: EMPRESA.direccionMatriz },
      giro: "RESTAURANTE",
      admin: { username: "dueno", password: "Clave-Segura1", nombre: "Ana", apellido: "Torres" },
    });
    const put = api.llamadasA("PUT /api/configuracion/certificado")[0];
    expect(put?.cabeceras["authorization"]).toBe("Bearer tok-admin");
    expect(put?.cuerpo).toMatchObject({ password: "Clave-P12" });
    expect(useSesion.getState().token).toBeNull(); // todavía no entró: primero ve el resumen

    await usuario.click(within(listo).getByRole("button", { name: "Comenzar" }));
    await waitFor(() => expect(useSesion.getState().token).toBe("tok-admin"));
    expect(useSesion.getState().usuario?.username).toBe("dueno");
  });

  it("un certificado inválido muestra el motivo y no deja avanzar; sin archivo se puede omitir y queda pendiente", async () => {
    const api = servidorNuevo().en("POST /api/setup/certificado", { status: 400, cuerpo: { error: "VALIDACION", mensaje: "La contraseña es incorrecta" } });
    const { usuario } = renderizarPos({ api, conSesion: false });
    await usuario.click(within(await llenarEmpresa(usuario)).getByRole("button", { name: "Siguiente" }));
    const f2 = await screen.findByRole("form", { name: "Certificado de firma electrónica" });
    expect(within(f2).getByRole("button", { name: "Omitir por ahora" })).toBeInTheDocument();
    await usuario.upload(within(f2).getByLabelText("Archivo del certificado"), new File(["x"], "firma.p12"));
    await escribir(usuario, "Contraseña del certificado", "mal", f2);
    await usuario.click(within(f2).getByRole("button", { name: "Validar certificado" }));
    expect(await within(f2).findByRole("alert")).toHaveTextContent("La contraseña es incorrecta");
    await usuario.click(within(f2).getByRole("button", { name: "Siguiente" }));
    expect(within(f2).getByRole("alert")).toHaveTextContent("Valide el certificado");
  });

  it("sin certificado el asistente termina igual y avisa que quedó pendiente (no se llama a la carga)", async () => {
    const api = servidorNuevo();
    const { usuario } = renderizarPos({ api, conSesion: false });
    await usuario.click(within(await llenarEmpresa(usuario)).getByRole("button", { name: "Siguiente" }));
    await usuario.click(within(await screen.findByRole("form", { name: "Certificado de firma electrónica" })).getByRole("button", { name: "Omitir por ahora" }));
    const f3 = await screen.findByRole("form", { name: "Giro y administrador" });
    await escribir(usuario, "Nombre", "Ana", f3);
    await escribir(usuario, "Apellido", "Torres", f3);
    await escribir(usuario, "Usuario", "dueno", f3);
    await escribir(usuario, "Contraseña", "Clave-Segura1", f3);
    await escribir(usuario, "Repita la contraseña", "Clave-Segura1", f3);
    await usuario.click(within(f3).getByRole("button", { name: "Finalizar" }));
    const listo = await screen.findByRole("region", { name: "Configuración terminada" });
    expect(within(listo).getByText(/Quedó pendiente/)).toBeInTheDocument();
    expect(api.llamadasA("PUT /api/configuracion/certificado")).toHaveLength(0);
  });

  it("si el servidor rechaza el alta (ya configurado) se muestra el motivo", async () => {
    const api = servidorNuevo().en("POST /api/setup", { status: 409, cuerpo: { error: "ESTADO_INVALIDO", mensaje: "El sistema ya está configurado" } });
    const { usuario } = renderizarPos({ api, conSesion: false });
    await usuario.click(within(await llenarEmpresa(usuario)).getByRole("button", { name: "Siguiente" }));
    await usuario.click(within(await screen.findByRole("form", { name: "Certificado de firma electrónica" })).getByRole("button", { name: "Omitir por ahora" }));
    const f3 = await screen.findByRole("form", { name: "Giro y administrador" });
    await escribir(usuario, "Nombre", "Ana", f3);
    await escribir(usuario, "Apellido", "Torres", f3);
    await escribir(usuario, "Usuario", "dueno", f3);
    await escribir(usuario, "Contraseña", "Clave-Segura1", f3);
    await escribir(usuario, "Repita la contraseña", "Clave-Segura1", f3);
    await usuario.click(within(f3).getByRole("button", { name: "Finalizar" }));
    expect(await within(f3).findByRole("alert")).toHaveTextContent("El sistema ya está configurado");
    expect(api.llamadasA("POST /api/auth/login")).toHaveLength(0);
  });

  it("la contraseña débil del administrador se rechaza antes de llamar al servidor", async () => {
    const api = servidorNuevo();
    const { usuario } = renderizarPos({ api, conSesion: false });
    await usuario.click(within(await llenarEmpresa(usuario)).getByRole("button", { name: "Siguiente" }));
    await usuario.click(within(await screen.findByRole("form", { name: "Certificado de firma electrónica" })).getByRole("button", { name: "Omitir por ahora" }));
    const f3 = await screen.findByRole("form", { name: "Giro y administrador" });
    await escribir(usuario, "Nombre", "Ana", f3);
    await escribir(usuario, "Apellido", "Torres", f3);
    await escribir(usuario, "Usuario", "dueno", f3);
    await escribir(usuario, "Contraseña", "corta1", f3);
    await escribir(usuario, "Repita la contraseña", "corta1", f3);
    await usuario.click(within(f3).getByRole("button", { name: "Finalizar" }));
    expect(within(f3).getByRole("alert")).toHaveTextContent("al menos 8");
    expect(api.llamadasA("POST /api/setup")).toHaveLength(0);
  });
});

// ── Ajustes ──────────────────────────────────────────────────

function servidorAjustes(): ApiSimulada {
  const estado = { empresa: { ...EMPRESA }, giroNegocio: "RESTAURANTE", modulos: { ...MODULOS } };
  const impresora: Record<string, unknown> = { conexion: "NINGUNA", direccion: null, puerto: 9100, ancho: 80, impresionTermica: true, aperturaGaveta: false };
  return servidorBasico(new ApiSimulada())
    .en("GET /api/configuracion", () => ({ cuerpo: estado }))
    .en("PATCH /api/configuracion/empresa", (p) => { Object.assign(estado.empresa, p.cuerpo); return { cuerpo: estado }; })
    .en("PATCH /api/configuracion/modulos", (p) => { Object.assign(estado.modulos, p.cuerpo); return { cuerpo: estado }; })
    .en("POST /api/configuracion/giro", (p) => { estado.giroNegocio = (p.cuerpo as { giro: string }).giro; return { cuerpo: estado }; })
    .en("GET /api/impresora", () => ({ cuerpo: impresora }))
    .en("PUT /api/impresora", (p) => { Object.assign(impresora, { direccion: null }, p.cuerpo); return { cuerpo: impresora }; })
    .en("POST /api/impresora/probar", { status: 204 })
    .en("GET /api/balanza", { cuerpo: { habilitada: false, puerto: null, baudios: 9600, protocolo: "GENERICO", etiqueta: "PESO" } })
    .en("PUT /api/balanza", (p) => ({ cuerpo: { habilitada: false, ...(p.cuerpo as object) } }))
    .en("GET /api/configuracion/certificado", { cuerpo: SIN_CERT })
    .en("PUT /api/configuracion/certificado", { cuerpo: { certificado: { ...SIN_CERT, cargado: true } } })
    .en("GET /api/sync/cajas", { cuerpo: { cajas: [{ cajaId: "caja-2", usuario: "maria", desde: "2026-11-24T10:00:00Z" }] } });
}

async function abrirAjustes(api: ApiSimulada) {
  const r = renderizarPos({ api, usuario: ADMIN });
  await r.usuario.click(await screen.findByRole("button", { name: "Ajustes" }));
  return r;
}

describe("Ajustes", () => {
  it("solo quien tiene configuracion:actualizar ve la opción en el menú", async () => {
    renderizarPos({ api: servidorAjustes(), usuario: usuarioDe("SUPERVISOR") });
    await screen.findByRole("navigation", { name: "Menú principal" });
    expect(screen.queryByRole("button", { name: "Ajustes" })).toBeNull();
  });

  it("empresa: el RUC no se edita, se guardan los cambios sin enviarlo y pasar a producción pide confirmación", async () => {
    const api = servidorAjustes();
    const { usuario } = await abrirAjustes(api);
    const form = await screen.findByRole("form", { name: "Datos de la empresa" });
    await waitFor(() => expect(within(form).getByLabelText("Razón social")).toHaveValue(EMPRESA.razonSocial));
    expect(within(form).getByLabelText("RUC")).toBeDisabled();
    await escribir(usuario, "Nombre comercial", "ANDINA EXPRESS", form);
    await usuario.selectOptions(within(form).getByLabelText("Ambiente del SRI"), "PRODUCCION");
    const guardar = within(form).getByRole("button", { name: "Guardar" });
    expect(guardar).toBeDisabled();
    await usuario.click(within(form).getByLabelText("Entiendo que los comprobantes tendrán validez tributaria"));
    await usuario.click(guardar);
    expect(await within(form).findByText("Datos de la empresa guardados")).toBeInTheDocument();
    const cuerpo = api.llamadasA("PATCH /api/configuracion/empresa")[0]?.cuerpo as Record<string, unknown>;
    expect(cuerpo).toMatchObject({ nombreComercial: "ANDINA EXPRESS", ambienteSRI: "PRODUCCION", razonSocial: EMPRESA.razonSocial });
    expect(cuerpo).not.toHaveProperty("ruc");
  });

  it("empresa: un error del servidor se muestra", async () => {
    const api = servidorAjustes().en("PATCH /api/configuracion/empresa", { status: 400, cuerpo: { error: "VALIDACION", mensaje: "Email inválido" } });
    const { usuario } = await abrirAjustes(api);
    const form = await screen.findByRole("form", { name: "Datos de la empresa" });
    await waitFor(() => expect(within(form).getByLabelText("Razón social")).toHaveValue(EMPRESA.razonSocial));
    await escribir(usuario, "Nombre comercial", "OTRO", form);
    await usuario.click(within(form).getByRole("button", { name: "Guardar" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent("Email inválido");
  });

  it("módulos: activar uno lo envía solo; cambiar de giro exige confirmar el reajuste", async () => {
    const api = servidorAjustes();
    const { usuario } = await abrirAjustes(api);
    await usuario.click(await screen.findByRole("tab", { name: "Giro y módulos" }));
    const lotes = await screen.findByLabelText("Lotes de productos");
    expect(lotes).not.toBeChecked();
    await usuario.click(lotes);
    await waitFor(() => expect(api.llamadasA("PATCH /api/configuracion/modulos")[0]?.cuerpo).toEqual({ moduloLotes: true }));
    await waitFor(() => expect(screen.getByLabelText("Lotes de productos")).toBeChecked());

    await usuario.selectOptions(screen.getByLabelText("Giro del negocio"), "FARMACIA");
    expect(screen.getByRole("button", { name: "Aplicar giro" })).toBeDisabled();
    await usuario.click(screen.getByLabelText("Entiendo que se reajustan los módulos"));
    await usuario.click(screen.getByRole("button", { name: "Aplicar giro" }));
    await waitFor(() => expect(api.llamadasA("POST /api/configuracion/giro")[0]?.cuerpo).toEqual({ giro: "FARMACIA" }));
    expect(await screen.findByText(/Giro aplicado/)).toBeInTheDocument();
  });

  it("impresora: pide la dirección según la conexión, guarda y manda una prueba", async () => {
    const api = servidorAjustes();
    const { usuario } = await abrirAjustes(api);
    await usuario.click(await screen.findByRole("tab", { name: "Impresora" }));
    const form = await screen.findByRole("form", { name: "Impresora térmica" });
    await waitFor(() => expect(within(form).getByLabelText("Conexión")).toHaveValue("NINGUNA"));
    expect(within(form).getByRole("button", { name: "Imprimir prueba" })).toBeDisabled();
    await usuario.selectOptions(within(form).getByLabelText("Conexión"), "RED");
    await escribir(usuario, "Dirección IP o nombre del equipo", "192.168.1.60", form);
    await usuario.selectOptions(within(form).getByLabelText("Ancho del papel"), "58");
    await usuario.click(within(form).getByRole("button", { name: "Guardar" }));
    expect(await within(form).findByText("Impresora guardada")).toBeInTheDocument();
    expect(api.llamadasA("PUT /api/impresora")[0]?.cuerpo).toEqual({ conexion: "RED", direccion: "192.168.1.60", puerto: 9100, ancho: 58 });
    await waitFor(() => expect(within(form).getByRole("button", { name: "Imprimir prueba" })).toBeEnabled());
    await usuario.click(within(form).getByRole("button", { name: "Imprimir prueba" }));
    expect(await within(form).findByText(/página de prueba/)).toBeInTheDocument();
    expect(api.llamadasA("POST /api/impresora/probar")).toHaveLength(1);
  });

  it("balanza: avisa si el módulo está apagado y guarda puerto, velocidad, protocolo y etiqueta", async () => {
    const api = servidorAjustes();
    const { usuario } = await abrirAjustes(api);
    await usuario.click(await screen.findByRole("tab", { name: "Balanza" }));
    const form = await screen.findByRole("form", { name: "Balanza" });
    expect(await within(form).findByText(/módulo de balanza está desactivado/)).toBeInTheDocument();
    await escribir(usuario, "Puerto serie (COM3, /dev/ttyUSB0…)", "COM4", form);
    await usuario.selectOptions(within(form).getByLabelText("Velocidad (baudios)"), "19200");
    await usuario.selectOptions(within(form).getByLabelText("Protocolo"), "CAS");
    await usuario.selectOptions(within(form).getByLabelText("La etiqueta de la balanza lleva"), "PRECIO");
    await usuario.click(within(form).getByRole("button", { name: "Guardar" }));
    expect(await within(form).findByText("Balanza guardada")).toBeInTheDocument();
    expect(api.llamadasA("PUT /api/balanza")[0]?.cuerpo).toEqual({ puerto: "COM4", baudios: 19200, protocolo: "CAS", etiqueta: "PRECIO" });
  });

  it("certificado: sin certificado avisa; carga uno nuevo; con certificado vencido muestra la advertencia y permite renovar o quitar", async () => {
    const api = servidorAjustes();
    const { usuario } = await abrirAjustes(api);
    await usuario.click(await screen.findByRole("tab", { name: "Certificado de firma" }));
    expect(await screen.findByText(/No hay un certificado cargado/)).toBeInTheDocument();
    const form = screen.getByRole("form", { name: "Cargar certificado" });
    expect(within(form).getByRole("button", { name: "Guardar certificado" })).toBeDisabled();
    await usuario.upload(within(form).getByLabelText("Archivo del certificado"), new File(["p12"], "firma.p12"));
    await escribir(usuario, "Contraseña del certificado", "Clave-P12", form);
    api.en("GET /api/configuracion/certificado", { cuerpo: { cargado: true, titular: "ANA TORRES", emisor: "BCE", huella: "ab", vencimiento: "2026-10-01T00:00:00.000Z", diasRestantes: -54, vencido: true, advertencia: "El certificado venció el 01/10/2026: cargue uno vigente para seguir facturando" } });
    await usuario.click(within(form).getByRole("button", { name: "Guardar certificado" }));
    expect(await screen.findByText("Certificado guardado")).toBeInTheDocument();
    expect(api.llamadasA("PUT /api/configuracion/certificado")[0]?.cuerpo).toEqual({ archivoBase64: btoa("p12"), password: "Clave-P12" });
    expect(await screen.findByText(/El certificado venció/)).toBeInTheDocument();
    expect(screen.getByLabelText("Estado del certificado")).toHaveTextContent("ANA TORRES");
    expect(screen.getByRole("button", { name: "Reemplazar certificado" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Quitar certificado" })).toBeInTheDocument();
  });

  it("certificado: la contraseña incorrecta se informa sin perder el archivo elegido", async () => {
    const api = servidorAjustes().en("PUT /api/configuracion/certificado", { status: 400, cuerpo: { error: "VALIDACION", mensaje: "La contraseña es incorrecta" } });
    const { usuario } = await abrirAjustes(api);
    await usuario.click(await screen.findByRole("tab", { name: "Certificado de firma" }));
    const form = await screen.findByRole("form", { name: "Cargar certificado" });
    await usuario.upload(within(form).getByLabelText("Archivo del certificado"), new File(["p12"], "firma.p12"));
    await escribir(usuario, "Contraseña del certificado", "mal", form);
    await usuario.click(within(form).getByRole("button", { name: "Guardar certificado" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent("La contraseña es incorrecta");
  });

  it("red local: activa la sincronización y lista las cajas conectadas", async () => {
    const api = servidorAjustes();
    const { usuario } = await abrirAjustes(api);
    await usuario.click(await screen.findByRole("tab", { name: "Red local" }));
    expect(await screen.findByText(/Active la sincronización/)).toBeInTheDocument();
    expect(api.llamadasA("GET /api/sync/cajas")).toHaveLength(0);
    await usuario.click(screen.getByLabelText("Sincronizar varias cajas en la red local"));
    await waitFor(() => expect(api.llamadasA("PATCH /api/configuracion/modulos")[0]?.cuerpo).toEqual({ sincronizacionLAN: true }));
    const lista = await screen.findByRole("list", { name: "Cajas conectadas" });
    expect(within(lista).getByText(/caja-2 · maria/)).toBeInTheDocument();
  });
});

// @vitest-environment jsdom
// ============================================================
// tests/integration/renderer/setup-backend.test.tsx
// El asistente de configuración y la pantalla de Ajustes (interfaz real) contra el backend REAL con la base de datos VACÍA,
// como queda un equipo recién instalado: de «sin empresa» a «turno abierto y ajustes cambiados», verificando la base de datos.
// ============================================================
import "@testing-library/jest-dom/vitest";
import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import React from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { AplicacionPos, crearQueryClient } from "../../../src/renderer/App";
import { ApiCliente } from "../../../src/renderer/services/api";
import { ProveedorPos, type ContextoPos } from "../../../src/renderer/services/contexto";
import { PosApi } from "../../../src/renderer/services/pos.api";
import { useCarrito } from "../../../src/renderer/store/carrito.store";
import { useNavegacion } from "../../../src/renderer/store/navegacion.store";
import { useSesion } from "../../../src/renderer/store/sesion.store";
import { iniciarBackend, type BackendHandle } from "../../../src/server";
import { generarP12Prueba } from "../../helpers/certificados.helper";
import { SocketSimulado } from "../../helpers/renderer/entorno";

const RUC = "1790016919001";
let dir = "";
let b: BackendHandle;

function montar() {
  useCarrito.setState({ lineas: [], cliente: null });
  useNavegacion.setState({ vista: null });
  useSesion.setState({ token: null, usuario: null, turno: null, puntoEmision: null, modoTactil: false });
  const contexto: ContextoPos = {
    api: new PosApi(new ApiCliente({ baseUrl: b.url, cajaId: "caja-wizard", obtenerToken: () => useSesion.getState().token, alNoAutenticado: () => useSesion.getState().cerrar() })),
    crearSocket: (url) => new SocketSimulado(url),
    cajaId: "caja-wizard",
  };
  const vista = render(
    <QueryClientProvider client={crearQueryClient()}>
      <ProveedorPos valor={contexto}>
        <AplicacionPos baseUrl={b.url} />
      </ProveedorPos>
    </QueryClientProvider>
  );
  return { ...vista, usuario: userEvent.setup({ delay: null }) };
}

type U = ReturnType<typeof montar>["usuario"];
async function escribir(u: U, etiqueta: string, texto: string, en: HTMLElement): Promise<void> {
  const campo = within(en).getByLabelText(etiqueta);
  await u.clear(campo);
  await u.type(campo, texto);
}
const archivoP12 = (p: { archivo: Buffer }, nombre = "firma.p12"): File => new File([new Uint8Array(p.archivo)], nombre);

beforeAll(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), "vendeya-wiz-"));
  b = await iniciarBackend({ dbPath: path.join(dir, "data", "vendeya.db"), migrationsDir: path.resolve(__dirname, "../../../prisma/migrations"), port: 0, logLevel: "silent" });
}, 60_000);

afterEach(() => cleanup());

afterAll(async () => {
  await b.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("Asistente de configuración con el backend real (base vacía)", () => {
  it("de un equipo recién instalado a un negocio operando: certificados inválidos se rechazan, el alta crea todo y entra el administrador", async () => {
    const { usuario } = montar();

    // Paso 1
    const f1 = await screen.findByRole("form", { name: "Datos de la empresa" });
    await escribir(usuario, "RUC", RUC, f1);
    await escribir(usuario, "Razón social", "COMERCIAL ANDINA S.A.", f1);
    await escribir(usuario, "Nombre comercial", "ANDINA", f1);
    await escribir(usuario, "Dirección de la matriz", "Av. Amazonas N34-12, Quito", f1);
    await escribir(usuario, "Teléfono", "022345678", f1);
    await escribir(usuario, "Correo electrónico", "info@andina.ec", f1);
    await usuario.selectOptions(within(f1).getByLabelText("Tipo de contribuyente"), "SOCIEDAD");
    await usuario.click(within(f1).getByLabelText("Obligado a llevar contabilidad"));
    await usuario.click(within(f1).getByRole("button", { name: "Siguiente" }));

    // Paso 2: contraseña incorrecta, certificado de otro RUC y vencido → el servidor real los rechaza con su motivo
    const f2 = await screen.findByRole("form", { name: "Certificado de firma electrónica" });
    const bueno = generarP12Prueba({ identificacion: RUC, password: "Clave-P12-1", cn: "ANA TORRES" });
    await usuario.upload(within(f2).getByLabelText("Archivo del certificado"), archivoP12(bueno));
    await escribir(usuario, "Contraseña del certificado", "equivocada", f2);
    await usuario.click(within(f2).getByRole("button", { name: "Validar certificado" }));
    expect(await within(f2).findByRole("alert")).toHaveTextContent(/contraseña es incorrecta/);

    const ajeno = generarP12Prueba({ identificacion: "0992345678001", password: "Otra-1" });
    await usuario.upload(within(f2).getByLabelText("Archivo del certificado"), archivoP12(ajeno));
    await escribir(usuario, "Contraseña del certificado", "Otra-1", f2);
    await usuario.click(within(f2).getByRole("button", { name: "Validar certificado" }));
    expect(await within(f2).findByRole("alert")).toHaveTextContent(/no corresponde al RUC/);

    const vencido = generarP12Prueba({ identificacion: RUC, password: "Vieja-1", desde: new Date(Date.now() - 500 * 86_400_000), vigenciaDias: 100 });
    await usuario.upload(within(f2).getByLabelText("Archivo del certificado"), archivoP12(vencido));
    await escribir(usuario, "Contraseña del certificado", "Vieja-1", f2);
    await usuario.click(within(f2).getByRole("button", { name: "Validar certificado" }));
    expect(await within(f2).findByRole("alert")).toHaveTextContent(/vencido desde/);

    // El correcto
    await usuario.upload(within(f2).getByLabelText("Archivo del certificado"), archivoP12(bueno));
    await escribir(usuario, "Contraseña del certificado", "Clave-P12-1", f2);
    await usuario.click(within(f2).getByRole("button", { name: "Validar certificado" }));
    expect(await within(f2).findByText(/Certificado válido de/)).toHaveTextContent("ANA TORRES");
    expect(await b.prisma.empresa.count()).toBe(0); // validar no guarda nada
    await usuario.click(within(f2).getByRole("button", { name: "Siguiente" }));

    // Paso 3
    const f3 = await screen.findByRole("form", { name: "Giro y administrador" });
    await usuario.selectOptions(within(f3).getByLabelText("Giro del negocio"), "RESTAURANTE");
    await escribir(usuario, "Nombre", "Ana", f3);
    await escribir(usuario, "Apellido", "Torres", f3);
    await escribir(usuario, "Usuario", "dueno", f3);
    await escribir(usuario, "Contraseña", "Clave-Segura1", f3);
    await escribir(usuario, "Repita la contraseña", "Clave-Segura1", f3);
    await usuario.click(within(f3).getByRole("button", { name: "Finalizar" }));
    const listo = await screen.findByRole("region", { name: "Configuración terminada" }, { timeout: 15_000 });
    expect(within(listo).getByText(/Certificado de ANA TORRES/)).toBeInTheDocument();

    // La base quedó lista y con el certificado cifrado en disco
    const empresa = await b.prisma.empresa.findFirstOrThrow();
    expect(empresa).toMatchObject({ ruc: RUC, razonSocial: "COMERCIAL ANDINA S.A.", tipoContribuyente: "SOCIEDAD", obligadoContabilidad: true, ambienteSRI: "PRUEBAS" });
    expect(await b.prisma.configuracionGiro.findFirstOrThrow()).toMatchObject({ giroNegocio: "RESTAURANTE", moduloMesas: true, certTitular: "ANA TORRES", rutaCertificadoP12: expect.any(String) });
    expect(await b.prisma.puntoEmision.count()).toBe(1);

    // Comenzar → como administrador debe abrir turno en el punto 001-001 y ya ve el menú completo
    await usuario.click(within(listo).getByRole("button", { name: "Comenzar" }));
    const turno = await screen.findByRole("form", { name: "Apertura de turno" });
    expect(await within(turno).findByText(/001-001/)).toBeInTheDocument();
    await escribir(usuario, "Monto de apertura", "50", turno);
    await usuario.click(within(turno).getByRole("button", { name: "Abrir turno" }));
    expect(await screen.findByRole("navigation", { name: "Menú principal" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ajustes" })).toBeInTheDocument();
  }, 90_000);

  it("con la empresa creada, el equipo ya no ofrece el asistente: al salir se muestra el ingreso", async () => {
    montar();
    expect(await screen.findByRole("form", { name: "Ingreso" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Asistente de configuración" })).toBeNull();
  });
});

describe("Ajustes con el backend real", () => {
  it("cambia empresa, módulos, giro, impresora, balanza y renueva el certificado; todo queda en la base de datos", async () => {
    const { usuario } = montar();
    const form = await screen.findByRole("form", { name: "Ingreso" });
    await usuario.type(within(form).getByLabelText("Usuario"), "dueno");
    await usuario.type(within(form).getByLabelText("Contraseña"), "Clave-Segura1");
    await usuario.click(within(form).getByRole("button", { name: "Ingresar" }));
    // el turno que abrió antes sigue vigente: entra directo al menú
    await usuario.click(await screen.findByRole("button", { name: "Ajustes" }));

    // Empresa
    const emp = await screen.findByRole("form", { name: "Datos de la empresa" });
    await waitFor(() => expect(within(emp).getByLabelText("Razón social")).toHaveValue("COMERCIAL ANDINA S.A."));
    await escribir(usuario, "Nombre comercial", "ANDINA EXPRESS", emp);
    await escribir(usuario, "Teléfono", "022999999", emp);
    await usuario.click(within(emp).getByRole("button", { name: "Guardar" }));
    expect(await within(emp).findByText("Datos de la empresa guardados")).toBeInTheDocument();
    expect(await b.prisma.empresa.findFirstOrThrow()).toMatchObject({ nombreComercial: "ANDINA EXPRESS", telefono: "022999999", ruc: RUC });

    // Módulos y giro
    await usuario.click(screen.getByRole("tab", { name: "Giro y módulos" }));
    await usuario.click(await screen.findByLabelText("Lotes de productos"));
    await waitFor(async () => expect((await b.prisma.configuracionGiro.findFirstOrThrow()).moduloLotes).toBe(true));
    // la sección se vuelve a pintar al refrescar los ajustes: se espera cada control en vez de leerlo al instante
    await usuario.selectOptions(await screen.findByLabelText("Giro del negocio"), "FARMACIA");
    await usuario.click(await screen.findByLabelText("Entiendo que se reajustan los módulos"));
    await usuario.click(await screen.findByRole("button", { name: "Aplicar giro" }));
    await screen.findByText(/Giro aplicado/);
    expect(await b.prisma.configuracionGiro.findFirstOrThrow()).toMatchObject({ giroNegocio: "FARMACIA", moduloVencimientos: true, moduloMesas: false });

    // Impresora
    await usuario.click(screen.getByRole("tab", { name: "Impresora" }));
    const imp = await screen.findByRole("form", { name: "Impresora térmica" });
    await waitFor(() => expect(within(imp).getByLabelText("Conexión")).toBeInTheDocument());
    await usuario.selectOptions(within(imp).getByLabelText("Conexión"), "RED");
    await escribir(usuario, "Dirección IP o nombre del equipo", "192.168.1.60", imp);
    await usuario.click(within(imp).getByRole("button", { name: "Guardar" }));
    expect(await within(imp).findByText("Impresora guardada")).toBeInTheDocument();
    expect(await b.prisma.configuracionGiro.findFirstOrThrow()).toMatchObject({ impresoraConexion: "RED", impresoraDireccion: "192.168.1.60", impresoraPuerto: 9100 });

    // Balanza (puerto inválido → el servidor lo rechaza; luego uno válido)
    await usuario.click(screen.getByRole("tab", { name: "Balanza" }));
    const bal = await screen.findByRole("form", { name: "Balanza" });
    await waitFor(() => expect(within(bal).getByLabelText("Protocolo")).toBeInTheDocument());
    await escribir(usuario, "Puerto serie (COM3, /dev/ttyUSB0…)", "impresora", bal);
    await usuario.click(within(bal).getByRole("button", { name: "Guardar" }));
    expect(await within(bal).findByRole("alert")).toHaveTextContent(/Puerto inválido/);
    await escribir(usuario, "Puerto serie (COM3, /dev/ttyUSB0…)", "COM4", bal);
    await usuario.selectOptions(within(bal).getByLabelText("Protocolo"), "CAS");
    await usuario.click(within(bal).getByRole("button", { name: "Guardar" }));
    expect(await within(bal).findByText("Balanza guardada")).toBeInTheDocument();
    expect(await b.prisma.configuracionGiro.findFirstOrThrow()).toMatchObject({ balanzaPuerto: "COM4", balanzaProtocolo: "CAS" });

    // Certificado: el cargado en el asistente aparece; uno de otro titular se rechaza y uno nuevo lo renueva
    await usuario.click(screen.getByRole("tab", { name: "Certificado de firma" }));
    const estado = await screen.findByLabelText("Estado del certificado");
    await waitFor(() => expect(estado).toHaveTextContent("ANA TORRES"));
    const cargar = await screen.findByRole("form", { name: "Cargar certificado" });
    const ajeno = generarP12Prueba({ identificacion: "0992345678001", password: "Otra-1" });
    await usuario.upload(within(cargar).getByLabelText("Archivo del certificado"), archivoP12(ajeno));
    await escribir(usuario, "Contraseña del certificado", "Otra-1", cargar);
    await usuario.click(within(cargar).getByRole("button", { name: "Reemplazar certificado" }));
    expect(await within(cargar).findByRole("alert")).toHaveTextContent(/no corresponde al RUC/);
    const nuevo = generarP12Prueba({ identificacion: RUC, password: "Nueva-1", cn: "ANA TORRES RENOVADO" });
    await usuario.upload(within(cargar).getByLabelText("Archivo del certificado"), archivoP12(nuevo));
    await escribir(usuario, "Contraseña del certificado", "Nueva-1", cargar);
    await usuario.click(within(cargar).getByRole("button", { name: "Reemplazar certificado" }));
    expect(await screen.findByText("Certificado guardado")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Estado del certificado")).toHaveTextContent("ANA TORRES RENOVADO"));
    expect((await b.prisma.configuracionGiro.findFirstOrThrow()).certTitular).toBe("ANA TORRES RENOVADO");
  }, 120_000);
});

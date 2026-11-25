// @vitest-environment jsdom
// ============================================================
// tests/integration/renderer/licencia-backend.test.tsx
// La interfaz real contra el backend REAL con licenciamiento activo y un servidor de licencias simulado: de «sin licencia» (el
// administrador entra a Ajustes, no se queda atrapado en la apertura de turno) a «turno abierto» tras activar con una clave.
// ============================================================
import "@testing-library/jest-dom/vitest";
import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { AplicacionPos, crearQueryClient } from "../../../src/renderer/App";
import { ApiCliente } from "../../../src/renderer/services/api";
import { ProveedorPos, type ContextoPos } from "../../../src/renderer/services/contexto";
import { PosApi } from "../../../src/renderer/services/pos.api";
import { useCarrito } from "../../../src/renderer/store/carrito.store";
import { useNavegacion } from "../../../src/renderer/store/navegacion.store";
import { useSesion } from "../../../src/renderer/store/sesion.store";
import { SocketSimulado } from "../../helpers/renderer/entorno";
import { dispositivoDePrueba, generarClavesLicencia, ServidorLicenciasSimulado } from "../../helpers/licencias.helper";
import { crearEntorno, PASSWORD_ADMIN, type Entorno } from "../helpers/entorno.helper";

const claves = generarClavesLicencia();
const servidor = new ServidorLicenciasSimulado(claves);
const CLAVE = "ABCD-1234-5678-WXYZ";
let env: Entorno;

function montar() {
  useCarrito.setState({ lineas: [], cliente: null });
  useNavegacion.setState({ vista: null, seccionAjustes: null });
  useSesion.setState({ token: null, usuario: null, turno: null, puntoEmision: null, modoTactil: false });
  const contexto: ContextoPos = {
    api: new PosApi(new ApiCliente({ baseUrl: env.backend.url, cajaId: "caja-lic", obtenerToken: () => useSesion.getState().token, alNoAutenticado: () => useSesion.getState().cerrar() })),
    crearSocket: (url) => new SocketSimulado(url),
    cajaId: "caja-lic",
  };
  render(
    <QueryClientProvider client={crearQueryClient()}>
      <ProveedorPos valor={contexto}>
        <AplicacionPos baseUrl={env.backend.url} />
      </ProveedorPos>
    </QueryClientProvider>
  );
  return userEvent.setup({ delay: null });
}

beforeAll(async () => {
  env = await crearEntorno({ licencia: { requerida: true, cliente: servidor, clavePublica: claves.publica, dispositivo: dispositivoDePrueba("equipo-ui", "CAJA-UI") } });
  const ruc = (await env.prisma.empresa.findFirstOrThrow()).ruc;
  servidor.alta(CLAVE, { ruc, plan: "PRO", maxDispositivos: 2, vence: new Date(Date.now() + 365 * 86_400_000) });
}, 60_000);

afterEach(() => cleanup());
afterAll(async () => {
  await env.cerrar();
});

describe("Licencia con el backend real", () => {
  it("el administrador entra a Ajustes, activa con la clave y pasa a abrir turno y vender", async () => {
    const usuario = montar();
    const login = await screen.findByRole("form", { name: "Ingreso" });
    await usuario.type(within(login).getByLabelText("Usuario"), "admin");
    await usuario.type(within(login).getByLabelText("Contraseña"), PASSWORD_ADMIN);
    await usuario.click(within(login).getByRole("button", { name: "Ingresar" }));

    // Sin licencia: no se queda atrapado en «Abrir turno»; ve el aviso y la pestaña de activación
    const aviso = await screen.findByRole("alert", { name: "Licencia" }, { timeout: 15_000 });
    expect(aviso).toHaveTextContent("No se puede vender");
    expect(screen.queryByRole("form", { name: "Apertura de turno" })).toBeNull();
    await usuario.click(within(aviso).getByRole("button", { name: "Abrir Ajustes › Licencia" }));
    const activar = await screen.findByRole("form", { name: "Activar licencia" });

    // Una clave inexistente la rechaza el servidor de licencias y se explica
    await usuario.type(within(activar).getByLabelText("Clave de activación"), "NADA-0000-0000-0000");
    await usuario.click(within(activar).getByRole("button", { name: "Activar" }));
    expect(await screen.findByText(/no existe/)).toBeInTheDocument();
    expect(await env.prisma.licencia.count()).toBe(0);

    await usuario.clear(within(activar).getByLabelText("Clave de activación"));
    await usuario.type(within(activar).getByLabelText("Clave de activación"), CLAVE.toLowerCase());
    await usuario.click(within(activar).getByRole("button", { name: "Activar" }));

    // Activada: el aviso desaparece y la aplicación pide abrir turno
    const turno = await screen.findByRole("form", { name: "Apertura de turno" }, { timeout: 15_000 });
    expect(screen.queryByRole("alert", { name: "Licencia" })).toBeNull();
    expect(await env.prisma.licencia.findFirstOrThrow()).toMatchObject({ clave: CLAVE });
    await usuario.click(within(turno).getByRole("button", { name: "Abrir turno" }));
    expect(await screen.findByRole("navigation", { name: "Menú principal" })).toBeInTheDocument();
  }, 90_000);

  it("la pestaña muestra el estado y los equipos desde el servidor de licencias real; validar ahora funciona y desactivar libera la plaza", async () => {
    const usuario = montar();
    const login = await screen.findByRole("form", { name: "Ingreso" });
    await usuario.type(within(login).getByLabelText("Usuario"), "admin");
    await usuario.type(within(login).getByLabelText("Contraseña"), PASSWORD_ADMIN);
    await usuario.click(within(login).getByRole("button", { name: "Ingresar" }));
    await usuario.click(await screen.findByRole("button", { name: "Ajustes" }, { timeout: 15_000 }));
    await usuario.click(await screen.findByRole("tab", { name: "Licencia" }));

    const estado = await screen.findByLabelText("Estado de la licencia");
    await waitFor(() => expect(estado).toHaveTextContent("Activa"));
    expect(estado).toHaveTextContent("ABCD-••••-••••-WXYZ");
    expect(estado).not.toHaveTextContent("1234-5678");
    const equipos = await screen.findByRole("list", { name: "Equipos" });
    expect(within(equipos).getByText(/CAJA-UI/)).toBeInTheDocument();
    expect(screen.getByText("1 de 2 plazas en uso")).toBeInTheDocument();

    await usuario.click(screen.getByRole("button", { name: "Validar ahora" }));
    expect(await screen.findByText("Licencia validada con el servidor")).toBeInTheDocument();

    await usuario.click(screen.getByLabelText("Entiendo que este equipo dejará de poder vender"));
    await usuario.click(screen.getByRole("button", { name: "Desactivar este equipo" }));
    expect(await screen.findByText(/la plaza está libre/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Estado de la licencia")).toHaveTextContent("Sin activar"));
    expect(servidor.licencias.get(CLAVE)?.dispositivos.size).toBe(0);
    expect(await env.prisma.licencia.count()).toBe(0);
  }, 90_000);
});

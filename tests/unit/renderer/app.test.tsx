// @vitest-environment jsdom
// ============================================================
// tests/unit/renderer/app.test.tsx — Flujo Ingreso → Turno → Venta, sesión vencida y sincronización multi-caja
// ============================================================
import { act, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useCarrito } from "../../../src/renderer/store/carrito.store";
import { useSesion } from "../../../src/renderer/store/sesion.store";
import { ApiSimulada, PUNTO, renderizarPos, servidorBasico, TURNO, USUARIO } from "../../helpers/renderer/entorno";

const sinTurno = { status: 409, cuerpo: { error: "TURNO_REQUERIDO", mensaje: "Debe abrir un turno de caja" } };

function servidor(): ApiSimulada {
  return servidorBasico(new ApiSimulada())
    .en("POST /api/auth/login", (p) => {
      const c = p.cuerpo as { username: string; password: string };
      return c.password === "bien" ? { cuerpo: { token: "tok-nuevo", usuario: USUARIO } } : { status: 401, cuerpo: { error: "CREDENCIALES_INVALIDAS", mensaje: "Usuario o contraseña incorrectos" } };
    })
    .en("GET /api/turnos/actual", sinTurno)
    .en("POST /api/turnos/abrir", { status: 201, cuerpo: TURNO })
    .en("POST /api/auth/logout", { status: 204 });
}

describe("Ingreso y apertura de turno", () => {
  it("credenciales incorrectas muestran el motivo y no entran; las correctas piden abrir turno y luego venden", async () => {
    const api = servidor();
    const { usuario } = renderizarPos({ api, conSesion: false });
    const form = await screen.findByRole("form", { name: "Ingreso" });
    expect(within(form).getByRole("button", { name: "Ingresar" })).toBeDisabled();

    await usuario.type(within(form).getByLabelText("Usuario"), "caja1");
    await usuario.type(within(form).getByLabelText("Contraseña"), "mal");
    await usuario.click(within(form).getByRole("button", { name: "Ingresar" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent("Usuario o contraseña incorrectos");
    expect(useSesion.getState().token).toBeNull();

    await usuario.clear(within(form).getByLabelText("Contraseña"));
    await usuario.type(within(form).getByLabelText("Contraseña"), "bien");
    await usuario.click(within(form).getByRole("button", { name: "Ingresar" }));

    const apertura = await screen.findByRole("form", { name: "Apertura de turno" });
    expect(api.llamadasA("POST /api/auth/login").at(-1)?.cuerpo).toEqual({ username: "caja1", password: "bien" });
    expect(within(apertura).getByLabelText("Punto de emisión")).toHaveValue(PUNTO.id);
    await usuario.clear(within(apertura).getByLabelText("Monto de apertura"));
    await usuario.type(within(apertura).getByLabelText("Monto de apertura"), "100");
    await usuario.click(within(apertura).getByRole("button", { name: "Abrir turno" }));

    expect(await screen.findByLabelText("Buscar producto")).toBeInTheDocument();
    expect(api.llamadasA("POST /api/turnos/abrir")[0]?.cuerpo).toEqual({ sucursalId: PUNTO.sucursal.id, montoApertura: 100 });
    expect(api.llamadasA("GET /api/productos")[0]?.cabeceras["authorization"]).toBe("Bearer tok-nuevo");
  });

  it("monto de apertura inválido o rechazo del servidor se informan en el formulario", async () => {
    const api = servidor().en("POST /api/turnos/abrir", { status: 409, cuerpo: { error: "ESTADO_INVALIDO", mensaje: "Ya tiene un turno abierto en esta sucursal" } });
    const { usuario } = renderizarPos({ api, sinTurno: true });
    const apertura = await screen.findByRole("form", { name: "Apertura de turno" });
    await usuario.clear(within(apertura).getByLabelText("Monto de apertura"));
    await usuario.type(within(apertura).getByLabelText("Monto de apertura"), "abc");
    await usuario.click(within(apertura).getByRole("button", { name: "Abrir turno" }));
    expect(await within(apertura).findByRole("alert")).toHaveTextContent("El monto de apertura no es válido");
    await usuario.clear(within(apertura).getByLabelText("Monto de apertura"));
    await usuario.type(within(apertura).getByLabelText("Monto de apertura"), "50");
    await usuario.click(within(apertura).getByRole("button", { name: "Abrir turno" }));
    expect(await within(apertura).findByRole("alert")).toHaveTextContent("Ya tiene un turno abierto");
  });

  it("si el cajero ya tenía un turno abierto lo retoma sin pedir nada", async () => {
    const api = servidor().en("GET /api/turnos/actual", { cuerpo: TURNO });
    renderizarPos({ api, sinTurno: true });
    expect(await screen.findByLabelText("Buscar producto")).toBeInTheDocument();
    expect(useSesion.getState()).toMatchObject({ turno: { id: TURNO.id }, puntoEmision: { id: PUNTO.id } });
    expect(api.llamadasA("POST /api/turnos/abrir")).toHaveLength(0);
  });
});

describe("Sesión", () => {
  it("«Salir» cierra la sesión en el servidor, vacía el carrito y vuelve al ingreso", async () => {
    const api = servidor();
    const { usuario } = renderizarPos({ api });
    await usuario.click(await screen.findByRole("button", { name: "Agregar Arroz 1kg" }));
    await usuario.click(screen.getByRole("button", { name: "Salir" }));
    expect(await screen.findByRole("form", { name: "Ingreso" })).toBeInTheDocument();
    expect(api.llamadasA("POST /api/auth/logout")).toHaveLength(1);
    expect(useCarrito.getState().lineas).toEqual([]);
    expect(useSesion.getState().token).toBeNull();
  });

  it("si el servidor responde 401 a mitad de la jornada (sesión vencida) vuelve al ingreso", async () => {
    const api = servidor().en("GET /api/sri/cola", { status: 401, cuerpo: { error: "NO_AUTENTICADO", mensaje: "Sesión requerida o expirada" } });
    const { noAutenticado } = renderizarPos({ api });
    expect(await screen.findByRole("form", { name: "Ingreso" })).toBeInTheDocument();
    expect(noAutenticado.veces).toBeGreaterThan(0);
  });
});

describe("Sincronización multi-caja", () => {
  const abrirSocket = async (r: ReturnType<typeof renderizarPos>) => {
    await waitFor(() => expect(r.sockets).toHaveLength(1));
    const socket = r.sockets[0];
    if (socket === undefined) throw new Error("sin socket");
    act(() => socket.abrir());
    return socket;
  };
  const evento = (extra: Record<string, unknown>) => ({ tipo: "evento", seq: 10, modulo: "ventas", accion: "POST", ruta: "/api/ventas", ids: {}, usuarioId: "u2", cajaId: "caja-otra", ts: "2026-11-24T10:00:00.000Z", ...extra });

  it("se conecta con el token y el nombre de la caja, y la barra muestra «Sincronizada»", async () => {
    const r = renderizarPos({ api: servidor() });
    const socket = await abrirSocket(r);
    expect(socket.url).toBe("ws://127.0.0.1:3001/api/sync?token=token-prueba&cajaId=caja-test");
    expect(await screen.findByTestId("estado-sync")).toHaveTextContent("Sincronizada");
  });

  it("lo que cambia otra caja refresca el catálogo y la cola del SRI; lo que cambia esta caja no se vuelve a pedir", async () => {
    const api = servidor();
    const r = renderizarPos({ api });
    const socket = await abrirSocket(r);
    await screen.findByRole("button", { name: "Agregar Arroz 1kg" });
    await waitFor(() => expect(api.llamadasA("GET /api/sri/cola").length).toBeGreaterThan(0));
    const productos = (): number => api.llamadasA("GET /api/productos").length;
    const cola = (): number => api.llamadasA("GET /api/sri/cola").length;
    const p0 = productos();
    const c0 = cola();

    act(() => socket.recibir(evento({ seq: 11, cajaId: "caja-test" })));
    await new Promise((x) => setTimeout(x, 60));
    expect(productos()).toBe(p0); // la originó esta misma caja

    act(() => socket.recibir(evento({ seq: 12 })));
    await waitFor(() => expect(productos()).toBeGreaterThan(p0));
    await waitFor(() => expect(cola()).toBeGreaterThan(c0));
  });

  it("un cambio de productos de otra caja actualiza lo que se ve (stock nuevo)", async () => {
    let stock = 50;
    const api = servidor();
    api.en("GET /api/productos", () => ({ cuerpo: { items: [{ ...(useCarrito.getState(), {}), id: "a0000000-0000-4000-8000-000000000002", codigo: "ARROZ", codigoBarras: null, nombre: "Arroz 1kg", tipo: "BIEN", precioVenta: 1.2, stockActual: stock, aplicaIva: false, codigoIvaSRI: "0", unidadMedida: { codigo: "UN", nombre: "Unidad", permiteDecimales: false }, tarifaImpuesto: null }], total: 1, page: 1, pageSize: 24 } }));
    const r = renderizarPos({ api });
    const socket = await abrirSocket(r);
    expect(await screen.findByText("50 UN")).toBeInTheDocument();
    stock = 47;
    act(() => socket.recibir(evento({ modulo: "inventario", ruta: "/api/inventario/ajustes" })));
    expect(await screen.findByText("47 UN")).toBeInTheDocument();
  });

  it("un módulo sin consultas asociadas (p. ej. mesas) no provoca recargas", async () => {
    const api = servidor();
    const r = renderizarPos({ api });
    const socket = await abrirSocket(r);
    await screen.findByRole("button", { name: "Agregar Arroz 1kg" });
    const antes = api.llamadas.length;
    act(() => socket.recibir(evento({ modulo: "mesas" })));
    await new Promise((x) => setTimeout(x, 60));
    expect(api.llamadas.length).toBe(antes);
  });

  it("«resync» recarga todo; con la sincronización apagada en el servidor la caja sigue sola; si se cae la red lo indica", async () => {
    const api = servidor();
    const r = renderizarPos({ api });
    const socket = await abrirSocket(r);
    await screen.findByRole("button", { name: "Agregar Arroz 1kg" });
    const antes = api.llamadasA("GET /api/productos").length;
    act(() => socket.recibir({ tipo: "resync", seq: 99 }));
    await waitFor(() => expect(api.llamadasA("GET /api/productos").length).toBeGreaterThan(antes));

    act(() => socket.cerrarDesdeServidor(1006)); // se cayó la red
    expect(await screen.findByTestId("estado-sync")).toHaveTextContent("Sin conexión LAN");

    r.unmount();
    const otra = renderizarPos({ api: servidor() });
    const s2 = await abrirSocket(otra);
    act(() => s2.cerrarDesdeServidor(4403));
    expect(await screen.findByTestId("estado-sync")).toHaveTextContent("Caja independiente");
  });

  it("al cerrar la sesión se corta la conexión", async () => {
    const r = renderizarPos({ api: servidor() });
    const socket = await abrirSocket(r);
    await r.usuario.click(await screen.findByRole("button", { name: "Salir" }));
    await waitFor(() => expect(socket.cerrado).toBe(true));
  });
});

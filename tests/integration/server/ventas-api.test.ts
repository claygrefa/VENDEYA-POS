// ============================================================
// tests/integration/server/ventas-api.test.ts — Endpoints /api/ventas (HTTP + RBAC)
// ============================================================
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Producto } from "@prisma/client";
import { abrirTurno, crearEntorno, crearProducto, type Entorno } from "../helpers/entorno.helper";

let env: Entorno;
let producto: Producto;
let tokenCajero: string;
let tokenSupervisor: string;
let tokenContador: string;

async function crearYLogin(rol: string, username: string): Promise<{ id: string; token: string }> {
  const u = await env.servicios.usuarios.crear({
    empresaId: env.seed.empresaId, rol, username, password: "Clave12345", nombre: username, apellido: "Test",
  });
  const r = await env.backend.server.inject({ method: "POST", url: "/api/auth/login", payload: { username, password: "Clave12345" } });
  return { id: u.id, token: (r.json() as { token: string }).token };
}

const api = (method: "GET" | "POST", url: string, token?: string, payload?: unknown) =>
  env.backend.server.inject({
    method,
    url,
    ...(token !== undefined ? { headers: { authorization: `Bearer ${token}` } } : {}),
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });

const cuerpoVenta = (cantidad = 2, monto = 25) => ({
  puntoEmisionId: env.seed.puntoEmisionId,
  lineas: [{ productoId: producto.id, cantidad, precioUnitario: 10 }],
  pagos: [{ formaPago: "EFECTIVO", monto }],
});

beforeAll(async () => {
  env = await crearEntorno();
  producto = await crearProducto(env, { codigo: "H1", precioVenta: 10, stock: 5, costo: 4 });
  const cajero = await crearYLogin("CAJERO", "cajero.api");
  await abrirTurno(env, cajero.id);
  tokenCajero = cajero.token;
  tokenSupervisor = (await crearYLogin("SUPERVISOR", "super.api")).token;
  tokenContador = (await crearYLogin("CONTADOR", "conta.api")).token;
}, 60_000);

afterAll(async () => {
  await env.cerrar();
});

describe("POST /api/ventas", () => {
  it("201: registra la venta con el cajero de la sesión", async () => {
    const r = await api("POST", "/api/ventas", tokenCajero, cuerpoVenta());
    expect(r.statusCode).toBe(201);
    const v = r.json() as { numero: string; total: number; cajeroId: string; pagos: Array<{ cambio: number }> };
    expect(v.total).toBe(23);
    expect(v.pagos[0]?.cambio).toBe(2);
    expect(v.numero).toMatch(/^001-001-\d{9}$/);
    const cajero = await env.prisma.usuario.findUniqueOrThrow({ where: { username: "cajero.api" } });
    expect(v.cajeroId).toBe(cajero.id);
  });

  it("401 sin sesión y 403 sin permiso ventas:crear", async () => {
    expect((await api("POST", "/api/ventas", undefined, cuerpoVenta())).statusCode).toBe(401);
    const r = await api("POST", "/api/ventas", tokenContador, cuerpoVenta());
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ error: "SIN_PERMISO" });
  });

  it("400: cuerpo inválido o pago insuficiente", async () => {
    expect((await api("POST", "/api/ventas", tokenCajero, { lineas: [], pagos: [] })).statusCode).toBe(400);
    const r = await api("POST", "/api/ventas", tokenCajero, cuerpoVenta(1, 5));
    expect(r.statusCode).toBe(400);
    expect(r.json()).toMatchObject({ error: "VALIDACION" });
  });

  it("409: stock insuficiente y sin turno abierto", async () => {
    const r = await api("POST", "/api/ventas", tokenCajero, cuerpoVenta(500, 99999));
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ error: "STOCK_INSUFICIENTE" });

    const sinTurno = await api("POST", "/api/ventas", tokenSupervisor, cuerpoVenta());
    expect(sinTurno.statusCode).toBe(409);
    expect(sinTurno.json()).toMatchObject({ error: "TURNO_REQUERIDO" });
  });
});

describe("GET /api/ventas/:id y POST /api/ventas/:id/anular", () => {
  it("GET devuelve la venta con líneas y pagos; 404 si no existe; el contador puede leer", async () => {
    const creada = (await api("POST", "/api/ventas", tokenCajero, cuerpoVenta(1, 12))).json() as { id: string };
    const r = await api("GET", `/api/ventas/${creada.id}`, tokenCajero);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ id: creada.id, lineas: [expect.any(Object)], pagos: [expect.any(Object)] });
    expect((await api("GET", "/api/ventas/no-existe", tokenCajero)).statusCode).toBe(404);
    expect((await api("GET", `/api/ventas/${creada.id}`, tokenContador)).statusCode).toBe(200);
  });

  it("el cajero NO puede anular (403); el supervisor sí (200) y se repone el stock", async () => {
    const stockAntes = (await env.prisma.producto.findUniqueOrThrow({ where: { id: producto.id } })).stockActual;
    const creada = (await api("POST", "/api/ventas", tokenCajero, cuerpoVenta(2, 25))).json() as { id: string };
    expect((await env.prisma.producto.findUniqueOrThrow({ where: { id: producto.id } })).stockActual).toBe(stockAntes - 2);

    const denegado = await api("POST", `/api/ventas/${creada.id}/anular`, tokenCajero, { motivo: "Error de cobro" });
    expect(denegado.statusCode).toBe(403);

    const ok = await api("POST", `/api/ventas/${creada.id}/anular`, tokenSupervisor, { motivo: "Error de cobro" });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ estado: "ANULADA", motivoAnulacion: "Error de cobro" });
    expect((await env.prisma.producto.findUniqueOrThrow({ where: { id: producto.id } })).stockActual).toBe(stockAntes);
  });

  it("anular: 409 si ya está anulada, 400 sin motivo, 404 si no existe", async () => {
    const creada = (await api("POST", "/api/ventas", tokenCajero, cuerpoVenta(1, 12))).json() as { id: string };
    expect((await api("POST", `/api/ventas/${creada.id}/anular`, tokenSupervisor, { motivo: "Primera vez" })).statusCode).toBe(200);
    const repetida = await api("POST", `/api/ventas/${creada.id}/anular`, tokenSupervisor, { motivo: "Segunda vez" });
    expect(repetida.statusCode).toBe(409);
    expect(repetida.json()).toMatchObject({ error: "ESTADO_INVALIDO" });
    expect((await api("POST", `/api/ventas/${creada.id}/anular`, tokenSupervisor, {})).statusCode).toBe(400);
    expect((await api("POST", "/api/ventas/no-existe/anular", tokenSupervisor, { motivo: "No existe" })).statusCode).toBe(404);
  });
});

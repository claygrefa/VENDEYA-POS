// ============================================================
// tests/integration/server/restaurante-api.test.ts
// Endpoints /api/mesas, /api/comandas y /api/cocina (HTTP + RBAC + códigos de estado)
// ============================================================
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Producto } from "@prisma/client";
import { abrirTurno, configurarGiro, crearEntorno, crearProducto, PASSWORD_ADMIN, type Entorno } from "../helpers/entorno.helper";

let env: Entorno;
let plato: Producto;
let bebida: Producto;
const tokens: Record<string, string> = {};

async function crearYLogin(rol: string, username: string): Promise<string> {
  const u = await env.servicios.usuarios.crear({
    empresaId: env.seed.empresaId, rol, username, password: "Clave12345", nombre: username, apellido: "Api",
  });
  const r = await env.backend.server.inject({ method: "POST", url: "/api/auth/login", payload: { username, password: "Clave12345" } });
  tokens[username] = (r.json() as { token: string }).token;
  return u.id;
}

type Metodo = "GET" | "POST" | "PATCH";
const api = (method: Metodo, url: string, quien?: string, payload?: unknown) =>
  env.backend.server.inject({
    method,
    url,
    ...(quien !== undefined ? { headers: { authorization: `Bearer ${tokens[quien]}` } } : {}),
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });

let n = 0;
async function mesaNueva(): Promise<string> {
  n += 1;
  const r = await api("POST", "/api/mesas", "admin", { sucursalId: env.seed.sucursalId, numero: n, nombre: `Mesa ${n}`, zona: "SALON" });
  expect(r.statusCode).toBe(201);
  return (r.json() as { id: string }).id;
}

async function cuentaConItems(items: Array<{ productoId: string; cantidad: number }>): Promise<{ id: string; mesaId: string; itemIds: string[] }> {
  const mesaId = await mesaNueva();
  const c = await api("POST", "/api/comandas", "mesero", { mesaId });
  expect(c.statusCode).toBe(201);
  const id = (c.json() as { id: string }).id;
  const r = await api("POST", `/api/comandas/${id}/items`, "mesero", { items });
  expect(r.statusCode).toBe(201);
  return { id, mesaId, itemIds: (r.json() as { items: Array<{ id: string }> }).items.map((i) => i.id) };
}

const cuerpoCobro = (extra: Record<string, unknown> = {}) => ({
  puntoEmisionId: env.seed.puntoEmisionId, pagos: [{ formaPago: "EFECTIVO", monto: 500 }], ...extra,
});

beforeAll(async () => {
  env = await crearEntorno();
  await configurarGiro(env, { moduloMesas: true, moduloComandasCocina: true });
  const login = await env.backend.server.inject({ method: "POST", url: "/api/auth/login", payload: { username: "admin", password: PASSWORD_ADMIN } });
  tokens["admin"] = (login.json() as { token: string }).token; // el administrador del seed
  await crearYLogin("MESERO", "mesero");
  await crearYLogin("COCINA", "cocina");
  await crearYLogin("SUPERVISOR", "super");
  await crearYLogin("CONTADOR", "conta");
  const cajeroId = await crearYLogin("CAJERO", "cajero");
  await abrirTurno(env, cajeroId);
  plato = await crearProducto(env, { codigo: "PLATO", precioVenta: 10, stock: 100, costo: 4, destino: "COCINA" });
  bebida = await crearProducto(env, { codigo: "BEBIDA", precioVenta: 2, stock: 100, costo: 0.5, destino: "BARRA" });
}, 60_000);

afterAll(async () => {
  await env.cerrar();
});

describe("Mesas", () => {
  it("el plano de mesas es configuración: solo admin crea y edita (mesero 403, sin sesión 401)", async () => {
    const cuerpo = { sucursalId: env.seed.sucursalId, numero: 500, nombre: "Mesa 500" };
    expect((await api("POST", "/api/mesas", undefined, cuerpo)).statusCode).toBe(401);
    expect((await api("POST", "/api/mesas", "mesero", cuerpo)).statusCode).toBe(403);
    expect((await api("POST", "/api/mesas", "super", cuerpo)).statusCode).toBe(403);
    const ok = await api("POST", "/api/mesas", "admin", cuerpo);
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ numero: 500, estado: "LIBRE", zona: "SALON", capacidad: 4 });

    const dup = await api("POST", "/api/mesas", "admin", cuerpo);
    expect(dup.statusCode).toBe(409);
    expect(dup.json()).toMatchObject({ error: "DUPLICADO" });
    expect((await api("POST", "/api/mesas", "admin", { sucursalId: "x", numero: -1 })).statusCode).toBe(400);

    const id = (ok.json() as { id: string }).id;
    expect((await api("PATCH", `/api/mesas/${id}`, "admin", { capacidad: 10 })).json()).toMatchObject({ capacidad: 10 });
    expect((await api("PATCH", `/api/mesas/${id}`, "mesero", { capacidad: 2 })).statusCode).toBe(403);
    expect((await api("PATCH", "/api/mesas/no-existe", "admin", { capacidad: 2 })).statusCode).toBe(404);
  });

  it("GET /mesas: mesero, cocina y cajero ven el plano; el contador no; filtro por zona", async () => {
    const id = await mesaNueva();
    for (const quien of ["mesero", "cocina", "cajero", "super"]) expect((await api("GET", "/api/mesas", quien)).statusCode).toBe(200);
    expect((await api("GET", "/api/mesas", "conta")).statusCode).toBe(403);
    const lista = (await api("GET", `/api/mesas?sucursalId=${env.seed.sucursalId}&zona=SALON`, "mesero")).json() as Array<{ id: string; estado: string }>;
    expect(lista.find((m) => m.id === id)).toMatchObject({ estado: "LIBRE", cuenta: null });
    expect((await api("GET", "/api/mesas?sucursalId=no-uuid", "mesero")).statusCode).toBe(400);
  });

  it("POST /mesas/:id/estado: reservar y liberar; con cuenta abierta 409", async () => {
    const id = await mesaNueva();
    expect((await api("POST", `/api/mesas/${id}/estado`, "mesero", { estado: "RESERVADA" })).json()).toMatchObject({ estado: "RESERVADA" });
    expect((await api("POST", `/api/mesas/${id}/estado`, "mesero", { estado: "OCUPADA" })).statusCode).toBe(400);
    await api("POST", "/api/comandas", "mesero", { mesaId: id });
    expect((await api("POST", `/api/mesas/${id}/estado`, "mesero", { estado: "LIBRE" })).statusCode).toBe(409);
  });
});

describe("Cuentas y pedidos", () => {
  it("abrir (201), segunda cuenta en la misma mesa 409, contador/sin sesión denegados", async () => {
    const mesaId = await mesaNueva();
    expect((await api("POST", "/api/comandas", undefined, { mesaId })).statusCode).toBe(401);
    expect((await api("POST", "/api/comandas", "conta", { mesaId })).statusCode).toBe(403);
    expect((await api("POST", "/api/comandas", "cocina", { mesaId })).statusCode).toBe(403); // cocina no abre cuentas

    const r = await api("POST", "/api/comandas", "mesero", { mesaId, comensales: 2 });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ estado: "ABIERTA", comensales: 2, resumen: { items: 0 } });
    const otra = await api("POST", "/api/comandas", "cajero", { mesaId });
    expect(otra.statusCode).toBe(409);
    expect(otra.json()).toMatchObject({ error: "ESTADO_INVALIDO" });
    expect((await api("POST", "/api/comandas", "mesero", { mesaId: "11111111-1111-4111-8111-111111111111" })).statusCode).toBe(404);
    expect((await api("POST", "/api/comandas", "mesero", {})).statusCode).toBe(400);
  });

  it("items: 201, validaciones 400/404, y consulta por id y listado", async () => {
    const { id } = await cuentaConItems([{ productoId: plato.id, cantidad: 2 }]);
    expect((await api("POST", `/api/comandas/${id}/items`, "mesero", { items: [] })).statusCode).toBe(400);
    expect((await api("POST", `/api/comandas/${id}/items`, "mesero", { items: [{ productoId: plato.id, cantidad: 1.5 }] })).statusCode).toBe(400);
    expect((await api("POST", `/api/comandas/${id}/items`, "mesero", { items: [{ productoId: "11111111-1111-4111-8111-111111111111", cantidad: 1 }] })).statusCode).toBe(404);
    expect((await api("POST", "/api/comandas/no-existe/items", "mesero", { items: [{ productoId: plato.id, cantidad: 1 }] })).statusCode).toBe(404);

    const detalle = await api("GET", `/api/comandas/${id}`, "cajero");
    expect(detalle.statusCode).toBe(200);
    expect(detalle.json()).toMatchObject({ id, resumen: { items: 1, consumo: 20, porCobrar: 20 } });
    const lista = (await api("GET", "/api/comandas?estado=ABIERTA", "mesero")).json() as Array<{ id: string }>;
    expect(lista.map((c) => c.id)).toContain(id);
    expect((await api("GET", "/api/comandas?estado=RARA", "mesero")).statusCode).toBe(400);
  });

  it("cancelar: el mesero quita pendientes pero no enviados (403); el supervisor sí, con motivo", async () => {
    const { id, itemIds } = await cuentaConItems([{ productoId: plato.id, cantidad: 1 }, { productoId: bebida.id, cantidad: 1 }]);
    const [pendiente, aEnviar] = itemIds as [string, string];
    expect((await api("POST", `/api/comandas/${id}/items/${pendiente}/cancelar`, "mesero", {})).statusCode).toBe(200);
    await api("POST", `/api/comandas/${id}/enviar`, "mesero");

    const denegado = await api("POST", `/api/comandas/${id}/items/${aEnviar}/cancelar`, "mesero", { motivo: "Se arrepintió" });
    expect(denegado.statusCode).toBe(403);
    expect(denegado.json()).toMatchObject({ error: "SIN_PERMISO" });
    expect((await api("POST", `/api/comandas/${id}/items/${aEnviar}/cancelar`, "super", {})).statusCode).toBe(400); // falta motivo
    expect((await api("POST", `/api/comandas/${id}/items/${aEnviar}/cancelar`, "super", { motivo: "Cliente se retiró" })).statusCode).toBe(200);
  });
});

describe("Cocina y barra", () => {
  it("enviar devuelve el ticket por destino; cocina ve sus pendientes y los marca LISTO; el mesero entrega", async () => {
    const { id, itemIds } = await cuentaConItems([{ productoId: plato.id, cantidad: 2 }, { productoId: bebida.id, cantidad: 1 }]);
    const envio = await api("POST", `/api/comandas/${id}/enviar`, "mesero");
    expect(envio.statusCode).toBe(201);
    const ticket = envio.json() as { envio: number; destinos: Array<{ destino: string; items: unknown[] }> };
    expect(ticket.envio).toBe(1);
    expect(ticket.destinos.map((d) => d.destino).sort()).toEqual(["BARRA", "COCINA"]);
    expect((await api("POST", `/api/comandas/${id}/enviar`, "mesero")).statusCode).toBe(400); // nada pendiente

    const cocinaVista = await api("GET", "/api/cocina/pendientes?destino=COCINA", "cocina");
    expect(cocinaVista.statusCode).toBe(200);
    const filas = cocinaVista.json() as Array<{ id: string; comandaId: string; cantidad: number; comanda: { numero: number; mesa: { nombre: string } } }>;
    const mio = filas.find((f) => f.comandaId === id);
    expect(mio).toMatchObject({ cantidad: 2 });
    expect(mio?.comanda.mesa.nombre).toBeTruthy();
    expect((await api("GET", "/api/cocina/pendientes?destino=BARRA", "cocina")).json()).toEqual(expect.any(Array));
    expect((await api("GET", "/api/cocina/pendientes", "conta")).statusCode).toBe(403);
    expect((await api("GET", "/api/cocina/pendientes?estado=XX", "cocina")).statusCode).toBe(400);

    const platoId = itemIds[0] as string;
    expect((await api("POST", `/api/comandas/${id}/items/${platoId}/estado`, "cocina", { estado: "LISTO" })).statusCode).toBe(200);
    expect((await api("POST", `/api/comandas/${id}/items/${platoId}/estado`, "cocina", { estado: "LISTO" })).statusCode).toBe(409);
    expect((await api("POST", `/api/comandas/${id}/items/${platoId}/estado`, "mesero", { estado: "ENTREGADO" })).statusCode).toBe(200);
    expect((await api("GET", "/api/cocina/pendientes?destino=COCINA", "cocina")).json()).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: platoId })]));
  });

  it("sin el módulo de cocina: enviar y la vista responden 403 MODULO_DESHABILITADO", async () => {
    const { id } = await cuentaConItems([{ productoId: bebida.id, cantidad: 1 }]);
    await configurarGiro(env, { moduloComandasCocina: false });
    try {
      const r = await api("POST", `/api/comandas/${id}/enviar`, "mesero");
      expect(r.statusCode).toBe(403);
      expect(r.json()).toMatchObject({ error: "MODULO_DESHABILITADO" });
      expect((await api("GET", "/api/cocina/pendientes", "cocina")).statusCode).toBe(403);
    } finally {
      await configurarGiro(env, { moduloComandasCocina: true });
    }
  });
});

describe("Mover, unir, pre-cuenta y cobro", () => {
  it("mover y unir por HTTP", async () => {
    const a = await cuentaConItems([{ productoId: plato.id, cantidad: 1 }]);
    const b = await cuentaConItems([{ productoId: bebida.id, cantidad: 1 }]);
    const libre = await mesaNueva();

    expect((await api("POST", `/api/comandas/${a.id}/mover`, "mesero", { mesaId: b.mesaId })).statusCode).toBe(409);
    expect((await api("POST", `/api/comandas/${a.id}/mover`, "mesero", { mesaId: libre })).json()).toMatchObject({ mesa: { id: libre } });
    const unida = await api("POST", `/api/comandas/${a.id}/unir`, "mesero", { comandaDestinoId: b.id });
    expect(unida.statusCode).toBe(200);
    expect(unida.json()).toMatchObject({ id: b.id, resumen: { items: 2, consumo: 12 } });
    expect((await api("POST", `/api/comandas/${a.id}/unir`, "mesero", { comandaDestinoId: b.id })).statusCode).toBe(409); // la origen ya está UNIDA
    expect((await api("POST", `/api/comandas/${b.id}/unir`, "mesero", { comandaDestinoId: b.id })).statusCode).toBe(400);
  });

  it("pre-cuenta con IVA y simulación de partes", async () => {
    const { id } = await cuentaConItems([{ productoId: plato.id, cantidad: 2 }, { productoId: bebida.id, cantidad: 3 }]);
    const r = await api("GET", `/api/comandas/${id}/pre-cuenta?partes=2`, "cajero");
    expect(r.statusCode).toBe(200);
    const pre = r.json() as { totales: { subtotal: number; iva: number; total: number }; partes: Array<{ parte: number }> };
    expect(pre.totales).toMatchObject({ subtotal: 26, iva: 3.9, total: 29.9 });
    expect(pre.partes.map((p) => p.parte)).toEqual([1, 2]);
    expect((await api("GET", `/api/comandas/${id}/pre-cuenta?partes=1`, "cajero")).statusCode).toBe(400);
  });

  it("cobrar: el cajero cobra (201); el mesero no (403, sin ventas:crear); el contador tampoco", async () => {
    const { id, itemIds } = await cuentaConItems([{ productoId: plato.id, cantidad: 1 }, { productoId: bebida.id, cantidad: 1 }]);
    expect((await api("POST", `/api/comandas/${id}/cobrar`, "mesero", cuerpoCobro())).statusCode).toBe(403);
    expect((await api("POST", `/api/comandas/${id}/cobrar`, "conta", cuerpoCobro())).statusCode).toBe(403);
    expect((await api("POST", `/api/comandas/${id}/cobrar`, "cajero", cuerpoCobro({ pagos: [] }))).statusCode).toBe(400);
    expect((await api("POST", `/api/comandas/${id}/cobrar`, "cajero", cuerpoCobro({ modo: "PARTE_IGUAL" }))).statusCode).toBe(400);

    const parcial = await api("POST", `/api/comandas/${id}/cobrar`, "cajero", cuerpoCobro({ itemIds: [itemIds[0]], propina: 1 }));
    expect(parcial.statusCode).toBe(201);
    expect(parcial.json()).toMatchObject({ cerrada: false, venta: { total: 11.5, propina: 1 }, comanda: { estado: "ABIERTA" } });

    const resto = await api("POST", `/api/comandas/${id}/cobrar`, "cajero", cuerpoCobro());
    expect(resto.statusCode).toBe(201);
    expect(resto.json()).toMatchObject({ cerrada: true, comanda: { estado: "CERRADA" } });
    expect((await api("POST", `/api/comandas/${id}/cobrar`, "cajero", cuerpoCobro())).statusCode).toBe(409);
  });

  it("cobrar en partes iguales por HTTP", async () => {
    const { id, mesaId } = await cuentaConItems([{ productoId: plato.id, cantidad: 2 }]);
    for (const parte of [1, 2]) {
      const r = await api("POST", `/api/comandas/${id}/cobrar`, "cajero", cuerpoCobro({ modo: "PARTE_IGUAL", partes: 2, parte }));
      expect(r.statusCode).toBe(201);
      expect((r.json() as { cerrada: boolean }).cerrada).toBe(parte === 2);
    }
    const mesas = (await api("GET", "/api/mesas", "mesero")).json() as Array<{ id: string; estado: string }>;
    expect(mesas.find((m) => m.id === mesaId)?.estado).toBe("LIBRE");
  });

  it("stock insuficiente al cobrar → 409 y la cuenta sigue abierta", async () => {
    const escaso = await crearProducto(env, { codigo: "ESCASO-API", precioVenta: 5, stock: 1 });
    const { id } = await cuentaConItems([{ productoId: escaso.id, cantidad: 3 }]);
    const r = await api("POST", `/api/comandas/${id}/cobrar`, "cajero", cuerpoCobro());
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ error: "STOCK_INSUFICIENTE" });
    expect(((await api("GET", `/api/comandas/${id}`, "mesero")).json() as { estado: string }).estado).toBe("ABIERTA");
  });

  it("anular cuenta: solo supervisor (restaurante:anular); mesero y cajero 403", async () => {
    const { id } = await cuentaConItems([{ productoId: plato.id, cantidad: 1 }]);
    expect((await api("POST", `/api/comandas/${id}/anular`, "mesero", { motivo: "No consumieron" })).statusCode).toBe(403);
    expect((await api("POST", `/api/comandas/${id}/anular`, "cajero", { motivo: "No consumieron" })).statusCode).toBe(403);
    expect((await api("POST", `/api/comandas/${id}/anular`, "super", { motivo: "no" })).statusCode).toBe(400);
    const ok = await api("POST", `/api/comandas/${id}/anular`, "super", { motivo: "No consumieron nada" });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ estado: "ANULADA", motivoAnulacion: "No consumieron nada" });
    expect((await api("POST", `/api/comandas/${id}/anular`, "super", { motivo: "No consumieron nada" })).statusCode).toBe(409);
  });
});

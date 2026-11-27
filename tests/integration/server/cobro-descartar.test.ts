// ============================================================
// tests/integration/server/cobro-descartar.test.ts — Salida de un cobro que la caja no logra confirmar, y purga de intentos antiguos
//   · descartar no crea ni duplica ventas y deja una lápida con el mismo UUID · un cobro ya registrado no se puede descartar
//   · un cajero no toca los intentos de otro · los intentos resueltos y antiguos se purgan, los recientes y los pendientes no
// ============================================================
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Producto } from "@prisma/client";
import { DIAS_RETENCION_INTENTOS, purgarIntentosCobro } from "../../../src/server/services/intentoCobro.service";
import { abrirTurno, crearEntorno, crearProducto, type Entorno } from "../helpers/entorno.helper";

let env: Entorno;
let producto: Producto;
let tokenA = "";
let tokenB = "";

async function crearYLogin(username: string): Promise<{ id: string; token: string }> {
  const u = await env.servicios.usuarios.crear({ empresaId: env.seed.empresaId, rol: "CAJERO", username, password: "Clave12345", nombre: username, apellido: "Test" });
  const r = await env.backend.server.inject({ method: "POST", url: "/api/auth/login", payload: { username, password: "Clave12345" } });
  return { id: u.id, token: (r.json() as { token: string }).token };
}

const api = (url: string, token: string | null, payload: unknown = {}) =>
  env.backend.server.inject({ method: "POST", url, ...(token !== null ? { headers: { authorization: `Bearer ${token}` } } : {}), payload: payload as object });

const venta = (intentoId?: string) => ({
  puntoEmisionId: env.seed.puntoEmisionId,
  lineas: [{ productoId: producto.id, cantidad: 1, precioUnitario: 10 }],
  pagos: [{ formaPago: "EFECTIVO", monto: 12 }],
  ...(intentoId !== undefined ? { intentoId } : {}),
});
const ventasDelProducto = (): Promise<number> => env.prisma.venta.count({ where: { lineas: { some: { productoId: producto.id } } } });

beforeAll(async () => {
  env = await crearEntorno();
  producto = await crearProducto(env, { codigo: "DESC1", precioVenta: 10, stock: 50, costo: 4 });
  const a = await crearYLogin("cajero.a");
  const b = await crearYLogin("cajero.b");
  await abrirTurno(env, a.id);
  await abrirTurno(env, b.id);
  tokenA = a.token;
  tokenB = b.token;
}, 60_000);

afterAll(async () => {
  await env.cerrar();
});

describe("POST /api/cobros/:intentoId/descartar", () => {
  it("un cobro que nunca llegó al servidor se descarta: no hay venta y un reintento rezagado ya no puede registrarla", async () => {
    const intentoId = randomUUID();
    const antes = await ventasDelProducto();
    const r = await api(`/api/cobros/${intentoId}/descartar`, tokenA);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ estado: "DESCARTADO" });
    expect(await env.prisma.intentoCobro.findUniqueOrThrow({ where: { id: intentoId } })).toMatchObject({ estado: "FAILED", errorCodigo: "COBRO_DESCARTADO", respuesta: null });

    // el reintento rezagado (la petición original que aún viajaba) no puede crear la venta con ese UUID
    const tarde = await api("/api/ventas", tokenA, venta(intentoId));
    expect(tarde.statusCode).toBe(409);
    expect(tarde.json()).toMatchObject({ error: "DUPLICADO" });
    expect(await ventasDelProducto()).toBe(antes);

    // descartar dos veces es inocuo
    expect((await api(`/api/cobros/${intentoId}/descartar`, tokenA)).statusCode).toBe(200);
  });

  it("un cobro que el servidor SÍ registró no se puede descartar: la venta sigue y se recupera con el mismo UUID", async () => {
    const intentoId = randomUUID();
    const creada = await api("/api/ventas", tokenA, venta(intentoId));
    expect(creada.statusCode).toBe(201);
    const antes = await ventasDelProducto();

    const r = await api(`/api/cobros/${intentoId}/descartar`, tokenA);
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ error: "ESTADO_INVALIDO", mensaje: expect.stringMatching(/ya se registró/) });
    expect(await ventasDelProducto()).toBe(antes);
    expect((await env.prisma.intentoCobro.findUniqueOrThrow({ where: { id: intentoId } })).estado).toBe("CONFIRMED");

    const recuperada = await api("/api/ventas", tokenA, venta(intentoId));
    expect(recuperada.statusCode).toBe(201);
    expect((recuperada.json() as { id: string }).id).toBe((creada.json() as { id: string }).id);
  });

  it("un rechazo de negocio ya guardado (FAILED) también se puede descartar y conserva su motivo", async () => {
    const intentoId = randomUUID();
    const rechazada = await api("/api/ventas", tokenA, { ...venta(intentoId), lineas: [{ productoId: producto.id, cantidad: 5000, precioUnitario: 10 }], pagos: [{ formaPago: "EFECTIVO", monto: 99999 }] });
    expect(rechazada.json()).toMatchObject({ error: "STOCK_INSUFICIENTE" });
    expect((await api(`/api/cobros/${intentoId}/descartar`, tokenA)).statusCode).toBe(200);
    expect(await env.prisma.intentoCobro.findUniqueOrThrow({ where: { id: intentoId } })).toMatchObject({ estado: "FAILED", errorCodigo: "STOCK_INSUFICIENTE" });
  });

  it("un cajero no puede descartar (ni ocupar) el intento de otro", async () => {
    const intentoId = randomUUID();
    expect((await api("/api/ventas", tokenA, venta(intentoId))).statusCode).toBe(201);
    const ajeno = await api(`/api/cobros/${intentoId}/descartar`, tokenB);
    expect(ajeno.statusCode).toBe(404);
    expect((await env.prisma.intentoCobro.findUniqueOrThrow({ where: { id: intentoId } })).estado).toBe("CONFIRMED");

    // tampoco puede reservar el UUID de otro cajero antes de que este lo use
    const reservado = randomUUID();
    expect((await api(`/api/cobros/${reservado}/descartar`, tokenB)).statusCode).toBe(200);
    expect((await api("/api/ventas", tokenA, venta(reservado))).statusCode).toBe(409);
  });

  it("valida el UUID y exige sesión", async () => {
    expect((await api("/api/cobros/no-es-un-uuid/descartar", tokenA)).statusCode).toBe(400);
    expect((await api(`/api/cobros/${randomUUID()}/descartar`, null)).statusCode).toBe(401);
  });
});

describe("purga de intentos de cobro", () => {
  const fila = (id: string, estado: string, diasAtras: number) =>
    env.prisma.$executeRaw`INSERT INTO "IntentoCobro" ("id","empresaId","cajeroId","huella","estado","creadoEn")
      VALUES (${id}, ${env.seed.empresaId}, ${env.seed.adminId}, 'h', ${estado}, ${new Date(Date.now() - diasAtras * 86_400_000).toISOString()})`;

  it("borra los resueltos de más de 30 días y conserva los recientes y los que aún no se resolvieron", async () => {
    const viejoConfirmado = randomUUID();
    const viejoFallido = randomUUID();
    const recienteConfirmado = randomUUID();
    const viejoPendiente = randomUUID();
    await fila(viejoConfirmado, "CONFIRMED", DIAS_RETENCION_INTENTOS + 1);
    await fila(viejoFallido, "FAILED", DIAS_RETENCION_INTENTOS + 5);
    await fila(recienteConfirmado, "CONFIRMED", DIAS_RETENCION_INTENTOS - 1);
    await fila(viejoPendiente, "PENDING", DIAS_RETENCION_INTENTOS + 10);

    expect(await purgarIntentosCobro(env.prisma)).toBe(2);
    const quedan = (await env.prisma.intentoCobro.findMany({ where: { id: { in: [viejoConfirmado, viejoFallido, recienteConfirmado, viejoPendiente] } } })).map((i) => i.id).sort();
    expect(quedan).toEqual([recienteConfirmado, viejoPendiente].sort());
    expect(await purgarIntentosCobro(env.prisma)).toBe(0); // idempotente
  });

  it("purga la fila de un cobro REAL (fecha en el formato por defecto de SQLite) cuando envejece", async () => {
    const intentoId = randomUUID();
    expect((await api("/api/ventas", tokenA, venta(intentoId))).statusCode).toBe(201);
    expect(await purgarIntentosCobro(env.prisma)).toBe(0); // recién creado: se conserva
    await env.prisma.$executeRaw`UPDATE "IntentoCobro" SET "creadoEn" = datetime('now', '-40 days') WHERE "id" = ${intentoId}`;
    expect(await purgarIntentosCobro(env.prisma)).toBe(1);
    expect(await env.prisma.intentoCobro.findUnique({ where: { id: intentoId } })).toBeNull();
  });

  it("la purga acepta otro plazo y no toca los intentos de las pruebas anteriores recién creados", async () => {
    const antes = await env.prisma.intentoCobro.count();
    expect(await purgarIntentosCobro(env.prisma, new Date(), 365)).toBe(0);
    expect(await env.prisma.intentoCobro.count()).toBe(antes);
  });
});

// ============================================================
// tests/integration/server/caja-cartera-api.test.ts
// Endpoints /api/turnos, /api/compras, /api/cuentas-por-cobrar y /api/cuentas-por-pagar (HTTP + RBAC)
// ============================================================
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Producto } from "@prisma/client";
import { crearClienteConCredito, crearEntorno, crearProducto, crearProveedor, type Entorno } from "../helpers/entorno.helper";

let env: Entorno;
let producto: Producto;
const tokens: Record<string, string> = {};

async function crearYLogin(rol: string, username: string): Promise<void> {
  await env.servicios.usuarios.crear({
    empresaId: env.seed.empresaId, rol, username, password: "Clave12345", nombre: username, apellido: "Api",
  });
  const r = await env.backend.server.inject({ method: "POST", url: "/api/auth/login", payload: { username, password: "Clave12345" } });
  tokens[username] = (r.json() as { token: string }).token;
}

const api = (method: "GET" | "POST", url: string, quien?: string, payload?: unknown) =>
  env.backend.server.inject({
    method,
    url,
    ...(quien !== undefined ? { headers: { authorization: `Bearer ${tokens[quien]}` } } : {}),
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });

beforeAll(async () => {
  env = await crearEntorno();
  producto = await crearProducto(env, { codigo: "AP1", precioVenta: 10, stock: 100, costo: 4 });
  await crearYLogin("CAJERO", "cajero1");
  await crearYLogin("CAJERO", "cajero2");
  await crearYLogin("SUPERVISOR", "super");
  await crearYLogin("BODEGUERO", "bodega");
  await crearYLogin("CONTADOR", "conta");
}, 60_000);

afterAll(async () => {
  await env.cerrar();
});

describe("API de turnos", () => {
  let turnoId: string;

  it("POST /turnos/abrir → 201; sin sesión 401; contador sin permiso 403; segundo turno 409", async () => {
    const body = { sucursalId: env.seed.sucursalId, montoApertura: 100 };
    expect((await api("POST", "/api/turnos/abrir", undefined, body)).statusCode).toBe(401);
    expect((await api("POST", "/api/turnos/abrir", "conta", body)).statusCode).toBe(403);

    const r = await api("POST", "/api/turnos/abrir", "cajero1", body);
    expect(r.statusCode).toBe(201);
    turnoId = (r.json() as { id: string }).id;
    expect(r.json()).toMatchObject({ estado: "ABIERTO", montoApertura: 100 });

    const dup = await api("POST", "/api/turnos/abrir", "cajero1", body);
    expect(dup.statusCode).toBe(409);
    expect(dup.json()).toMatchObject({ error: "ESTADO_INVALIDO" });
    expect((await api("POST", "/api/turnos/abrir", "cajero2", { sucursalId: "no-uuid" })).statusCode).toBe(400);
  });

  it("GET /turnos/actual → turno del usuario; 404 si no tiene", async () => {
    const r = await api("GET", "/api/turnos/actual", "cajero1");
    expect(r.statusCode).toBe(200);
    expect((r.json() as { id: string }).id).toBe(turnoId);
    expect((await api("GET", "/api/turnos/actual", "cajero2")).statusCode).toBe(404);
    expect((await api("GET", "/api/turnos/actual?sucursalId=xx", "cajero1")).statusCode).toBe(400);
  });

  it("movimientos: 201 válido, 400 sin concepto; otro cajero 403", async () => {
    const ok = await api("POST", `/api/turnos/${turnoId}/movimientos`, "cajero1", { tipo: "INGRESO", concepto: "Fondo extra", monto: 20 });
    expect(ok.statusCode).toBe(201);
    expect((await api("POST", `/api/turnos/${turnoId}/movimientos`, "cajero1", { tipo: "INGRESO", concepto: "", monto: 20 })).statusCode).toBe(400);
    const ajeno = await api("POST", `/api/turnos/${turnoId}/movimientos`, "cajero2", { tipo: "INGRESO", concepto: "Intruso", monto: 1 });
    expect(ajeno.statusCode).toBe(403);
    expect(ajeno.json()).toMatchObject({ error: "SIN_PERMISO" });
  });

  it("cierre ciego por HTTP: el reporte abierto oculta el esperado; al cerrar lo revela", async () => {
    await env.servicios.ventas.crear(
      {
        puntoEmisionId: env.seed.puntoEmisionId,
        lineas: [{ productoId: producto.id, cantidad: 2, precioUnitario: 10 }],
        pagos: [{ formaPago: "EFECTIVO", monto: 25 }],
      },
      { id: (await env.prisma.usuario.findUniqueOrThrow({ where: { username: "cajero1" } })).id, empresaId: env.seed.empresaId }
    );

    const abierto = (await api("GET", `/api/turnos/${turnoId}/reporte`, "cajero1")).json() as { efectivo: unknown };
    expect(abierto.efectivo).toBeNull();
    const sup = (await api("GET", `/api/turnos/${turnoId}/reporte`, "super")).json() as { efectivo: { esperado: number } };
    expect(sup.efectivo.esperado).toBe(143); // 100 + 20 + (25 − 2)
    expect((await api("GET", `/api/turnos/${turnoId}/reporte`, "cajero2")).statusCode).toBe(403);

    const cierre = await api("POST", `/api/turnos/${turnoId}/cerrar`, "cajero1", { efectivoContado: 140 });
    expect(cierre.statusCode).toBe(200);
    expect(cierre.json()).toMatchObject({ turno: { estado: "CERRADO" }, efectivo: { esperado: 143, contado: 140, diferencia: -3 } });

    expect((await api("POST", `/api/turnos/${turnoId}/cerrar`, "cajero1", { efectivoContado: 140 })).statusCode).toBe(409);
    expect((await api("GET", "/api/turnos/no-existe/reporte", "cajero1")).statusCode).toBe(404);
  });
});

describe("API de compras y cuentas por pagar", () => {
  let cuentaId: string;

  it("POST /compras (bodeguero) → 201 con CxP; cajero 403", async () => {
    const prov = await crearProveedor(env, { razonSocial: "Proveedor API" });
    const body = {
      proveedorId: prov.id, sucursalId: env.seed.sucursalId, numeroFactura: "001-001-000000321", formaPago: "CREDITO",
      lineas: [{ productoId: producto.id, cantidad: 10, costoUnitario: 4 }],
    };
    expect((await api("POST", "/api/compras", "cajero1", body)).statusCode).toBe(403);
    const r = await api("POST", "/api/compras", "bodega", body);
    expect(r.statusCode).toBe(201);
    const c = r.json() as { id: string; total: number; cuentaPorPagar: { id: string } };
    expect(c.total).toBe(46);
    cuentaId = c.cuentaPorPagar.id;

    expect((await api("GET", `/api/compras/${c.id}`, "bodega")).statusCode).toBe(200);
    const dup = await api("POST", "/api/compras", "bodega", body);
    expect(dup.statusCode).toBe(409);
    expect(dup.json()).toMatchObject({ error: "DUPLICADO" });
    expect((await api("POST", "/api/compras", "bodega", { ...body, lineas: [] })).statusCode).toBe(400);
  });

  it("GET /cuentas-por-pagar lista y filtra; el cajero no tiene proveedores:leer", async () => {
    const r = await api("GET", "/api/cuentas-por-pagar?estado=PENDIENTE", "bodega");
    expect(r.statusCode).toBe(200);
    expect((r.json() as { total: number }).total).toBeGreaterThanOrEqual(1);
    expect((await api("GET", "/api/cuentas-por-pagar", "cajero1")).statusCode).toBe(403);
    expect((await api("GET", "/api/cuentas-por-pagar?estado=XX", "bodega")).statusCode).toBe(400);
    expect((await api("GET", "/api/cuentas-por-pagar?vencidas=quizas", "bodega")).statusCode).toBe(400);
    expect((await api("GET", `/api/cuentas-por-pagar/${cuentaId}`, "bodega")).statusCode).toBe(200);
  });

  it("POST /cuentas-por-pagar/:id/pagos → 201; sobrepago 400; sin permiso 403", async () => {
    const pago = await api("POST", `/api/cuentas-por-pagar/${cuentaId}/pagos`, "bodega", { monto: 16, formaPago: "TRANSFERENCIA", referencia: "T-1" });
    expect(pago.statusCode).toBe(201);
    expect(pago.json()).toMatchObject({ saldo: 30, estado: "PARCIAL" });
    expect((await api("POST", `/api/cuentas-por-pagar/${cuentaId}/pagos`, "bodega", { monto: 999, formaPago: "TRANSFERENCIA" })).statusCode).toBe(400);
    expect((await api("POST", `/api/cuentas-por-pagar/${cuentaId}/pagos`, "cajero1", { monto: 1, formaPago: "TRANSFERENCIA" })).statusCode).toBe(403);
  });
});

describe("API de cuentas por cobrar", () => {
  let cuentaId: string;

  it("venta a crédito → cuenta visible por GET y filtrable por cliente/vencidas", async () => {
    const turno = await api("POST", "/api/turnos/abrir", "cajero2", { sucursalId: env.seed.sucursalId, montoApertura: 0 });
    expect(turno.statusCode).toBe(201);
    const cliente = await crearClienteConCredito(env, "0926687856001", 200, 30);
    const venta = await api("POST", "/api/ventas", "cajero2", {
      puntoEmisionId: env.seed.puntoEmisionId, clienteId: cliente.id,
      lineas: [{ productoId: producto.id, cantidad: 2, precioUnitario: 10 }],
      pagos: [{ formaPago: "CREDITO", monto: 23 }],
    });
    expect(venta.statusCode).toBe(201);

    const lista = await api("GET", `/api/cuentas-por-cobrar?clienteId=${cliente.id}&vencidas=false`, "cajero2");
    expect(lista.statusCode).toBe(200);
    const cuentas = lista.json() as { total: number; items: Array<{ id: string; saldo: number; cliente: { razonSocial: string } }> };
    expect(cuentas.total).toBe(1);
    expect(cuentas.items[0]).toMatchObject({ saldo: 23 });
    cuentaId = cuentas.items[0]?.id as string;

    expect((await api("GET", `/api/cuentas-por-cobrar/${cuentaId}`, "conta")).statusCode).toBe(403); // el contador no tiene clientes:leer
    expect((await api("GET", `/api/cuentas-por-cobrar?clienteId=${cliente.id}&vencidas=true`, "cajero2")).json()).toMatchObject({ total: 0 });
  });

  it("POST /abonos: efectivo ingresa a caja (201), sobrepago 400, límite excedido en venta 409", async () => {
    const abono = await api("POST", `/api/cuentas-por-cobrar/${cuentaId}/abonos`, "cajero2", { monto: 10, formaPago: "EFECTIVO" });
    expect(abono.statusCode).toBe(201);
    expect(abono.json()).toMatchObject({ saldo: 13, estado: "PARCIAL" });
    expect((await api("POST", `/api/cuentas-por-cobrar/${cuentaId}/abonos`, "cajero2", { monto: 500, formaPago: "EFECTIVO" })).statusCode).toBe(400);
    expect((await api("POST", `/api/cuentas-por-cobrar/${cuentaId}/abonos`, "conta", { monto: 1, formaPago: "EFECTIVO" })).statusCode).toBe(403);

    const cuenta = (await api("GET", `/api/cuentas-por-cobrar/${cuentaId}`, "cajero2")).json() as { cliente: { id: string } };
    const excede = await api("POST", "/api/ventas", "cajero2", {
      puntoEmisionId: env.seed.puntoEmisionId, clienteId: cuenta.cliente.id,
      lineas: [{ productoId: producto.id, cantidad: 20, precioUnitario: 10 }],
      pagos: [{ formaPago: "CREDITO", monto: 230 }],
    });
    expect(excede.statusCode).toBe(409);
    expect(excede.json()).toMatchObject({ error: "LIMITE_CREDITO_EXCEDIDO" });

    // el abono en efectivo quedó en el turno de cajero2
    const rep = (await api("GET", "/api/turnos/actual", "cajero2")).json() as { id: string };
    const sup = (await api("GET", `/api/turnos/${rep.id}/reporte`, "super")).json() as { efectivo: { esperado: number } };
    expect(sup.efectivo.esperado).toBe(10);
  });
});

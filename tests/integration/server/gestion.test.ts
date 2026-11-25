// ============================================================
// tests/integration/server/gestion.test.ts
// Endpoints de las vistas de gestión: clientes y proveedores (alta/edición), listados de ventas y compras, catálogos y
// reportes (JSON y CSV), con ventas, compras y cartera reales del entorno de pruebas.
// ============================================================
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Cliente, Producto, Proveedor } from "@prisma/client";
import { reporteACsv, type Reporte } from "../../../src/server/services/reporte.service";
import type { ActorCaja } from "../../../src/server/services/turno.service";
import { abrirTurno, crearActor, crearClienteConCredito, crearEntorno, crearProducto, crearProveedor, PASSWORD_ADMIN, type Entorno } from "../helpers/entorno.helper";

let env: Entorno;
let cajeroA: ActorCaja;
let cajeroB: ActorCaja;
let supervisor: ActorCaja;
let bodeguero: ActorCaja;
let p15: Producto;
let p0: Producto;
let cliente: Cliente;
let proveedor: Proveedor;
let turnoA = "";
let ventaAnulada = "";
const tokens: Record<string, string> = {};
const DIA = 86_400_000;

const vender = (actor: ActorCaja, lineas: unknown[], pagos: unknown[], extra: Record<string, unknown> = {}) =>
  env.servicios.ventas.crear({ puntoEmisionId: env.seed.puntoEmisionId, lineas, pagos, ...extra }, actor);

const api = (method: "GET" | "POST" | "PATCH", url: string, quien: string, payload?: unknown) =>
  env.backend.server.inject({ method, url, headers: { authorization: `Bearer ${tokens[quien]}` }, ...(payload !== undefined ? { payload: payload as object } : {}) });

beforeAll(async () => {
  env = await crearEntorno();
  cajeroA = await crearActor(env, "CAJERO", "ges.cajeroa");
  cajeroB = await crearActor(env, "CAJERO", "ges.cajerob");
  supervisor = await crearActor(env, "SUPERVISOR", "ges.super");
  bodeguero = await crearActor(env, "BODEGUERO", "ges.bodega");
  turnoA = (await abrirTurno(env, cajeroA.id)).id;
  await abrirTurno(env, cajeroB.id);
  p15 = await crearProducto(env, { codigo: "G15", precioVenta: 10, stock: 200, costo: 4 });
  p0 = await crearProducto(env, { codigo: "G0", precioVenta: 5, stock: 200, costo: 2, aplicaIva: false });
  cliente = await crearClienteConCredito(env, "0926687856001", 500, 30);
  proveedor = await crearProveedor(env, { razonSocial: "Distribuidora Andina" });

  // Cajero A: 2 × G15 (20 + 3) en efectivo con cambio; 1 × G0 con tarjeta; y una venta a crédito. Cajero B: 3 × G0 en efectivo.
  await vender(cajeroA, [{ productoId: p15.id, cantidad: 2 }], [{ formaPago: "EFECTIVO", monto: 30 }]); // total 23, cambio 7
  const v2 = await vender(cajeroA, [{ productoId: p0.id, cantidad: 1 }], [{ formaPago: "TARJETA_CREDITO", monto: 5 }]);
  await vender(cajeroA, [{ productoId: p15.id, cantidad: 1 }], [{ formaPago: "CREDITO", monto: 11.5 }], { clienteId: cliente.id });
  await vender(cajeroB, [{ productoId: p0.id, cantidad: 3 }], [{ formaPago: "EFECTIVO", monto: 15 }]);
  // una venta que luego se anula (no debe sumar) y una de hace 3 días
  const anulada = await vender(cajeroB, [{ productoId: p15.id, cantidad: 5 }], [{ formaPago: "EFECTIVO", monto: 60 }]);
  ventaAnulada = anulada.id;
  await env.servicios.ventas.anular(anulada.id, { motivo: "Error de digitación" }, supervisor);
  await env.prisma.venta.update({ where: { id: v2.id }, data: { createdAt: new Date(Date.now() - 3 * DIA) } });

  // compra a crédito del proveedor
  await env.servicios.compras.crear({ proveedorId: proveedor.id, sucursalId: env.seed.sucursalId, numeroFactura: "001-001-000000777", formaPago: "CREDITO", lineas: [{ productoId: p15.id, cantidad: 10, costoUnitario: 4 }] }, bodeguero);

  const login = async (username: string, password: string): Promise<void> => {
    const r = await env.backend.server.inject({ method: "POST", url: "/api/auth/login", payload: { username, password } });
    tokens[username] = (r.json() as { token: string }).token;
  };
  await login("admin", PASSWORD_ADMIN);
  for (const [rol, username] of [["CAJERO", "ges.api.caja"], ["SUPERVISOR", "ges.api.super"], ["CONTADOR", "ges.api.conta"], ["BODEGUERO", "ges.api.bodega"]] as const) {
    await env.servicios.usuarios.crear({ empresaId: env.seed.empresaId, rol, username, password: "Clave12345", nombre: username, apellido: "Api" });
    await login(username, "Clave12345");
  }
}, 90_000);

afterAll(async () => {
  await env.cerrar();
});

describe("Clientes: alta y edición", () => {
  it("el cajero da de alta (clientes:crear) pero no edita; el supervisor edita; los datos se validan", async () => {
    const nuevo = { tipoIdentificacion: "05", identificacion: "0926687856", razonSocial: "María Zambrano", email: "maria@correo.ec", telefono: "0999999999", direccion: "Calle 1", limiteCredito: 100, diasCredito: 15 };
    const r = await api("POST", "/api/clientes", "ges.api.caja", nuevo);
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ razonSocial: "María Zambrano", limiteCredito: 100 });
    const id = r.json<{ id: string }>().id;
    expect((await api("POST", "/api/clientes", "ges.api.caja", nuevo)).statusCode).toBe(409);
    expect((await api("POST", "/api/clientes", "ges.api.caja", { ...nuevo, identificacion: "1234567890" })).statusCode).toBe(400);
    expect((await api("PATCH", `/api/clientes/${id}`, "ges.api.caja", { telefono: "022222222" })).statusCode).toBe(403);
    const ok = await api("PATCH", `/api/clientes/${id}`, "ges.api.super", { telefono: "022222222", limiteCredito: 250 });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ telefono: "022222222", limiteCredito: 250, razonSocial: "María Zambrano" });
    expect((await api("PATCH", "/api/clientes/no-existe", "ges.api.super", { telefono: "022222222" })).statusCode).toBe(404);
  });
});

describe("Proveedores", () => {
  it("alta, duplicado, edición, búsqueda y permisos (el cajero no los ve)", async () => {
    const nuevo = { ruc: "0992345678001", razonSocial: "Comercial Guayas S.A.", email: "ventas@guayas.ec", telefono: "042345678", diasPago: 45 };
    expect((await api("POST", "/api/proveedores", "ges.api.caja", nuevo)).statusCode).toBe(403);
    const r = await api("POST", "/api/proveedores", "ges.api.bodega", nuevo);
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ ruc: "0992345678001", diasPago: 45, status: "ACTIVO" });
    expect((await api("POST", "/api/proveedores", "ges.api.bodega", nuevo)).statusCode).toBe(409);
    expect((await api("POST", "/api/proveedores", "ges.api.bodega", { ...nuevo, ruc: "123" })).statusCode).toBe(400);

    const id = r.json<{ id: string }>().id;
    const edit = await api("PATCH", `/api/proveedores/${id}`, "ges.api.bodega", { diasPago: 60, status: "INACTIVO" });
    expect(edit.json()).toMatchObject({ diasPago: 60, status: "INACTIVO" });
    expect((await api("PATCH", `/api/proveedores/${id}`, "ges.api.bodega", { ruc: proveedor.ruc })).statusCode).toBe(409);

    const buscar = await api("GET", "/api/proveedores?search=guayas", "ges.api.bodega");
    expect(buscar.json<{ items: Array<{ razonSocial: string }>; total: number }>()).toMatchObject({ total: 1, items: [{ razonSocial: "Comercial Guayas S.A." }] });
    expect((await api("GET", "/api/proveedores", "ges.api.caja")).statusCode).toBe(403);
  });
});

describe("Listados", () => {
  it("ventas: el cajero ve solo las suyas; el supervisor todas; filtros por estado, turno, número y fecha; paginación", async () => {
    const mias = await api("GET", "/api/ventas?pageSize=50", "ges.api.caja");
    expect(mias.statusCode).toBe(200);
    // las ventas de la prueba las hicieron otros usuarios (ges.cajeroa/b): este cajero no tiene ninguna
    expect(mias.json<{ total: number }>().total).toBe(0);

    const todas = (await api("GET", "/api/ventas?pageSize=50", "ges.api.super")).json<{ items: Array<{ id: string; numero: string; estado: string; cajero: string; total: number; turnoId: string; createdAt: string }>; total: number }>();
    expect(todas.total).toBe(5);
    expect(todas.items.map((v) => v.cajero).sort()).toEqual(["ges.cajeroa Test", "ges.cajeroa Test", "ges.cajeroa Test", "ges.cajerob Test", "ges.cajerob Test"]);
    expect(todas.items.find((v) => v.id === ventaAnulada)).toMatchObject({ estado: "ANULADA", total: 57.5 });
    expect(todas.items[0]?.createdAt >= (todas.items.at(-1)?.createdAt ?? "")).toBe(true); // más recientes primero

    expect((await api("GET", "/api/ventas?estado=ANULADA", "ges.api.super")).json<{ total: number }>().total).toBe(1);
    expect((await api("GET", `/api/ventas?turnoId=${turnoA}`, "ges.api.super")).json<{ total: number }>().total).toBe(3);
    const un = todas.items[0] as { numero: string };
    expect((await api("GET", `/api/ventas?search=${un.numero}`, "ges.api.super")).json<{ total: number }>().total).toBe(1);
    const hoy = new Date(Date.now() - 5 * 3_600_000).toISOString().slice(0, 10);
    expect((await api("GET", `/api/ventas?desde=${hoy}&hasta=${hoy}`, "ges.api.super")).json<{ total: number }>().total).toBe(4); // una es de hace 3 días
    expect((await api("GET", "/api/ventas?pageSize=2&page=2", "ges.api.super")).json<{ items: unknown[]; page: number }>()).toMatchObject({ page: 2 });
    expect((await api("GET", "/api/ventas?desde=ayer", "ges.api.super")).statusCode).toBe(400);
    expect((await env.backend.server.inject({ method: "GET", url: "/api/ventas" })).statusCode).toBe(401);
  });

  it("compras: por proveedor o número de documento y por fechas", async () => {
    const r = (await api("GET", "/api/compras?search=Andina", "ges.api.bodega")).json<{ items: Array<{ numeroFactura: string; proveedor: string; total: number; formaPago: string; tipoDocumento: string }>; total: number }>();
    expect(r.total).toBe(1);
    expect(r.items[0]).toMatchObject({ numeroFactura: "001-001-000000777", proveedor: "Distribuidora Andina", total: 46, formaPago: "CREDITO", tipoDocumento: "FACTURA" });
    expect((await api("GET", "/api/compras?search=000000777", "ges.api.bodega")).json<{ total: number }>().total).toBe(1);
    expect((await api("GET", "/api/compras?search=zzz", "ges.api.bodega")).json<{ total: number }>().total).toBe(0);
    expect((await api("GET", "/api/compras?desde=2020-01-01&hasta=2020-01-31", "ges.api.bodega")).json<{ total: number }>().total).toBe(0);
  });

  it("catálogos: categorías y unidades para los formularios", async () => {
    const r = (await api("GET", "/api/catalogos", "ges.api.bodega")).json<{ categorias: Array<{ nombre: string }>; unidades: Array<{ codigo: string; permiteDecimales: boolean }> }>();
    expect(r.categorias.map((c) => c.nombre)).toContain("General");
    expect(r.unidades.find((u) => u.codigo === "KG")).toMatchObject({ permiteDecimales: true });
    expect(r.unidades.find((u) => u.codigo === "UN")).toMatchObject({ permiteDecimales: false });
  });
});

describe("Reportes", () => {
  const reporte = async (url: string, quien = "ges.api.conta"): Promise<Reporte> => (await api("GET", url, quien)).json<Reporte>();

  it("ventas por día: no cuenta las anuladas y separa los días", async () => {
    const r = await reporte("/api/reportes/ventas?agrupar=dia");
    expect(r.titulo).toBe("Ventas por día");
    expect(r.filas).toHaveLength(2);
    const hoy = r.filas.find((f) => f["total"] === 23 + 11.5 + 15 + 0);
    expect(hoy).toBeDefined(); // 23 + 11,50 + 15 = 49,50 (la tarjeta de 5 es de hace 3 días y la de 57,50 está anulada)
    expect(r.filas.find((f) => f["cantidad"] === 1 && f["total"] === 5)).toBeDefined();
    expect(r.totales).toMatchObject({ cantidad: 5 - 1, subtotal: 20 + 5 + 10 + 15 + 0 + 0 - 0, total: 54.5 });
    // acotado por fechas: solo los últimos días
    const hoyTxt = new Date(Date.now() - 5 * 3_600_000).toISOString().slice(0, 10);
    const acotado = await reporte(`/api/reportes/ventas?agrupar=dia&desde=${hoyTxt}&hasta=${hoyTxt}`);
    expect(acotado.filas).toHaveLength(1);
    expect(acotado.totales["total"]).toBe(49.5);
  });

  it("ventas por producto, por forma de pago (neto de cambio) y por cajero", async () => {
    const prod = await reporte("/api/reportes/ventas?agrupar=producto");
    expect(prod.filas.map((f) => [f["grupo"], f["cantidad"], f["total"]])).toEqual([["G0 · Producto G0", 4, 20], ["G15 · Producto G15", 3, 34.5]]);
    const pago = await reporte("/api/reportes/ventas?agrupar=formaPago");
    expect(pago.filas.map((f) => [f["grupo"], f["total"]])).toEqual([["CREDITO", 11.5], ["EFECTIVO", 38], ["TARJETA_CREDITO", 5]]); // efectivo: 23 + 15 (el cambio de 7 no cuenta)
    const cajero = await reporte("/api/reportes/ventas?agrupar=cajero");
    expect(cajero.filas.map((f) => [f["grupo"], f["cantidad"], f["total"]])).toEqual([["ges.cajeroa Test", 3, 39.5], ["ges.cajerob Test", 1, 15]]);
  });

  it("utilidad: ventas sin IVA menos el costo promedio de lo vendido", async () => {
    const r = await reporte("/api/reportes/utilidad");
    const g15 = r.filas.find((f) => String(f["producto"]).startsWith("G15"));
    expect(g15).toMatchObject({ cantidad: 3, ingresos: 30, costo: 12, utilidad: 18, margen: 60 });
    const g0 = r.filas.find((f) => String(f["producto"]).startsWith("G0"));
    expect(g0).toMatchObject({ cantidad: 4, ingresos: 20, costo: 8, utilidad: 12, margen: 60 });
    expect(r.totales).toMatchObject({ ingresos: 50, costo: 20, utilidad: 30, margen: 60 });
  });

  it("stock valorado y cartera (por cobrar y por pagar)", async () => {
    const s = await reporte("/api/reportes/stock");
    expect(s.filas.map((f) => f["codigo"])).toEqual(expect.arrayContaining(["G15", "G0"]));
    const f15 = s.filas.find((f) => f["codigo"] === "G15");
    expect(f15?.["valor"]).toBeCloseTo((f15?.["stock"] as number) * (f15?.["costo"] as number), 1);
    expect(s.totales["valor"]).toBeGreaterThan(0);

    const c = await reporte("/api/reportes/cartera");
    expect(c.filas).toEqual([
      { tipo: "Por cobrar", tercero: cliente.razonSocial, cuentas: 1, saldo: 11.5, vencido: 0 },
      { tipo: "Por pagar", tercero: "Distribuidora Andina", cuentas: 1, saldo: 46, vencido: 0 },
    ]);
    expect(c.totales).toMatchObject({ porCobrar: 11.5, porPagar: 46 });
  });

  it("CSV: se descarga solo con reportes:exportar, con BOM, totales y celdas a salvo de fórmulas", async () => {
    const r = await api("GET", "/api/reportes/ventas?agrupar=producto&formato=csv", "ges.api.conta");
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toBe("text/csv; charset=utf-8");
    expect(r.headers["content-disposition"]).toMatch(/^attachment; filename="reporte-ventas\.csv"$/);
    expect(r.body.startsWith("﻿")).toBe(true);
    const lineas = r.body.slice(1).trim().split("\r\n");
    expect(lineas[0]).toBe("Producto,Cantidad,Subtotal,Descuento,IVA,Total");
    expect(lineas[1]).toBe("G0 · Producto G0,4,20,0,0,20");
    expect(lineas.at(-1)).toBe("TOTAL,7,50,0,4.5,54.5");

    expect((await api("GET", "/api/reportes/ventas?formato=csv", "ges.api.caja")).statusCode).toBe(403); // el cajero ni siquiera ve reportes
    const acotado = await api("GET", "/api/reportes/ventas?desde=2020-01-01&hasta=2020-01-02&formato=csv", "admin");
    expect(acotado.body.slice(1).trim()).toBe("Día,Ventas,Subtotal,Descuento,IVA,Total"); // sin ventas en el periodo: solo el encabezado
    expect(acotado.headers["content-disposition"]).toContain("reporte-ventas-2020-01-01_2020-01-02.csv");
  });

  it("el CSV escapa comas y comillas y neutraliza las fórmulas de Excel", () => {
    const r: Reporte = {
      tipo: "ventas", titulo: "x", desde: null, hasta: null,
      columnas: [{ clave: "a", titulo: "Nombre", tipo: "texto" }, { clave: "b", titulo: "Valor", tipo: "dinero" }],
      filas: [{ a: '=CMD("calc")', b: 1.5 }, { a: 'Pérez, "Juan"', b: 2 }, { a: "+54 99", b: 3 }, { a: "normal", b: 4 }],
      totales: { b: 10.5 },
    };
    const csv = reporteACsv(r).slice(1).split("\r\n");
    expect(csv[1]).toBe(`"'=CMD(""calc"")",1.5`);
    expect(csv[2]).toBe('"Pérez, ""Juan""",2');
    expect(csv[3]).toBe("'+54 99,3");
    expect(csv[5]).toBe("TOTAL,10.5");
  });

  it("permisos y validación: el cajero no ve reportes; fechas inválidas o invertidas y tipos desconocidos dan 400", async () => {
    expect((await api("GET", "/api/reportes/ventas", "ges.api.caja")).statusCode).toBe(403);
    expect((await api("GET", "/api/reportes/ventas", "ges.api.bodega")).statusCode).toBe(403);
    expect((await api("GET", "/api/reportes/ventas?desde=2024-05-10&hasta=2024-05-01", "ges.api.conta")).statusCode).toBe(400);
    expect((await api("GET", "/api/reportes/ventas?desde=10/05/2024", "ges.api.conta")).statusCode).toBe(400);
    expect((await api("GET", "/api/reportes/ventas?agrupar=semana", "ges.api.conta")).statusCode).toBe(400);
    expect((await api("GET", "/api/reportes/inventado", "ges.api.conta")).statusCode).toBe(400);
    expect((await api("GET", "/api/reportes/ventas", "ges.api.super")).statusCode).toBe(200);
  });
});

// ============================================================
// tests/integration/server/inventario-api.test.ts
// Endpoints de catálogo, presentaciones, listas de precios, lotes, ajustes y alertas (HTTP + RBAC + flags)
// ============================================================
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { abrirTurno, configurarGiro, crearClienteConCredito, crearEntorno, type Entorno } from "../helpers/entorno.helper";

let env: Entorno;
const tokens: Record<string, string> = {};

async function crearYLogin(rol: string, username: string): Promise<string> {
  const u = await env.servicios.usuarios.crear({
    empresaId: env.seed.empresaId, rol, username, password: "Clave12345", nombre: username, apellido: "Api",
  });
  const r = await env.backend.server.inject({ method: "POST", url: "/api/auth/login", payload: { username, password: "Clave12345" } });
  tokens[username] = (r.json() as { token: string }).token;
  return u.id;
}

type Metodo = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
const api = (method: Metodo, url: string, quien?: string, payload?: unknown) =>
  env.backend.server.inject({
    method,
    url,
    ...(quien !== undefined ? { headers: { authorization: `Bearer ${tokens[quien]}` } } : {}),
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });

const nuevoProducto = (extra: Record<string, unknown> = {}) => ({
  codigo: "API-1", nombre: "Gaseosa", tipo: "BIEN", categoriaId: env.categoriaId, unidadMedidaId: env.unidadMedidaId,
  precioCompra: 0.5, precioVenta: 1, ...extra,
});

let productoId: string;
let presentacionId: string;

beforeAll(async () => {
  env = await crearEntorno();
  await crearYLogin("BODEGUERO", "bodega");
  const cajeroId = await crearYLogin("CAJERO", "cajero");
  await crearYLogin("SUPERVISOR", "super");
  await crearYLogin("CONTADOR", "conta");
  await abrirTurno(env, cajeroId);
}, 60_000);

afterAll(async () => {
  await env.cerrar();
});

describe("Catálogo y presentaciones", () => {
  it("POST /productos: bodeguero 201; cajero 403; sin sesión 401; datos inválidos 400; duplicado 409", async () => {
    expect((await api("POST", "/api/productos", undefined, nuevoProducto())).statusCode).toBe(401);
    expect((await api("POST", "/api/productos", "cajero", nuevoProducto())).statusCode).toBe(403);
    expect((await api("POST", "/api/productos", "bodega", { codigo: "X" })).statusCode).toBe(400);

    const r = await api("POST", "/api/productos", "bodega", nuevoProducto({ codigoBarras: "7001112223334" }));
    expect(r.statusCode).toBe(201);
    productoId = (r.json() as { id: string }).id;
    const dup = await api("POST", "/api/productos", "bodega", nuevoProducto());
    expect(dup.statusCode).toBe(409);
    expect(dup.json()).toMatchObject({ error: "DUPLICADO" });
    expect((await api("POST", "/api/productos", "bodega", nuevoProducto({ codigo: "API-2", categoriaId: "11111111-1111-4111-8111-111111111111" }))).statusCode).toBe(404);
  });

  it("PATCH /productos/:id actualiza; 404 si no existe", async () => {
    const r = await api("PATCH", `/api/productos/${productoId}`, "bodega", { precioVenta: 1.25 });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ precioVenta: 1.25 });
    expect((await api("PATCH", "/api/productos/no-existe", "bodega", { precioVenta: 2 })).statusCode).toBe(404);
    expect((await api("PATCH", `/api/productos/${productoId}`, "cajero", { precioVenta: 2 })).statusCode).toBe(403);
  });

  it("presentaciones: crear (201), listar, actualizar, duplicado 409 y validación 400", async () => {
    const r = await api("POST", `/api/productos/${productoId}/presentaciones`, "bodega", { nombre: "Caja x12", factor: 12, codigoBarras: "7001112223999", precioVenta: 13 });
    expect(r.statusCode).toBe(201);
    presentacionId = (r.json() as { id: string }).id;

    expect((await api("POST", `/api/productos/${productoId}/presentaciones`, "bodega", { nombre: "Caja x12", factor: 12 })).statusCode).toBe(409);
    expect((await api("POST", `/api/productos/${productoId}/presentaciones`, "bodega", { nombre: "Mala", factor: 0 })).statusCode).toBe(400);
    expect((await api("POST", `/api/productos/${productoId}/presentaciones`, "cajero", { nombre: "Otra", factor: 2 })).statusCode).toBe(403);

    const lista = await api("GET", `/api/productos/${productoId}/presentaciones`, "cajero");
    expect(lista.statusCode).toBe(200);
    expect((lista.json() as unknown[]).length).toBe(1);
    expect((await api("GET", "/api/productos/no-existe/presentaciones", "cajero")).statusCode).toBe(404);

    const act = await api("PATCH", `/api/presentaciones/${presentacionId}`, "bodega", { precioVenta: 12.5 });
    expect(act.json()).toMatchObject({ precioVenta: 12.5 });
  });

  it("GET /productos/barcode/:codigo devuelve el producto y la presentación escaneada", async () => {
    const r = await api("GET", "/api/productos/barcode/7001112223999", "cajero");
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ id: productoId, presentacion: { id: presentacionId, factor: 12 } });
    const directo = await api("GET", "/api/productos/barcode/7001112223334", "cajero");
    expect(directo.json()).toMatchObject({ id: productoId, presentacion: null });
  });
});

describe("Venta HTTP con presentación y política de precio", () => {
  it("el cajero vende por presentación sin enviar precio; el precio fuera de lista se rechaza (400)", async () => {
    await api("POST", "/api/inventario/ajustes", "bodega", { productoId, tipo: "ENTRADA", cantidad: 100, costoUnitario: 0.5, motivo: "Carga inicial" });
    const cuerpo = (linea: Record<string, unknown>) => ({
      puntoEmisionId: env.seed.puntoEmisionId, lineas: [{ productoId, ...linea }], pagos: [{ formaPago: "EFECTIVO", monto: 100 }],
    });

    const ok = await api("POST", "/api/ventas", "cajero", cuerpo({ presentacionId, cantidad: 2 }));
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ subtotal: 25, lineas: [{ cantidadBase: 24, factorConversion: 12, precioUnitario: 12.5 }] });
    expect((await api("GET", `/api/inventario/productos/${productoId}/kardex`, "bodega")).json()).toMatchObject({
      producto: { stockActual: 76 },
      items: [{ tipoMovimiento: "VENTA", cantidad: 24 }, { tipoMovimiento: "AJUSTE_ENTRADA", cantidad: 100 }],
    });

    const caro = await api("POST", "/api/ventas", "cajero", cuerpo({ cantidad: 1, precioUnitario: 0.1 }));
    expect(caro.statusCode).toBe(400);
    expect(caro.json()).toMatchObject({ error: "VALIDACION" });
    const fraccion = await api("POST", "/api/ventas", "cajero", cuerpo({ cantidad: 1.5 }));
    expect(fraccion.statusCode).toBe(400);
  });
});

describe("Listas de precios", () => {
  let listaId: string;
  let precioId: string;

  it("CRUD por HTTP: crear 201, duplicado 409, fijar precio 200, listar y quitar 204", async () => {
    expect((await api("POST", "/api/listas-precio", "cajero", { nombre: "Mayorista" })).statusCode).toBe(403);
    const r = await api("POST", "/api/listas-precio", "bodega", { nombre: "Mayorista", descripcion: "Distribuidores" });
    expect(r.statusCode).toBe(201);
    listaId = (r.json() as { id: string }).id;
    expect((await api("POST", "/api/listas-precio", "bodega", { nombre: "Mayorista" })).statusCode).toBe(409);
    expect((await api("GET", "/api/listas-precio", "cajero")).json()).toHaveLength(1);

    const fijar = await api("PUT", `/api/listas-precio/${listaId}/precios`, "bodega", { productoId, precio: 0.9 });
    expect(fijar.statusCode).toBe(200);
    precioId = (fijar.json() as { id: string }).id;
    expect(fijar.json()).toMatchObject({ precio: 0.9, presentacion: null, producto: { id: productoId } });
    expect((await api("PUT", `/api/listas-precio/${listaId}/precios`, "bodega", { productoId, precio: -1 })).statusCode).toBe(400);
    expect((await api("GET", `/api/listas-precio/${listaId}/precios`, "cajero")).json()).toHaveLength(1);
    expect((await api("PATCH", `/api/listas-precio/${listaId}`, "bodega", { descripcion: "Nueva" })).statusCode).toBe(200);
  });

  it("asignar lista a cliente (clientes:actualizar) y venta con precio de lista", async () => {
    const cliente = await crearClienteConCredito(env, "0926687856001", 0);
    expect((await api("PUT", `/api/clientes/${cliente.id}/lista-precio`, "cajero", { listaPrecioId: listaId })).statusCode).toBe(403);
    const r = await api("PUT", `/api/clientes/${cliente.id}/lista-precio`, "super", { listaPrecioId: listaId });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ listaPrecioId: listaId });

    const venta = await api("POST", "/api/ventas", "cajero", {
      puntoEmisionId: env.seed.puntoEmisionId, clienteId: cliente.id,
      lineas: [{ productoId, cantidad: 10 }], pagos: [{ formaPago: "EFECTIVO", monto: 100 }],
    });
    expect(venta.json()).toMatchObject({ subtotal: 9, lineas: [{ precioUnitario: 0.9 }] });

    expect((await api("DELETE", `/api/listas-precio/${listaId}/precios/${precioId}`, "bodega")).statusCode).toBe(204);
    expect((await api("DELETE", `/api/listas-precio/${listaId}/precios/${precioId}`, "bodega")).statusCode).toBe(404);
  });

  it("con el módulo deshabilitado → 403 MODULO_DESHABILITADO", async () => {
    await configurarGiro(env, { moduloListasPrecios: false });
    try {
      const r = await api("GET", "/api/listas-precio", "bodega");
      expect(r.statusCode).toBe(403);
      expect(r.json()).toMatchObject({ error: "MODULO_DESHABILITADO" });
    } finally {
      await configurarGiro(env, { moduloListasPrecios: true });
    }
  });
});

describe("Lotes, ajustes y alertas", () => {
  let medId: string;
  let loteId: string;

  it("sin módulo de lotes: crear producto con lote y consultar lotes → 403", async () => {
    const r = await api("POST", "/api/productos", "bodega", nuevoProducto({ codigo: "MED-API", requiereLote: true }));
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ error: "MODULO_DESHABILITADO" });
    expect((await api("GET", "/api/inventario/lotes", "bodega")).statusCode).toBe(403);
    expect((await api("GET", "/api/inventario/alertas-vencimiento", "bodega")).statusCode).toBe(403);
  });

  it("con el módulo activo: producto con lote, alta de lote, listado y edición", async () => {
    await configurarGiro(env, { moduloLotes: true, moduloVencimientos: true });
    const med = await api("POST", "/api/productos", "bodega", nuevoProducto({ codigo: "MED-API", requiereLote: true, tieneVencimiento: true, principioActivo: "amoxicilina", stockMinimo: 30 }));
    expect(med.statusCode).toBe(201);
    medId = (med.json() as { id: string }).id;

    const venc = new Date(Date.now() + 12 * 86_400_000).toISOString();
    const lote = await api("POST", "/api/inventario/lotes", "bodega", { productoId: medId, numeroLote: "LOTE-1", fechaVencimiento: venc, cantidad: 20, costoUnitario: 1 });
    expect(lote.statusCode).toBe(201);
    loteId = (lote.json() as { id: string }).id;
    expect(lote.json()).toMatchObject({ numeroLote: "LOTE-1", cantidadActual: 20, producto: { principioActivo: "amoxicilina" } });

    expect((await api("POST", "/api/inventario/lotes", "cajero", { productoId: medId, numeroLote: "L2", fechaVencimiento: venc, cantidad: 1, costoUnitario: 1 })).statusCode).toBe(403);
    expect((await api("POST", "/api/inventario/lotes", "bodega", { productoId: medId, numeroLote: "L2", fechaVencimiento: "2001-01-01", cantidad: 1, costoUnitario: 1 })).statusCode).toBe(400);

    expect(((await api("GET", `/api/inventario/lotes?productoId=${medId}&conStock=true`, "cajero")).json() as { total: number }).total).toBe(1);
    expect((await api("GET", `/api/inventario/lotes/${loteId}`, "cajero")).statusCode).toBe(200);
    expect((await api("GET", "/api/inventario/lotes/no-existe", "cajero")).statusCode).toBe(404);
    expect((await api("PATCH", `/api/inventario/lotes/${loteId}`, "bodega", { status: "BLOQUEADO" })).json()).toMatchObject({ status: "BLOQUEADO" });
    await api("PATCH", `/api/inventario/lotes/${loteId}`, "bodega", { status: "ACTIVO" });
  });

  it("venta HTTP con FEFO y ajuste de salida por lote", async () => {
    const venta = await api("POST", "/api/ventas", "cajero", {
      puntoEmisionId: env.seed.puntoEmisionId, lineas: [{ productoId: medId, cantidad: 5 }], pagos: [{ formaPago: "EFECTIVO", monto: 20 }],
    });
    expect(venta.statusCode).toBe(201);
    expect((venta.json() as { lineas: Array<{ loteId: string }> }).lineas[0]?.loteId).toBe(loteId);

    const salida = await api("POST", "/api/inventario/ajustes", "bodega", { productoId: medId, tipo: "SALIDA", cantidad: 2, loteId, motivo: "Producto dañado" });
    expect(salida.statusCode).toBe(201);
    expect(salida.json()).toMatchObject({ producto: { stockActual: 13 }, movimiento: { tipoMovimiento: "AJUSTE_SALIDA" } });
    expect((await api("POST", "/api/inventario/ajustes", "cajero", { productoId: medId, tipo: "SALIDA", cantidad: 1, loteId, motivo: "No autorizado" })).statusCode).toBe(403);
    expect((await api("POST", "/api/inventario/ajustes", "bodega", { productoId: medId, tipo: "SALIDA", cantidad: 99, loteId, motivo: "Demasiado" })).statusCode).toBe(409);
    expect((await api("POST", "/api/inventario/ajustes", "bodega", { productoId: medId, tipo: "SALIDA", cantidad: 1, loteId, motivo: "no" })).statusCode).toBe(400);
  });

  it("alertas: vencimiento (con ventana) y stock mínimo", async () => {
    const venc = await api("GET", "/api/inventario/alertas-vencimiento?dias=30", "cajero");
    expect(venc.statusCode).toBe(200);
    const cuerpo = venc.json() as { dias: number; vencidos: unknown[]; porVencer: Array<{ numeroLote: string; diasRestantes: number }> };
    expect(cuerpo.porVencer.map((a) => a.numeroLote)).toContain("LOTE-1");
    expect(cuerpo.porVencer.find((a) => a.numeroLote === "LOTE-1")?.diasRestantes).toBe(12);
    expect(((await api("GET", "/api/inventario/alertas-vencimiento?dias=5", "cajero")).json() as { porVencer: unknown[] }).porVencer).toHaveLength(0);
    expect((await api("GET", "/api/inventario/alertas-vencimiento?dias=abc", "cajero")).statusCode).toBe(400);

    const stock = await api("GET", "/api/inventario/alertas-stock", "cajero");
    expect(stock.statusCode).toBe(200);
    expect(stock.json()).toMatchObject({ items: [{ codigo: "MED-API", stockActual: 13, stockMinimo: 30, faltante: 17 }] });
    expect((await api("GET", "/api/inventario/alertas-stock", "conta")).statusCode).toBe(403); // el contador no tiene inventario:leer
  });
});

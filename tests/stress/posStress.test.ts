import { once } from "node:events";
import { existsSync } from "node:fs";
import { request, type IncomingMessage } from "node:http";
import { dirname } from "node:path";
import { setTimeout as esperar } from "node:timers/promises";
import type { Producto } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SriWorker } from "../../src/server/jobs/sriWorker.job";
import { SriTransporteError, type ClienteSri } from "../../src/server/services/sri/ws/sriSoap.types";
import { generarP12Prueba } from "../helpers/certificados.helper";
import {
  abrirTurno, crearActor, crearEntorno, crearProducto, type Entorno,
} from "../integration/helpers/entorno.helper";

const LOTE = 20;
const CATALOGO = 25_000;
let env: Entorno;
let productos: Producto[];
let token: string;
let conectado = false;
let intentos = 0;
let reloj = Date.now();
const autorizadas = new Set<string>();
const clienteSri: ClienteSri = {
  async enviarComprobante() {
    intentos++;
    await esperar(2);
    if (!conectado) throw new SriTransporteError("Red de pruebas desconectada");
    return { estado: "RECIBIDA", mensajes: [] };
  },
  async consultarAutorizacion(_ambiente, claveAcceso) {
    expect(autorizadas.has(claveAcceso)).toBe(false);
    autorizadas.add(claveAcceso);
    return {
      claveAcceso,
      autorizaciones: [{
        estado: "AUTORIZADO", numeroAutorizacion: claveAcceso, fechaAutorizacion: new Date(),
        ambiente: "PRUEBAS", comprobante: null, mensajes: [],
      }],
    };
  },
};
const api = (method: "GET" | "POST", url: string, payload?: object) =>
  env.backend.server.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload ? { payload } : {}) });
const barras = (i: number) => `786${String(i).padStart(10, "0")}`;
const venta = (items: Producto[], emitirFactura = false, monto = 20) => ({
  puntoEmisionId: env.seed.puntoEmisionId,
  emitirFactura,
  lineas: items.map(({ id }, i) => ({
    productoId: id, cantidad: 1, ...(i === 0 ? { descuento: 0.01, tipoDescuento: "VALOR" } : {}),
  })),
  pagos: [{ formaPago: "EFECTIVO", monto }],
});

function medir(nombre: string, muestras: number[]): void {
  const orden = [...muestras].sort((a, b) => a - b);
  const max = orden.at(-1)!;
  process.stdout.write(`[estrés] ${nombre} n=${orden.length} p50=${orden[Math.ceil(orden.length / 2) - 1]!.toFixed(2)} p95=${orden[Math.ceil(orden.length * 0.95) - 1]!.toFixed(2)} máx=${max.toFixed(2)} ms\n`);
}

async function estadoCaja() {
  const p = env.prisma;
  return {
    ventas: await p.venta.count(),
    pagos: await p.pagoVenta.count(),
    kardex: await p.kardex.count(),
    caja: await p.movimientoCaja.count(),
    comprobantes: await p.comprobanteElectronico.count(),
    cola: await p.colaSRI.count(),
    secuenciales: await p.secuencialComprobante.findMany({ orderBy: { id: "asc" } }),
    punto: await p.puntoEmision.findUniqueOrThrow({ where: { id: env.seed.puntoEmisionId } }),
    stock: await p.producto.findMany({
      where: { id: { in: productos.map(({ id }) => id) } },
      select: { id: true, stockActual: true },
      orderBy: { id: "asc" },
    }),
  };
}

beforeAll(async () => {
  env = await crearEntorno({ sri: { cliente: clienteSri, envio: { ahora: () => new Date(reloj) } } });
  const admin = await crearActor(env, "ADMIN", "stress.admin");
  await abrirTurno(env, admin.id);
  const login = await env.backend.server.inject({
    method: "POST", url: "/api/auth/login", payload: { username: "stress.admin", password: "Clave12345" },
  });
  expect(login.statusCode).toBe(200);
  token = login.json<{ token: string }>().token;
  productos = [];
  for (const [i, codigoIva] of ["4", "5", "0"].entries()) {
    productos.push(await crearProducto(env, { codigo: `STRESS-${i}`, codigoIva, precioVenta: 1, stock: 2_000 }));
  }
  const p12 = generarP12Prueba({ identificacion: "9999999999001", password: "Clave-P12-1" });
  await env.servicios.certificados.guardar({ archivoBase64: p12.archivo.toString("base64"), password: p12.password }, admin);
}, 120_000);

afterAll(async () => {
  try {
    await env?.cerrar();
  } finally {
    if (env) expect(existsSync(dirname(dirname(env.secretos)))).toBe(false);
  }
}, 30_000);

describe.sequential("Estrés POS con SQLite, Fastify y firma reales", () => {
  it("consulta 25.000 productos por código exacto y nombre parcial en menos de 50 ms por consulta", async () => {
    expect(await env.prisma.$queryRaw`PRAGMA journal_mode`).toEqual([{ journal_mode: "wal" }]);
    expect(await env.prisma.$queryRaw`PRAGMA busy_timeout`).toEqual([{ timeout: 5_000n }]);
    for (let inicio = 0; inicio < CATALOGO; inicio += 500) {
      await env.prisma.producto.createMany({
        data: Array.from({ length: 500 }, (_, j) => {
          const i = inicio + j;
          return { codigo: `CAT-${i}`, codigoBarras: barras(i), nombre: `Artículo grupo ${i % 50} serie ${i}`,
            precioVenta: 1, categoriaId: env.categoriaId, unidadMedidaId: env.unidadMedidaId };
        }),
      });
    }

    const exacto: number[] = [];
    const parcial: number[] = [];
    for (let i = -3; i < 40; i++) {
      const id = Math.abs(i * 577) % CATALOGO;
      const grupo = Math.abs(i) % 50;
      let inicio = performance.now();
      const exacta = await api("GET", `/api/productos/barcode/${barras(id)}`);
      const msExacta = performance.now() - inicio;
      expect(exacta.statusCode, exacta.body).toBe(200);
      expect(exacta.json()).toMatchObject({ codigoBarras: barras(id) });
      inicio = performance.now();
      const porNombre = await api("GET", `/api/productos?search=grupo%20${grupo}%20serie&pageSize=24`);
      const msParcial = performance.now() - inicio;
      expect(porNombre.statusCode, porNombre.body).toBe(200);
      expect(porNombre.json()).toMatchObject({ total: 500 });
      if (i >= 0) {
        exacto.push(msExacta);
        parcial.push(msParcial);
      }
    }
    medir("barras", exacto);
    medir("nombre parcial", parcial);
    expect.soft(Math.max(...exacto)).toBeLessThan(50);
    expect.soft(Math.max(...parcial)).toBeLessThan(50);

    const where = { codigo: "CAT-0" };
    await env.prisma.producto.update({ where, data: { nombre: "Control de índice", principioActivo: "Control de índice" } });
    expect((await api("GET", "/api/productos?search=grupo%200%20serie")).json()).toMatchObject({ total: 499 });
    const consultaIndice = "/api/productos?search=Control%20de%20%C3%ADndice";
    expect((await api("GET", consultaIndice)).json()).toMatchObject({ total: 1 });
    expect((await api("GET", `${consultaIndice}&page=2&pageSize=1`)).json()).toMatchObject({ items: [], total: 1 });
    await env.prisma.producto.delete({ where });
    expect((await api("GET", consultaIndice)).json()).toMatchObject({ items: [], total: 0 });
  }, 120_000);

  it("cobra 1.000 ventas y arbitra 50 cobros concurrentes con solo 20 unidades", async () => {
    const antes = await estadoCaja();
    const datos = venta(productos);
    const inicio = performance.now();
    for (let i = 0; i < 1_000; i++) {
      const r = await api("POST", "/api/ventas", datos);
      expect(r.statusCode, r.body).toBe(201);
      expect(r.json()).toMatchObject({ subtotal: 2.99, descuento: 0.01, iva: 0.2, total: 3.19 });
    }
    process.stdout.write(`[estrés] ventas consecutivas/s=${(1_000_000 / (performance.now() - inicio)).toFixed(2)}\n`);
    const limitados: Producto[] = [];
    for (const i of [1, 2]) limitados.push(await crearProducto(env, { codigo: `LIMITADO-${i}`, stock: 20, precioVenta: 1 }));
    const t = performance.now();
    const respuestas = await Promise.all(Array.from({ length: 50 }, () => api("POST", "/api/ventas", venta(limitados, true))));
    const aceptadas = respuestas.filter(({ statusCode }) => statusCode === 201);
    process.stdout.write(`[estrés] ráfaga 50: ${aceptadas.length} cobros en ${(performance.now() - t).toFixed(2)} ms\n`);
    expect(aceptadas).toHaveLength(20);
    for (const r of respuestas.filter(({ statusCode }) => statusCode !== 201)) {
      expect(r.json(), r.body).toMatchObject({ error: "STOCK_INSUFICIENTE" });
      expect(r.statusCode).toBe(409);
    }
    const p = env.prisma;
    expect(await p.producto.count({ where: { stockActual: { lt: 0 } } })).toBe(0);
    expect(await p.producto.count({ where: { id: { in: limitados.map(({ id }) => id) }, stockActual: 0 } })).toBe(2);
    expect(await p.venta.count()).toBe(antes.ventas + 1_020);
    expect(await p.kardex.count()).toBe(antes.kardex + 3_042);
    expect(await p.pagoVenta.count({ where: { cambio: 16.81 } })).toBe(1_000);
    const facturas = await p.comprobanteElectronico.findMany({ orderBy: { secuencial: "asc" } });
    expect(facturas.map(({ secuencial }) => Number(secuencial))).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    const { empresaId, sucursalId, puntoEmisionId, tipoComprobante, serie, secuencial, fechaEmision } = facturas[0]!;
    await expect(p.comprobanteElectronico.create({ data: {
      empresaId, sucursalId, puntoEmisionId, tipoComprobante, serie, secuencial, fechaEmision, claveAcceso: "0".repeat(49),
    } })).rejects.toMatchObject({ code: "P2002" });
  }, 180_000);

  it("revierte una validación y un fallo al encolar la factura después de descontar Kardex", async () => {
    const antes = await estadoCaja();
    const invalida = await api("POST", "/api/ventas", venta(productos, true, 0.01));
    expect(invalida.statusCode).toBe(400);
    expect(await estadoCaja()).toEqual(antes);
    await env.prisma.$executeRaw`CREATE TEMP TRIGGER stress_fallo_cola BEFORE INSERT ON ColaSRI
      BEGIN SELECT RAISE(ABORT, 'fallo de persistencia simulado'); END`;
    try {
      const r = await api("POST", "/api/ventas", venta(productos, true));
      expect(r.statusCode).toBe(500);
      expect(await estadoCaja()).toEqual(antes);
    } finally {
      await env.prisma.$executeRaw`DROP TRIGGER stress_fallo_cola`;
    }
  });

  it("conserva inventario y caja si la conexión se corta durante el envío del cobro", async () => {
    const antes = await estadoCaja();
    const cuerpo = JSON.stringify(venta(productos, true));
    const llegada = new AbortController();
    const peticionRecibida = once(env.backend.server.server, "request", {
      signal: AbortSignal.any([llegada.signal, AbortSignal.timeout(3_000)]),
    });
    const cliente = request(`${env.backend.url}/api/ventas`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "content-length": Buffer.byteLength(cuerpo) },
    });
    cliente.once("error", (error) => llegada.abort(error));
    try {
      cliente.write(cuerpo.slice(0, -1));
      const [recibida] = await peticionRecibida as [IncomingMessage];
      const cierre = new Promise<void>((resolve) => recibida.once("close", resolve));
      cliente.destroy();
      await cierre;
      expect(recibida.complete).toBe(false);
      expect(await estadoCaja()).toEqual(antes);
    } finally {
      llegada.abort();
      cliente.destroy();
    }
  });

  it("firma 500 comprobantes sin red y autoriza por lotes mientras la caja sigue cobrando", async () => {
    const p = env.prisma;
    const previas = await p.colaSRI.count();
    const worker = new SriWorker(env.servicios.envioSri, { lote: LOTE });
    for (let i = previas; i < 500; i++) {
      const r = await api("POST", "/api/ventas", venta(productos, true));
      expect(r.statusCode, r.body).toBe(201);
    }
    expect(await p.colaSRI.count()).toBe(500);
    reloj = Date.now();
    const inicioOffline = performance.now();
    for (let i = 0; i < 500; i += LOTE) expect(await worker.ejecutarCiclo()).toBe(LOTE);
    expect(intentos).toBe(500);
    expect(await p.comprobanteElectronico.count({ where: { estado: "PENDIENTE", xmlFirmado: { not: null }, proximoIntento: { not: null } } })).toBe(500);
    expect(await p.colaSRI.count()).toBe(500);
    process.stdout.write(`[estrés] firma y fallo de red 500: ${(performance.now() - inicioOffline).toFixed(2)} ms\n`);

    conectado = true;
    reloj += 60_000;
    const inicio = performance.now();
    const rssInicial = process.memoryUsage().rss;
    let rssMax = rssInicial;
    const caja: number[] = [];
    for (let i = 0; i < 500; i += LOTE) {
      const ciclo = worker.ejecutarCiclo();
      const t = performance.now();
      const r = await api("POST", "/api/ventas", venta(productos));
      caja.push(performance.now() - t);
      expect(r.statusCode, r.body).toBe(201);
      expect(await ciclo).toBe(LOTE);
      rssMax = Math.max(rssMax, process.memoryUsage().rss);
    }
    const mb = (rssMax - rssInicial) / 1_048_576;
    medir("caja durante sincronización", caja);
    process.stdout.write(`[estrés] recuperación 500: ${(performance.now() - inicio).toFixed(2)} ms; aumento pico RSS muestreado: ${mb.toFixed(2)} MiB\n`);
    expect(mb).toBeLessThan(128);
    expect(Math.max(...caja)).toBeLessThan(1_000);
    expect(autorizadas.size).toBe(500);
    expect(await p.comprobanteElectronico.count({ where: { estado: "AUTORIZADO" } })).toBe(500);
    expect(await p.colaSRI.count()).toBe(0);
    expect(await p.$queryRaw`PRAGMA integrity_check`).toEqual([{ integrity_check: "ok" }]);
    expect(await p.$queryRaw`PRAGMA foreign_key_check`).toEqual([]);
  }, 300_000);
});

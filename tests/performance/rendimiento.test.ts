// ============================================================
// tests/performance/rendimiento.test.ts — Banco de pruebas de rendimiento y estrés (NO forma parte de `npm test`)
//
//   npm run test:rendimiento
//
// Sobre una base de 20 000+ productos y 135 000+ ventas (ver generador.ts) mide, con el backend REAL (SQLite + HTTP), los tiempos de las
// operaciones de caja y de gestión (p50/p95/máx) y los compara con PRESUPUESTOS; además somete al servidor a varias cajas vendiendo a la
// vez y verifica que no se pierde, duplica ni corrompe nada. Escribe los resultados en out/rendimiento/resultados.json.
// Variables: VENDEYA_RENDIMIENTO_{PRODUCTOS,CLIENTES,DIAS,VENTAS_DIA,TURNO_ABIERTO} (escala), VENDEYA_RENDIMIENTO_FACTOR (multiplica los
// presupuestos en equipos más lentos que el de referencia).
// ============================================================
import { mkdirSync, rmSync, statSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { iniciarBackend, type BackendHandle } from "../../src/server";
import { obtenerCopiaDeTrabajo, CARPETA, PASSWORD_ADMIN, parametros, tamanoMB } from "./base";
import { PASSWORD_CAJEROS, type ParametrosBase, type ResumenBase } from "./generador";

if (process.env["VENDEYA_RENDIMIENTO"] !== "1") throw new Error("Este banco de pruebas se ejecuta con `npm run test:rendimiento`");

const FACTOR = Number(process.env["VENDEYA_RENDIMIENTO_FACTOR"]) > 0 ? Number(process.env["VENDEYA_RENDIMIENTO_FACTOR"]) : 1;

/**
 * Presupuestos: p95 máximo en milisegundos. Se fijaron con margen amplio (≈ 2× lo PEOR observado en 6 corridas completas) porque el equipo de
 * referencia (portátil de uso diario, ver resultados.json › equipo) tuvo una variación de hasta 10× entre corridas por carga ajena y disco. Detectan
 * regresiones de orden de magnitud, no de porcentajes; en un equipo en reposo los tiempos típicos son 3–10× menores (ver PROJECT_STATUS, Semana 21).
 * Si falla en un equipo más lento, use VENDEYA_RENDIMIENTO_FACTOR.
 */
export const PRESUPUESTOS: Record<string, number> = {
  "primer arranque aplicando migraciones pendientes": 120_000, // respaldo previo + crear índices + ANALYZE sobre cientos de MB
  "arranque del backend (base grande)": 5_000,
  "búsqueda de productos por nombre": 600,
  "búsqueda de productos por código": 400,
  "búsqueda por código de barras": 150,
  "búsqueda de varias palabras": 600,
  "venta de 1 línea": 400,
  "venta de 20 líneas": 1_000,
  "anulación de venta": 400,
  "reporte de turno con miles de ventas": 3_000,
  "cierre de turno con miles de ventas": 5_000,
  "reporte de ventas por día (90 días)": 3_000,
  "reporte de ventas por producto": 15_000,
  "reporte de ventas por producto (30 días)": 15_000,
  "reporte de utilidad": 25_000,
  "reporte de stock valorado (20 000 productos)": 8_000,
  "reporte de cartera": 3_000,
  "CSV de ventas por producto": 30_000,
  "CSV de stock valorado": 8_000,
  "listado de comprobantes pendientes": 400,
  "listado de comprobantes autorizados": 1_000,
  "estado de la cola del SRI": 600,
  "ATS del mes": 60_000,
  "respaldo de la base de datos": 60_000,
  "venta con 8 cajas simultáneas": 3_000, // 8 cajas sin pausa entre ventas: muy por encima de la demanda real
  "búsqueda mientras 8 cajas venden": 3_000,
};

interface Medicion { nombre: string; n: number; p50: number; p95: number; max: number; presupuestoP95: number | null }
const mediciones: Medicion[] = [];
const extras: Record<string, unknown> = {};
const salida = (m: string): void => void process.stdout.write(`${m}\n`);

const percentil = (v: number[], p: number): number => {
  const o = [...v].sort((a, b) => a - b);
  return o[Math.min(o.length - 1, Math.max(0, Math.ceil((p / 100) * o.length) - 1))] as number;
};
const redondear = (n: number): number => Math.round(n * 10) / 10;

function anotar(nombre: string, tiempos: number[]): Medicion {
  const presupuesto = PRESUPUESTOS[nombre];
  const m: Medicion = { nombre, n: tiempos.length, p50: redondear(percentil(tiempos, 50)), p95: redondear(percentil(tiempos, 95)), max: redondear(Math.max(...tiempos)), presupuestoP95: presupuesto === undefined ? null : presupuesto * FACTOR };
  mediciones.push(m);
  salida(`  ${nombre.padEnd(48)} n=${String(m.n).padStart(4)}  p50=${String(m.p50).padStart(8)} ms  p95=${String(m.p95).padStart(8)} ms  máx=${String(m.max).padStart(8)} ms${m.presupuestoP95 === null ? "" : `  (presupuesto p95 ${m.presupuestoP95} ms)`}`);
  return m;
}

async function medir(nombre: string, n: number, fn: (i: number) => Promise<unknown>, calentamiento = 2): Promise<Medicion> {
  for (let i = 0; i < calentamiento; i++) await fn(-1 - i);
  const tiempos: number[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    await fn(i);
    tiempos.push(performance.now() - t0);
  }
  return anotar(nombre, tiempos);
}

function dentroDePresupuesto(m: Medicion): void {
  // «soft»: un presupuesto incumplido se informa al final pero no impide medir lo demás
  if (m.presupuestoP95 !== null) expect.soft(m.p95, `${m.nombre}: p95 ${m.p95} ms supera el presupuesto de ${m.presupuestoP95} ms`).toBeLessThanOrEqual(m.presupuestoP95);
}

let b: BackendHandle;
let p: ParametrosBase;
let resumen: ResumenBase;
let dir = "";
let dbPath = "";
const tokens: Record<string, string> = {};
let sucursalId = "";
let puntos: string[] = [];
let productosVenta: Array<{ id: string; precioVenta: number; aplicaIva: boolean }> = [];

const api = (method: "GET" | "POST", url: string, quien: string, payload?: unknown) =>
  b.server.inject({ method, url, headers: { authorization: `Bearer ${tokens[quien]}` }, ...(payload !== undefined ? { payload: payload as object } : {}) });

async function login(username: string, password: string): Promise<void> {
  const r = await b.server.inject({ method: "POST", url: "/api/auth/login", payload: { username, password } });
  expect(r.statusCode, `login de ${username}`).toBe(200);
  tokens[username] = (r.json() as { token: string }).token;
}

/** Venta de `n` líneas distintas de productos sin lote, con el total exacto (el pago debe cubrirlo). */
function ventaDe(n: number, puntoEmisionId: string, desplazamiento: number): { puntoEmisionId: string; lineas: Array<{ productoId: string; cantidad: number; precioUnitario: number }>; pagos: Array<{ formaPago: string; monto: number }> } {
  const lineas = Array.from({ length: n }, (_, i) => {
    const prod = productosVenta[(desplazamiento * 31 + i * 7) % productosVenta.length] as (typeof productosVenta)[number];
    return { prod, linea: { productoId: prod.id, cantidad: 1 + (i % 3), precioUnitario: prod.precioVenta } };
  });
  const total = lineas.reduce((a, { prod, linea }) => a + Math.round(linea.cantidad * linea.precioUnitario * 100) / 100 * (prod.aplicaIva ? 1.15 : 1), 0);
  return { puntoEmisionId, lineas: lineas.map((x) => x.linea), pagos: [{ formaPago: "EFECTIVO", monto: Math.ceil(total * 100) / 100 + 1 }] };
}

beforeAll(async () => {
  p = parametros();
  dir = path.join(CARPETA, "trabajo");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  dbPath = path.join(dir, "vendeya.db");
  const copia = await obtenerCopiaDeTrabajo(p, dbPath);
  resumen = copia.resumen;
  salida(`\n[rendimiento] base de trabajo: ${tamanoMB(dbPath)} MB · ${resumen.productos} productos · ${resumen.clientes} clientes · ${resumen.ventas} ventas · ${resumen.lineas} líneas · ${resumen.comprobantes} comprobantes\n`);

  const rssAntes = process.memoryUsage().rss;
  const arrancar = (): Promise<BackendHandle> =>
    iniciarBackend({
      dbPath,
      migrationsDir: path.resolve(__dirname, "../../prisma/migrations"),
      backupsDir: path.join(dir, "backups"),
      port: 0,
      logLevel: "silent",
      // El worker del SRI corre durante todas las mediciones (sin certificado: los pendientes fallan al firmar y se reintentan, como en una caja sin certificado)
      sriWorker: { habilitado: true, intervaloMs: 2_000 },
    });
  // 1) La base generada con una versión anterior del esquema: el primer arranque aplica las migraciones pendientes (con respaldo previo)
  let t0 = performance.now();
  b = await arrancar();
  const conMigracion = b.migraciones.aplicadas.length;
  anotar("primer arranque aplicando migraciones pendientes", [performance.now() - t0]);
  extras["migracionesAplicadasEnElPrimerArranque"] = conMigracion;
  await b.close();
  // 2) El arranque de todos los días, ya sin migraciones
  t0 = performance.now();
  b = await arrancar();
  anotar("arranque del backend (base grande)", [performance.now() - t0]);
  extras["rssArranqueMB"] = Math.round((process.memoryUsage().rss - rssAntes) / 1_048_576);

  await login("admin", PASSWORD_ADMIN);
  sucursalId = (await b.prisma.sucursal.findFirstOrThrow()).id;
  puntos = resumen.puntosEmision;
  // La sincronización entre cajas publica un evento por cada venta: se mide con ella activa
  await b.prisma.configuracionGiro.updateMany({ data: { sincronizacionLAN: true } });
  b.servicios.sync.olvidarConfiguracion();
  productosVenta = (await b.prisma.producto.findMany({ where: { requiereLote: false }, select: { id: true, precioVenta: true, aplicaIva: true }, take: 600, orderBy: { codigo: "asc" } }));
}, 3_600_000);

afterAll(async () => {
  extras["equipo"] = { cpu: os.cpus()[0]?.model, nucleos: os.cpus().length, memoriaGB: Math.round(os.totalmem() / 1_073_741_824), node: process.version, so: `${os.platform()} ${os.release()}` };
  extras["parametros"] = p;
  extras["resumenBase"] = resumen;
  extras["tamanoBaseMB"] = dbPath === "" ? null : tamanoMB(dbPath);
  mkdirSync(CARPETA, { recursive: true });
  writeFileSync(path.join(CARPETA, "resultados.json"), JSON.stringify({ fecha: new Date().toISOString(), factor: FACTOR, mediciones, ...extras }, null, 2));
  salida(`\n[rendimiento] resultados en ${path.join(CARPETA, "resultados.json")}`);
  await b?.close().catch(() => undefined);
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}, 120_000);

describe("Búsqueda de productos con 20 000+ productos", () => {
  it("por nombre, por código, por código de barras y de varias palabras", async () => {
    salida("\n[rendimiento] Búsquedas");
    const nombres = ["arroz", "aceite", "leche", "café", "galletas", "jabón", "queso", "agua"];
    const m1 = await medir("búsqueda de productos por nombre", 60, async (i) => {
      const r = await api("GET", `/api/productos?search=${encodeURIComponent(nombres[Math.abs(i) % nombres.length] as string)}&pageSize=24`, "admin");
      expect(r.statusCode).toBe(200);
      expect((r.json() as { items: unknown[] }).items.length).toBeGreaterThan(0);
    });
    const m2 = await medir("búsqueda de productos por código", 60, async (i) => {
      const r = await api("GET", `/api/productos?search=P${String(1 + ((Math.abs(i) * 331) % p.productos)).padStart(6, "0")}&pageSize=24`, "admin");
      expect(r.statusCode).toBe(200);
      expect((r.json() as { items: unknown[] }).items.length).toBeGreaterThan(0);
    });
    const m3 = await medir("búsqueda por código de barras", 60, async (i) => {
      const r = await api("GET", `/api/productos/barcode/786${String(1 + ((Math.abs(i) * 577) % p.productos)).padStart(10, "0")}`, "admin");
      expect(r.statusCode).toBe(200);
    });
    const m4 = await medir("búsqueda de varias palabras", 60, async (i) => {
      const r = await api("GET", `/api/productos?search=${encodeURIComponent(`${nombres[Math.abs(i) % nombres.length]} la favorita 1kg`)}&pageSize=24`, "admin");
      expect(r.statusCode).toBe(200);
    });
    for (const m of [m1, m2, m3, m4]) dentroDePresupuesto(m);
  });
});

describe("Ventas y anulaciones", () => {
  const ventasHechas: string[] = [];

  it("venta de 1 línea y de 20 líneas con la base grande", async () => {
    salida("\n[rendimiento] Ventas");
    await login("cajero1", PASSWORD_CAJEROS);
    expect((await api("POST", "/api/turnos/abrir", "cajero1", { sucursalId, montoApertura: 100 })).statusCode).toBe(201);
    const punto = puntos[0] as string;
    const una = await medir("venta de 1 línea", 80, async (i) => {
      const r = await api("POST", "/api/ventas", "cajero1", ventaDe(1, punto, Math.abs(i) + 1));
      expect(r.statusCode, r.body).toBe(201);
      if (i >= 0) ventasHechas.push((r.json() as { id: string }).id);
    });
    const veinte = await medir("venta de 20 líneas", 40, async (i) => {
      const r = await api("POST", "/api/ventas", "cajero1", ventaDe(20, punto, Math.abs(i) + 500));
      expect(r.statusCode, r.body).toBe(201);
      if (i >= 0) ventasHechas.push((r.json() as { id: string }).id);
    });
    dentroDePresupuesto(una);
    dentroDePresupuesto(veinte);
  });

  it("anulación de ventas", async () => {
    const m = await medir("anulación de venta", 40, async (i) => {
      const id = ventasHechas[Math.max(0, i) + 2] as string;
      const r = await api("POST", `/api/ventas/${id}/anular`, "admin", { motivo: "Anulación de prueba de rendimiento" });
      expect(r.statusCode, r.body).toBe(200);
    }, 0);
    dentroDePresupuesto(m);
  });
});

describe("Cierre de turno con miles de ventas", () => {
  it("el reporte y el cierre de un turno con 3 000+ ventas", async () => {
    salida("\n[rendimiento] Turno con miles de ventas");
    await login(resumen.cajeroTurnoAbierto, PASSWORD_CAJEROS);
    const actual = await api("GET", "/api/turnos/actual", resumen.cajeroTurnoAbierto);
    expect(actual.statusCode).toBe(200);
    const turnoId = (actual.json() as { id: string }).id;
    const ventasTurno = await b.prisma.venta.count({ where: { turnoId } });
    extras["ventasDelTurnoCerrado"] = ventasTurno;
    expect(ventasTurno).toBeGreaterThanOrEqual(p.ventasTurnoAbierto);

    const reporte = await medir("reporte de turno con miles de ventas", 5, async () => {
      const r = await api("GET", `/api/turnos/${turnoId}/reporte`, resumen.cajeroTurnoAbierto);
      expect(r.statusCode).toBe(200);
    }, 1);
    const t0 = performance.now();
    const cierre = await api("POST", `/api/turnos/${turnoId}/cerrar`, resumen.cajeroTurnoAbierto, { efectivoContado: 100 });
    expect(cierre.statusCode, cierre.body).toBe(200);
    const mc = anotar("cierre de turno con miles de ventas", [performance.now() - t0]);
    dentroDePresupuesto(reporte);
    dentroDePresupuesto(mc);
  });
});

describe("Reportes y listados con 135 000+ ventas", () => {
  it("reportes de ventas, utilidad, stock y cartera", async () => {
    salida("\n[rendimiento] Reportes");
    const caso = async (nombre: string, url: string, n = 4): Promise<Medicion> => {
      const m = await medir(nombre, n, async () => {
        const r = await api("GET", url, "admin");
        expect(r.statusCode, `${nombre}: ${r.body.slice(0, 200)}`).toBe(200);
      }, 1);
      dentroDePresupuesto(m);
      return m;
    };
    await caso("reporte de ventas por día (90 días)", "/api/reportes/ventas?agrupar=dia");
    await caso("reporte de ventas por producto", "/api/reportes/ventas?agrupar=producto");
    const fin = new Date(Date.now() - 5 * 3_600_000).toISOString().slice(0, 10);
    const ini = new Date(Date.now() - 5 * 3_600_000 - 30 * 86_400_000).toISOString().slice(0, 10);
    await caso("reporte de ventas por producto (30 días)", `/api/reportes/ventas?agrupar=producto&desde=${ini}&hasta=${fin}`);
    await caso("reporte de utilidad", "/api/reportes/utilidad");
    await caso("reporte de stock valorado (20 000 productos)", "/api/reportes/stock");
    await caso("reporte de cartera", "/api/reportes/cartera");
    await caso("CSV de ventas por producto", "/api/reportes/ventas?agrupar=producto&formato=csv", 2);
    await caso("CSV de stock valorado", "/api/reportes/stock?formato=csv", 2);
  });

  it("listado de comprobantes, cola del SRI y ATS del mes", async () => {
    const caso = async (nombre: string, url: string, n: number): Promise<void> => {
      const m = await medir(nombre, n, async () => {
        const r = await api("GET", url, "admin");
        expect(r.statusCode, `${nombre}: ${r.body.slice(0, 200)}`).toBe(200);
      }, n > 5 ? 2 : 0);
      dentroDePresupuesto(m);
    };
    await caso("listado de comprobantes pendientes", "/api/comprobantes?estado=PENDIENTE&page=1&pageSize=20", 30);
    await caso("listado de comprobantes autorizados", "/api/comprobantes?estado=AUTORIZADO&page=1&pageSize=20", 30);
    await caso("estado de la cola del SRI", "/api/sri/cola", 30);
    const ahora = new Date();
    await caso("ATS del mes", `/api/reportes/ats?anio=${ahora.getUTCFullYear()}&mes=${ahora.getUTCMonth() + 1}&formato=json`, 2);
  });
});

describe("Respaldo de la base de datos", () => {
  it("respalda (VACUUM INTO) y verifica una base de cientos de MB", async () => {
    salida("\n[rendimiento] Respaldo");
    const t0 = performance.now();
    const ruta = await b.respaldos.crear("pre-actualizacion", "rendimiento");
    const m = anotar("respaldo de la base de datos", [performance.now() - t0]);
    extras["respaldoMB"] = Math.round(statSync(ruta).size / 1_048_576);
    dentroDePresupuesto(m);
  });
});

describe("8 cajas vendiendo a la vez", () => {
  it("sin pérdidas, duplicados ni sobreventa, y con latencias acotadas (HTTP real, sincronización LAN y worker del SRI activos)", async () => {
    salida("\n[rendimiento] Concurrencia (8 cajas × 100 ventas, HTTP real) + 2 clientes leyendo");
    const CAJAS = 8;
    const VENTAS = 100;
    const usuarios = Array.from({ length: CAJAS }, (_, i) => `conc${i + 1}`);
    for (const u of usuarios) {
      await b.servicios.usuarios.crear({ empresaId: (await b.prisma.empresa.findFirstOrThrow()).id, rol: "CAJERO", username: u, password: PASSWORD_CAJEROS, nombre: u, apellido: "Concurrencia" });
      await login(u, PASSWORD_CAJEROS);
      expect((await api("POST", "/api/turnos/abrir", u, { sucursalId, montoApertura: 50 })).statusCode).toBe(201);
    }
    // Productos «calientes»: todas las cajas venden los mismos 10 → cualquier actualización perdida de stock se nota
    const calientes = productosVenta.slice(0, 10);
    const stockAntes = new Map((await b.prisma.producto.findMany({ where: { id: { in: calientes.map((c) => c.id) } }, select: { id: true, stockActual: true } })).map((x) => [x.id, x.stockActual]));
    const secuenciaAntes = new Map((await b.prisma.puntoEmision.findMany({ where: { id: { in: puntos } }, select: { id: true, secuencialVenta: true } })).map((x) => [x.id, x.secuencialVenta]));
    const ventasAntes = await b.prisma.venta.count();
    const kardexAntes = await b.prisma.kardex.count();
    const url = b.url;

    const post = async (quien: string, cuerpo: unknown): Promise<{ status: number; ms: number; cuerpo: { id?: string; numero?: string } }> => {
      const t0 = performance.now();
      const r = await fetch(`${url}/api/ventas`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tokens[quien]}` }, body: JSON.stringify(cuerpo) });
      const j = (await r.json()) as { id?: string; numero?: string };
      return { status: r.status, ms: performance.now() - t0, cuerpo: j };
    };
    const rssAntes = process.memoryUsage().rss;
    const t0 = performance.now();
    let leyendo = true;
    const lecturas: number[] = [];
    const lector = async (k: number): Promise<void> => {
      let i = 0;
      while (leyendo) {
        const t = performance.now();
        const r = await fetch(`${url}/api/productos?search=${["arroz", "leche", "aceite", "café"][(i + k) % 4]}&pageSize=24`, { headers: { authorization: `Bearer ${tokens["admin"]}` } });
        expect(r.status).toBe(200);
        await r.arrayBuffer();
        lecturas.push(performance.now() - t);
        i++;
      }
    };
    const lectores = [lector(0), lector(1)];
    const resultados = await Promise.all(
      usuarios.map(async (u, c) => {
        const out: Array<{ status: number; ms: number; cuerpo: { id?: string; numero?: string } }> = [];
        // Las cajas 1–4 comparten el punto de emisión: contienda por el mismo secuencial
        const punto = puntos[c < 4 ? 0 : c - 3] as string;
        for (let i = 0; i < VENTAS; i++) {
          const lineas = calientes.slice(0, 3).map((pr, j) => ({ productoId: pr.id, cantidad: 1 + ((i + j) % 3), precioUnitario: pr.precioVenta }));
          const total = lineas.reduce((a, l, j) => a + Math.round(l.cantidad * l.precioUnitario * 100) / 100 * ((calientes[j] as (typeof calientes)[number]).aplicaIva ? 1.15 : 1), 0);
          out.push(await post(u, { puntoEmisionId: punto, lineas, pagos: [{ formaPago: "EFECTIVO", monto: Math.ceil(total * 100) / 100 + 1 }] }));
        }
        return { u, punto, out };
      })
    );
    const segundos = (performance.now() - t0) / 1000;
    leyendo = false;
    await Promise.all(lectores);

    const todas = resultados.flatMap((r) => r.out);
    const fallos = todas.filter((x) => x.status !== 201);
    expect(fallos.map((f) => f.status), "toda venta debe responder 201 (ni SQLITE_BUSY ni 5xx)").toEqual([]);
    const mv = anotar("venta con 8 cajas simultáneas", todas.map((x) => x.ms));
    const ml = anotar("búsqueda mientras 8 cajas venden", lecturas);
    extras["concurrencia"] = { cajas: CAJAS, ventas: todas.length, segundos: redondear(segundos), ventasPorSegundo: redondear(todas.length / segundos), lecturasDuranteLaCarga: lecturas.length };
    salida(`  → ${todas.length} ventas en ${redondear(segundos)} s = ${redondear(todas.length / segundos)} ventas/s con ${CAJAS} cajas; ${lecturas.length} búsquedas atendidas durante la carga`);

    // Invariantes
    expect(await b.prisma.venta.count()).toBe(ventasAntes + todas.length);
    const numeros = todas.map((x) => x.cuerpo.numero as string);
    expect(new Set(numeros).size, "números de venta duplicados").toBe(numeros.length);
    for (const id of new Set(resultados.map((r) => r.punto))) {
      const propios = resultados.filter((r) => r.punto === id).flatMap((r) => r.out.map((o) => Number((o.cuerpo.numero as string).slice(-9)))).sort((a, c) => a - c);
      const desde = (secuenciaAntes.get(id) as number) + 1;
      expect(propios, `secuenciales del punto ${id} sin huecos ni repetidos`).toEqual(Array.from({ length: propios.length }, (_, k) => desde + k));
      expect((await b.prisma.puntoEmision.findUniqueOrThrow({ where: { id } })).secuencialVenta).toBe(desde + propios.length - 1);
    }
    const vendidoPorProducto = new Map<string, number>();
    for (let c = 0; c < CAJAS; c++) for (let i = 0; i < VENTAS; i++) calientes.slice(0, 3).forEach((pr, j) => vendidoPorProducto.set(pr.id, (vendidoPorProducto.get(pr.id) ?? 0) + 1 + ((i + j) % 3)));
    for (const [id, vendido] of vendidoPorProducto) {
      expect((await b.prisma.producto.findUniqueOrThrow({ where: { id } })).stockActual, `stock del producto ${id}: no se debe perder ninguna actualización`).toBe((stockAntes.get(id) as number) - vendido);
    }
    expect(await b.prisma.kardex.count()).toBe(kardexAntes + todas.length * 3);

    extras["memoria"] = { rssAntesMB: Math.round(rssAntes / 1_048_576), rssDespuesMB: Math.round(process.memoryUsage().rss / 1_048_576), heapUsadoMB: Math.round(process.memoryUsage().heapUsed / 1_048_576) };
    dentroDePresupuesto(mv);
    dentroDePresupuesto(ml);
  }, 1_800_000);
});

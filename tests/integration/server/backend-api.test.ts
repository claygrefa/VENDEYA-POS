// ============================================================
// tests/integration/server/backend-api.test.ts
// Arranque completo del backend (BD temporal) + API HTTP vía inject y fetch real.
// ============================================================
import { mkdtempSync, rmSync } from "fs";
import net from "net";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runSeed, type SeedResult } from "../../../prisma/seed";
import { iniciarBackend, type BackendHandle } from "../../../src/server";

const MIGRACIONES = path.resolve(__dirname, "../../../prisma/migrations");

let dir: string;
let backend: BackendHandle;
let seed: SeedResult;
let tokenAdmin: string;
let tokenContador: string;

async function login(username: string, password: string): Promise<string> {
  const r = await backend.server.inject({ method: "POST", url: "/api/auth/login", payload: { username, password } });
  expect(r.statusCode).toBe(200);
  return (r.json() as { token: string }).token;
}

const get = (url: string, token?: string) =>
  backend.server.inject({ method: "GET", url, ...(token !== undefined ? { headers: { authorization: `Bearer ${token}` } } : {}) });

beforeAll(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), "vendeya-api-"));
  backend = await iniciarBackend({
    dbPath: path.join(dir, "data", "vendeya.db"),
    migrationsDir: MIGRACIONES,
    port: 0,
    logLevel: "silent",
  });
  seed = await runSeed(backend.prisma, { adminPassword: "ClaveDePrueba1" });

  const categoria = await backend.prisma.categoria.findFirstOrThrow({ where: { nombre: "General" } });
  const unidad = await backend.prisma.unidadMedida.findUniqueOrThrow({ where: { codigo: "UN" } });
  await backend.servicios.productos.crear({
    codigo: "P001", codigoBarras: "7861000000011", nombre: "Arroz 1kg", tipo: "BIEN",
    categoriaId: categoria.id, unidadMedidaId: unidad.id, precioCompra: 0.8, precioVenta: 1,
  });
  await backend.servicios.usuarios.crear({
    empresaId: seed.empresaId, rol: "CONTADOR", username: "conta", password: "Contador123", nombre: "C", apellido: "D",
  });
  tokenAdmin = await login("admin", "ClaveDePrueba1");
  tokenContador = await login("conta", "Contador123");
}, 60_000);

afterAll(async () => {
  await backend.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("iniciarBackend", () => {
  it("migra, activa WAL y escucha en loopback con un puerto válido", async () => {
    expect(backend.migraciones.aplicadas.length).toBeGreaterThan(0);
    expect(backend.host).toBe("127.0.0.1");
    expect(backend.port).toBeGreaterThan(0);
    const modo = await backend.prisma.$queryRawUnsafe<Array<{ journal_mode: string }>>("PRAGMA journal_mode");
    expect(modo[0]?.journal_mode).toBe("wal");
    const sincronizacion = await backend.prisma.$queryRaw<Array<{ synchronous: bigint }>>`PRAGMA synchronous`;
    expect(Number(sincronizacion[0]?.synchronous)).toBe(2); // SQLite FULL
  });

  it("responde por HTTP real (fetch) en la URL publicada", async () => {
    const r = await fetch(`${backend.url}/api/health`);
    expect(r.status).toBe(200);
    expect(((await r.json()) as { db: string }).db).toBe("ok");
  });

  it("usa un puerto libre cuando el preferido está ocupado", async () => {
    const ocupante = net.createServer();
    await new Promise<void>((ok) => ocupante.listen(0, "127.0.0.1", ok));
    const puertoOcupado = (ocupante.address() as net.AddressInfo).port;
    const d2 = mkdtempSync(path.join(os.tmpdir(), "vendeya-api2-"));
    const otro = await iniciarBackend({
      dbPath: path.join(d2, "v.db"), migrationsDir: MIGRACIONES, port: puertoOcupado, logLevel: "silent",
    });
    try {
      expect(otro.port).not.toBe(puertoOcupado);
      expect((await fetch(`${otro.url}/api/health`)).status).toBe(200);
    } finally {
      await otro.close();
      await new Promise<void>((ok) => ocupante.close(() => ok()));
      rmSync(d2, { recursive: true, force: true });
    }
  }, 60_000);

  it("libera recursos y propaga el error si las migraciones no existen", async () => {
    const d3 = mkdtempSync(path.join(os.tmpdir(), "vendeya-api3-"));
    try {
      await expect(
        iniciarBackend({ dbPath: path.join(d3, "v.db"), migrationsDir: path.join(d3, "nada"), port: 0, logLevel: "silent" })
      ).rejects.toThrow(/carpeta de migraciones/);
    } finally {
      rmSync(d3, { recursive: true, force: true });
    }
  });
});

describe("API /api", () => {
  it("GET /health es público", async () => {
    const r = await get("/api/health");
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ status: "ok", db: "ok" });
  });

  it("login correcto devuelve token y usuario con permisos", async () => {
    const r = await backend.server.inject({ method: "POST", url: "/api/auth/login", payload: { username: "admin", password: "ClaveDePrueba1" } });
    const cuerpo = r.json() as { token: string; usuario: { rol: string; permisos: string[] } };
    expect(cuerpo.usuario.rol).toBe("ADMIN");
    expect(cuerpo.usuario.permisos).toContain("inventario:leer");
    expect(cuerpo.usuario).not.toHaveProperty("passwordHash");
  });

  it("login incorrecto → 401; cuerpo inválido o ausente → 400", async () => {
    const mal = await backend.server.inject({ method: "POST", url: "/api/auth/login", payload: { username: "admin", password: "x" } });
    expect(mal.statusCode).toBe(401);
    expect(mal.json()).toMatchObject({ error: "CREDENCIALES_INVALIDAS" });
    const vacio = await backend.server.inject({ method: "POST", url: "/api/auth/login", payload: {} });
    expect(vacio.statusCode).toBe(400);
    const sinCuerpo = await backend.server.inject({ method: "POST", url: "/api/auth/login" });
    expect(sinCuerpo.statusCode).toBe(400);
  });

  it("JSON malformado → 400 (no 500)", async () => {
    const r = await backend.server.inject({
      method: "POST", url: "/api/auth/login", payload: "{no-json", headers: { "content-type": "application/json" },
    });
    expect(r.statusCode).toBe(400);
  });

  it("rutas protegidas sin token o con token falso → 401", async () => {
    expect((await get("/api/productos")).statusCode).toBe(401);
    expect((await get("/api/productos", "falso")).statusCode).toBe(401);
    expect((await get("/api/auth/me")).statusCode).toBe(401);
  });

  it("/auth/me devuelve el usuario y logout revoca el token", async () => {
    const t = await login("admin", "ClaveDePrueba1");
    expect(((await get("/api/auth/me", t)).json() as { usuario: { username: string } }).usuario.username).toBe("admin");
    const out = await backend.server.inject({ method: "POST", url: "/api/auth/logout", headers: { authorization: `Bearer ${t}` } });
    expect(out.statusCode).toBe(204);
    expect((await get("/api/auth/me", t)).statusCode).toBe(401);
  });

  it("RBAC: CONTADOR no tiene clientes:leer ni inventario:leer → 403", async () => {
    const r = await get("/api/clientes", tokenContador);
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ error: "SIN_PERMISO" });
    expect((await get("/api/productos", tokenContador)).statusCode).toBe(403);
  });

  it("productos: búsqueda paginada, por código de barras, por id y 404", async () => {
    const lista = (await get("/api/productos?search=arroz&page=1&pageSize=5", tokenAdmin)).json() as {
      total: number; items: Array<{ id: string; codigo: string }>;
    };
    expect(lista.total).toBe(1);
    expect(lista.items[0]?.codigo).toBe("P001");

    expect(((await get("/api/productos/barcode/7861000000011", tokenAdmin)).json() as { codigo: string }).codigo).toBe("P001");
    expect((await get(`/api/productos/${lista.items[0]?.id}`, tokenAdmin)).statusCode).toBe(200);
    const noExiste = await get("/api/productos/barcode/000", tokenAdmin);
    expect(noExiste.statusCode).toBe(404);
    expect(noExiste.json()).toMatchObject({ error: "NO_ENCONTRADO" });
  });

  it("productos: parámetros de paginación inválidos → 400", async () => {
    expect((await get("/api/productos?pageSize=9999", tokenAdmin)).statusCode).toBe(400);
  });

  it("clientes: búsqueda y consumidor final", async () => {
    const cf = (await get("/api/clientes/consumidor-final", tokenAdmin)).json() as { identificacion: string };
    expect(cf.identificacion).toBe("9999999999999");
    const lista = (await get("/api/clientes?search=CONSUMIDOR", tokenAdmin)).json() as { total: number };
    expect(lista.total).toBe(1);
    expect((await get("/api/clientes/no-existe", tokenAdmin)).statusCode).toBe(404);
  });

  it("ruta inexistente → 404 con formato propio", async () => {
    const r = await get("/api/nada");
    expect(r.statusCode).toBe(404);
    expect(r.json()).toMatchObject({ error: "NO_ENCONTRADO" });
  });
});

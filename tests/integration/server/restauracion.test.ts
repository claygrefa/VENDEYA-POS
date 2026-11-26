// ============================================================
// tests/integration/server/restauracion.test.ts — Restaurar la base desde un respaldo local o una copia cifrada (Semana 23)
//   preparar (con la contraseña del administrador) → se aplica al reabrir la aplicación; la base anterior se conserva
// ============================================================
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runSeed } from "../../../prisma/seed";
import { iniciarBackend, type BackendHandle } from "../../../src/server";
import { crearPrismaPara } from "../../../src/server/config/database.config";
import { PASSWORD_ADMIN } from "../helpers/entorno.helper";

const MIGRACIONES = path.resolve(__dirname, "../../../prisma/migrations");
const FRASE = "frase-secreta-del-negocio";

let raiz = "";
let dbPath = "";
let nube = "";
let b: BackendHandle;
let token = "";

const abrir = (): Promise<BackendHandle> => iniciarBackend({ dbPath, migrationsDir: MIGRACIONES, port: 0, logLevel: "silent" });
const marca = async (): Promise<string> => (await b.prisma.empresa.findFirstOrThrow()).nombreComercial ?? "";
const poner = async (valor: string): Promise<void> => void (await b.prisma.empresa.updateMany({ data: { nombreComercial: valor } }));
const api = (metodo: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: unknown) =>
  b.server.inject({ method: metodo, url, headers: { authorization: `Bearer ${token}` }, ...(payload !== undefined ? { payload: payload as object } : {}) });
const login = async (): Promise<void> => {
  token = ((await b.server.inject({ method: "POST", url: "/api/auth/login", payload: { username: "admin", password: PASSWORD_ADMIN } })).json() as { token: string }).token;
};
const reabrir = async (): Promise<void> => {
  await b.close();
  b = await abrir();
  await login();
};
const anteriores = (): string[] => readdirSync(path.dirname(dbPath)).filter((f) => f.includes(".antes-de-restaurar-") && !f.endsWith("-wal") && !f.endsWith("-shm"));

beforeAll(async () => {
  raiz = mkdtempSync(path.join(os.tmpdir(), "vendeya-rest-"));
  dbPath = path.join(raiz, "data", "vendeya.db");
  nube = path.join(raiz, "nube");
  mkdirSync(nube, { recursive: true });
  b = await abrir();
  await runSeed(b.prisma, { adminPassword: PASSWORD_ADMIN });
  await login();
}, 60_000);

afterAll(async () => {
  await b.close();
  try {
    rmSync(raiz, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch {
    /* Windows puede retener un instante la base recién cerrada */
  }
});

describe("Restaurar un respaldo local", () => {
  let respaldo = "";

  it("prepara sin tocar la base: pide la contraseña y solo acepta respaldos de la lista", async () => {
    await poner("VERSION-ANTES");
    respaldo = ((await api("POST", "/api/respaldos")).json() as { archivo: string }).archivo;
    expect(respaldo).toMatch(/^vendeya-manual-.*\.db$/);
    await poner("VERSION-DESPUES");

    expect((await api("POST", "/api/respaldos/restaurar", { origen: "local", archivo: respaldo })).statusCode).toBe(400); // sin contraseña
    expect((await api("POST", "/api/respaldos/restaurar", { origen: "local", archivo: respaldo, password: "incorrecta" })).statusCode).toBe(400); // no 401: la interfaz cerraría la sesión
    expect((await api("POST", "/api/respaldos/restaurar", { origen: "local", archivo: "no-existe.db", password: PASSWORD_ADMIN })).statusCode).toBe(404);
    for (const intento of ["../../../Windows/system.ini", "..\\..\\vendeya.db", path.join(path.dirname(dbPath), "vendeya.db"), "vendeya-manual-/../../x.db"]) {
      expect((await api("POST", "/api/respaldos/restaurar", { origen: "local", archivo: intento, password: PASSWORD_ADMIN })).statusCode, intento).toBe(404);
    }
    expect(((await api("GET", "/api/respaldos")).json() as { restauracionPendiente: unknown }).restauracionPendiente).toBeNull();
    expect(await marca()).toBe("VERSION-DESPUES");
  });

  it("cancelar descarta lo preparado", async () => {
    const r = await api("POST", "/api/respaldos/restaurar", { origen: "local", archivo: respaldo, password: PASSWORD_ADMIN });
    expect(r.statusCode).toBe(202);
    expect((r.json() as { pendiente: { archivo: string } }).pendiente.archivo).toBe(respaldo);
    expect(existsSync(path.join(path.dirname(dbPath), "restauracion-pendiente.db"))).toBe(true);
    expect(await marca()).toBe("VERSION-DESPUES"); // la base en uso no cambió
    const c = await api("DELETE", "/api/respaldos/restaurar");
    expect((c.json() as { restauracionPendiente: unknown }).restauracionPendiente).toBeNull();
    expect(existsSync(path.join(path.dirname(dbPath), "restauracion-pendiente.db"))).toBe(false);
  });

  it("al reabrir la aplicación se aplica; la base anterior se conserva aparte y el estado se limpia", async () => {
    expect((await api("POST", "/api/respaldos/restaurar", { origen: "local", archivo: respaldo, password: PASSWORD_ADMIN })).statusCode).toBe(202);
    await reabrir();
    expect(await marca()).toBe("VERSION-ANTES");
    const guardadas = anteriores();
    expect(guardadas).toHaveLength(1);
    expect(((await api("GET", "/api/respaldos")).json() as { restauracionPendiente: unknown }).restauracionPendiente).toBeNull();
    expect(existsSync(path.join(path.dirname(dbPath), "restauracion-pendiente.db"))).toBe(false);
    // La base conservada contiene lo que había justo antes de restaurar
    const copia = path.join(path.dirname(dbPath), guardadas[0] as string);
    const db = crearPrismaPara(copia);
    try {
      expect((await db.empresa.findFirstOrThrow()).nombreComercial).toBe("VERSION-DESPUES");
    } finally {
      await db.$disconnect();
    }
  }, 60_000);

  it("la restauración la hace solo el administrador", async () => {
    await b.servicios.usuarios.crear({ empresaId: (await b.prisma.empresa.findFirstOrThrow()).id, rol: "CAJERO", username: "cajera.rest", password: "Clave12345", nombre: "C", apellido: "R" });
    const t = ((await b.server.inject({ method: "POST", url: "/api/auth/login", payload: { username: "cajera.rest", password: "Clave12345" } })).json() as { token: string }).token;
    const r = await b.server.inject({ method: "POST", url: "/api/respaldos/restaurar", headers: { authorization: `Bearer ${t}` }, payload: { origen: "local", archivo: respaldo, password: "Clave12345" } });
    expect(r.statusCode).toBe(403);
  });
});

describe("Restaurar una copia cifrada de la nube", () => {
  let copia = "";

  it("exporta una copia, y con la frase equivocada no se prepara nada", async () => {
    await poner("NUBE-ANTES");
    expect((await api("PUT", "/api/respaldos/nube", { carpeta: nube, frase: FRASE })).statusCode).toBe(200);
    expect((await api("POST", "/api/respaldos/nube/exportar")).statusCode).toBe(201);
    const estado = (await api("GET", "/api/respaldos")).json() as { nube: { copias: string[] } };
    expect(estado.nube.copias).toHaveLength(1);
    copia = estado.nube.copias[0] as string;
    await poner("NUBE-DESPUES");

    const mala = await api("POST", "/api/respaldos/restaurar", { origen: "nube", archivo: copia, frase: "otra-frase-equivocada", password: PASSWORD_ADMIN });
    expect(mala.statusCode).toBe(409);
    expect(existsSync(path.join(path.dirname(dbPath), "restauracion-pendiente.db"))).toBe(false);
    expect(readdirSync(path.dirname(dbPath)).some((f) => f.includes("preparando"))).toBe(false);
    const fuera = await api("POST", "/api/respaldos/restaurar", { origen: "nube", archivo: "../vendeya.db", frase: FRASE, password: PASSWORD_ADMIN });
    expect(fuera.statusCode).toBe(404);
  });

  it("con la frase correcta se prepara y se aplica al reabrir", async () => {
    expect((await api("POST", "/api/respaldos/restaurar", { origen: "nube", archivo: copia, frase: FRASE, password: PASSWORD_ADMIN })).statusCode).toBe(202);
    await reabrir();
    expect(await marca()).toBe("NUBE-ANTES");
    expect(anteriores().length).toBeGreaterThanOrEqual(2);
  }, 60_000);
});

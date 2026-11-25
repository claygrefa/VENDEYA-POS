// ============================================================
// tests/integration/server/estadisticas.test.ts — Estadísticas del planificador de SQLite en bases grandes
// ============================================================
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { iniciarBackend, type BackendHandle } from "../../../src/server";
import { asegurarEstadisticas, PAGINAS_MINIMAS_PARA_ANALIZAR } from "../../../src/server/config/estadisticas.util";

let dir = "";
let b: BackendHandle;

const filasStat = async (): Promise<number> => {
  const t = await b.prisma.$queryRawUnsafe<Array<{ n: bigint }>>("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'sqlite_stat1'");
  if (Number(t[0]?.n) === 0) return 0;
  return Number((await b.prisma.$queryRawUnsafe<Array<{ n: bigint }>>("SELECT COUNT(*) AS n FROM sqlite_stat1"))[0]?.n);
};

beforeAll(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), "vendeya-stat-"));
  b = await iniciarBackend({ dbPath: path.join(dir, "data", "vendeya.db"), migrationsDir: path.resolve(__dirname, "../../../prisma/migrations"), port: 0, logLevel: "silent" });
}, 60_000);

afterAll(async () => {
  await b.close();
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch {
    /* Windows puede retener la base un instante */
  }
});

describe("Estadísticas del planificador", () => {
  it("una base pequeña no se analiza (el plan no importa y se ahorra el arranque)", async () => {
    expect(PAGINAS_MINIMAS_PARA_ANALIZAR).toBeGreaterThan(500);
    expect(await asegurarEstadisticas(b.prisma)).toBe(false);
    expect(await filasStat()).toBe(0);
  });

  it("una base grande sin estadísticas se analiza UNA vez; las siguientes no repiten el trabajo", async () => {
    expect(await asegurarEstadisticas(b.prisma, 1)).toBe(true);
    expect(await filasStat()).toBeGreaterThan(0);
    expect(await asegurarEstadisticas(b.prisma, 1)).toBe(false);
  });
});

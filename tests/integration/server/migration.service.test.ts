// ============================================================
// tests/integration/server/migration.service.test.ts
// Migraciones automáticas + respaldo previo sobre BD temporal.
// ============================================================
import { execSync } from "child_process";
import { createHash } from "crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, cpSync } from "fs";
import os from "os";
import path from "path";
import type { PrismaClient } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { crearPrismaPara, sqliteUrl } from "../../../src/server/config/database.config";
import { MigrationService } from "../../../src/server/services/migration.service";

const RAIZ = path.resolve(__dirname, "../../..");
const MIGRACIONES_REALES = path.join(RAIZ, "prisma", "migrations");

let dir: string;
let dbPath: string;
let backupsDir: string;
let prisma: PrismaClient;

function servicio(migrationsDir = MIGRACIONES_REALES, maxRespaldos?: number): MigrationService {
  return new MigrationService(prisma, {
    migrationsDir, backupsDir, dbPath, ...(maxRespaldos !== undefined ? { maxRespaldos } : {}),
  });
}

/** Copia las migraciones reales y agrega una migración extra para simular una actualización. */
function migracionesConExtra(): string {
  const copia = path.join(dir, "migraciones-extra");
  cpSync(MIGRACIONES_REALES, copia, { recursive: true });
  const extra = path.join(copia, "29991231000000_agrega_nota");
  mkdirSync(extra);
  writeFileSync(extra + "/migration.sql", '-- AlterTable\nALTER TABLE "Categoria" ADD COLUMN "nota" TEXT;\n');
  return copia;
}

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "vendeya-mig-"));
  dbPath = path.join(dir, "datos", "vendeya.db");
  mkdirSync(path.dirname(dbPath), { recursive: true });
  backupsDir = path.join(dir, "backups");
  prisma = crearPrismaPara(dbPath);
});

afterEach(async () => {
  await prisma.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

describe("MigrationService", () => {
  it("en una BD nueva aplica todas las migraciones sin generar respaldo", async () => {
    const r = await servicio().migrar();
    expect(r.aplicadas.length).toBeGreaterThanOrEqual(1);
    expect(r.respaldo).toBeNull();
    const tablas = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('Empresa','Venta','ColaSRI','ItemComanda')`
    );
    expect(tablas).toHaveLength(4);
  });

  it("registra checksum SHA-256 idéntico al de Prisma", async () => {
    await servicio().migrar();
    const filas = await prisma.$queryRawUnsafe<Array<{ migration_name: string; checksum: string; finished_at: unknown }>>(
      `SELECT migration_name, checksum, finished_at FROM _prisma_migrations`
    );
    for (const f of filas) {
      const sql = readFileSync(path.join(MIGRACIONES_REALES, f.migration_name, "migration.sql"), "utf8");
      expect(f.checksum).toBe(createHash("sha256").update(sql).digest("hex"));
      expect(f.finished_at).not.toBeNull();
    }
  });

  it("es idempotente: una segunda ejecución no aplica nada ni respalda", async () => {
    await servicio().migrar();
    const r = await servicio().migrar();
    expect(r).toEqual({ aplicadas: [], respaldo: null });
    expect(existsSync(backupsDir)).toBe(false);
  });

  it("deja la BD reconocida como al día por `prisma migrate status`", async () => {
    await servicio().migrar();
    await prisma.$disconnect();
    const salida = execSync("npx prisma migrate status", {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: sqliteUrl(dbPath) }, encoding: "utf8", stdio: "pipe",
    });
    expect(salida).toContain("Database schema is up to date");
  }, 60_000);

  it("respalda una BD existente con datos antes de aplicar una migración nueva", async () => {
    await servicio().migrar();
    await prisma.$executeRawUnsafe(`INSERT INTO "Categoria" ("id","nombre","updatedAt") VALUES ('c1','Bebidas',CURRENT_TIMESTAMP)`);

    const r = await servicio(migracionesConExtra()).migrar();
    expect(r.aplicadas).toEqual(["29991231000000_agrega_nota"]);
    expect(r.respaldo).not.toBeNull();
    expect(existsSync(r.respaldo as string)).toBe(true);

    // La migración nueva se aplicó y los datos se conservaron
    const cols = await prisma.$queryRawUnsafe<Array<{ name: string }>>(`PRAGMA table_info("Categoria")`);
    expect(cols.map((c) => c.name)).toContain("nota");
    expect(await prisma.$queryRawUnsafe(`SELECT nombre FROM "Categoria"`)).toEqual([{ nombre: "Bebidas" }]);

    // El respaldo es el estado ANTERIOR: tiene los datos pero no la columna nueva
    const respaldoDb = crearPrismaPara(r.respaldo as string);
    try {
      const colsResp = await respaldoDb.$queryRawUnsafe<Array<{ name: string }>>(`PRAGMA table_info("Categoria")`);
      expect(colsResp.map((c) => c.name)).not.toContain("nota");
      expect(await respaldoDb.$queryRawUnsafe(`SELECT nombre FROM "Categoria"`)).toEqual([{ nombre: "Bebidas" }]);
    } finally {
      await respaldoDb.$disconnect();
    }
  });

  it("conserva como máximo N respaldos (elimina los más antiguos)", async () => {
    await servicio().migrar();
    mkdirSync(backupsDir, { recursive: true });
    for (const n of ["2020-01-01", "2020-01-02", "2020-01-03"]) {
      writeFileSync(path.join(backupsDir, `vendeya-pre-migracion-${n}.db`), "x");
    }
    await servicio(migracionesConExtra(), 2).migrar();
    const quedan = readdirSync(backupsDir).sort();
    expect(quedan).toHaveLength(2);
    expect(quedan).not.toContain("vendeya-pre-migracion-2020-01-01.db");
    expect(quedan).not.toContain("vendeya-pre-migracion-2020-01-02.db");
  });

  it("falla si una migración ya aplicada fue modificada", async () => {
    const copia = path.join(dir, "copia");
    cpSync(MIGRACIONES_REALES, copia, { recursive: true });
    await servicio(copia).migrar();
    const primera = readdirSync(copia).find((f) => f !== "migration_lock.toml") as string;
    writeFileSync(path.join(copia, primera, "migration.sql"), "-- alterada\nSELECT 1;\n");
    await expect(servicio(copia).migrar()).rejects.toThrow(/fue modificada/);
  });

  it("revierte por completo una migración que falla a mitad (atomicidad)", async () => {
    await servicio().migrar();
    const copia = migracionesConExtra();
    writeFileSync(
      path.join(copia, "29991231000000_agrega_nota", "migration.sql"),
      'ALTER TABLE "Categoria" ADD COLUMN "nota" TEXT;\nALTER TABLE "NoExiste" ADD COLUMN "x" TEXT;\n'
    );
    await expect(servicio(copia).migrar()).rejects.toThrow();
    const cols = await prisma.$queryRawUnsafe<Array<{ name: string }>>(`PRAGMA table_info("Categoria")`);
    expect(cols.map((c) => c.name)).not.toContain("nota");
    const reg = await prisma.$queryRawUnsafe<unknown[]>(
      `SELECT 1 FROM _prisma_migrations WHERE migration_name='29991231000000_agrega_nota'`
    );
    expect(reg).toHaveLength(0);
  });

  it("actualiza una BD existente con datos: conserva filas y hace el backfill de la migración retail/farmacia", async () => {
    // 1) Estado anterior: todas las migraciones menos la última
    const todas = readdirSync(MIGRACIONES_REALES, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
    const ultima = todas[todas.length - 1] as string;
    expect(ultima).toContain("retail_farmacia");
    const previas = path.join(dir, "migraciones-previas");
    cpSync(MIGRACIONES_REALES, previas, { recursive: true });
    rmSync(path.join(previas, ultima), { recursive: true });
    await servicio(previas).migrar();

    // 2) Datos de la versión anterior (sin FK: solo interesa el contenido de las tablas reconstruidas)
    await prisma.$queryRawUnsafe("PRAGMA foreign_keys=OFF");
    await prisma.$executeRawUnsafe(
      `INSERT INTO "UnidadMedida" ("id","codigo","nombre","updatedAt") VALUES ('u1','KG','Kilogramo',CURRENT_TIMESTAMP),('u2','UN','Unidad',CURRENT_TIMESTAMP)`
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "LineaVenta" ("id","ventaId","productoId","descripcion","cantidad","precioUnitario","subtotal","total","costoUnitario") VALUES ('l1','v1','p1','Arroz',3.5,2,7,7,1.2)`
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Cliente" ("id","identificacion","razonSocial","limiteCredito","updatedAt") VALUES ('c1','0926687856001','Cliente previo',250,CURRENT_TIMESTAMP)`
    );
    await prisma.$queryRawUnsafe("PRAGMA foreign_keys=ON");

    // 3) Se aplica la migración nueva sobre la BD con datos (hay respaldo previo)
    const r = await servicio().migrar();
    expect(r.aplicadas).toEqual([ultima]);
    expect(r.respaldo).not.toBeNull();

    const lineas = await prisma.$queryRawUnsafe<Array<Record<string, number | string | null>>>(`SELECT * FROM "LineaVenta"`);
    expect(lineas).toHaveLength(1);
    expect(lineas[0]).toMatchObject({ id: "l1", cantidad: 3.5, costoUnitario: 1.2, cantidadBase: 3.5, factorConversion: 1, presentacionId: null });

    const unidades = await prisma.$queryRawUnsafe<Array<{ codigo: string; permiteDecimales: boolean }>>(`SELECT codigo, permiteDecimales FROM "UnidadMedida" ORDER BY codigo`);
    expect(unidades).toEqual([{ codigo: "KG", permiteDecimales: true }, { codigo: "UN", permiteDecimales: false }]);

    const clientes = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT * FROM "Cliente"`);
    expect(clientes).toHaveLength(1);
    expect(clientes[0]).toMatchObject({ id: "c1", razonSocial: "Cliente previo", limiteCredito: 250, listaPrecioId: null });
  });

  it("lanza un error claro si la carpeta de migraciones no existe", async () => {
    await expect(servicio(path.join(dir, "no-existe")).migrar()).rejects.toThrow(/carpeta de migraciones/);
  });
});

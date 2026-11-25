// ============================================================
// tests/integration/server/respaldo.test.ts
// Respaldos de la base de datos (previos a actualizar la aplicación y a migrar), su verificación, rotación y restauración, y la
// vuelta atrás automática cuando una migración falla a medias.
// ============================================================
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { iniciarBackend, type BackendHandle } from "../../../src/server";
import { crearPrismaPara } from "../../../src/server/config/database.config";
import { MigracionFallidaError } from "../../../src/server/services/migration.service";
import { RespaldoService, restaurarRespaldo, verificarRespaldo } from "../../../src/server/services/respaldo.service";

const MIGRACIONES = path.resolve(__dirname, "../../../prisma/migrations");
const ALTA = {
  empresa: { ruc: "1790016919001", razonSocial: "EMPRESA DE RESPALDO S.A.", nombreComercial: "RESPALDO", direccionMatriz: "Av. Siempre Viva 123", telefono: "022345678", email: "r@ejemplo.ec", tipoContribuyente: "SOCIEDAD", regimenTributario: "GENERAL", obligadoContabilidad: false, ambienteSRI: "PRUEBAS" },
  sucursal: { nombre: "Matriz", direccion: "Av. Siempre Viva 123", telefono: "022345678" },
  giro: "RETAIL_GENERAL",
  admin: { username: "dueno", password: "Clave-Segura1", nombre: "Ana", apellido: "Torres" },
};

let raiz = "";
let dbPath = "";
let backups = "";
let b: BackendHandle;

const nombresEn = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir).sort() : []);

async function leerEmpresas(archivo: string): Promise<string[]> {
  const db = crearPrismaPara(archivo);
  try {
    return (await db.empresa.findMany({ select: { razonSocial: true } })).map((e) => e.razonSocial);
  } finally {
    await db.$disconnect();
  }
}

beforeAll(async () => {
  raiz = mkdtempSync(path.join(os.tmpdir(), "vendeya-resp-"));
  dbPath = path.join(raiz, "data", "vendeya.db");
  backups = path.join(raiz, "data", "backups");
  b = await iniciarBackend({ dbPath, migrationsDir: MIGRACIONES, port: 0, logLevel: "silent" });
  expect((await b.server.inject({ method: "POST", url: "/api/setup", payload: ALTA })).statusCode).toBe(201);
}, 60_000);

afterAll(async () => {
  await b.close().catch(() => undefined);
  rmSync(raiz, { recursive: true, force: true });
});

describe("Respaldo previo a una actualización", () => {
  it("copia la base de datos con sus datos, la verifica y deja la versión en el nombre", async () => {
    const ruta = await b.respaldos.crear("pre-actualizacion", "1.2.0");
    expect(path.dirname(ruta)).toBe(backups);
    expect(path.basename(ruta)).toMatch(/^vendeya-pre-actualizacion-.+-v1\.2\.0\.db$/);
    expect(await leerEmpresas(ruta)).toEqual(["EMPRESA DE RESPALDO S.A."]);
    await expect(verificarRespaldo(ruta)).resolves.toBeUndefined();
  });

  it("es una foto del momento: los cambios posteriores no aparecen en la copia", async () => {
    const ruta = await b.respaldos.crear("pre-actualizacion", "1.3.0");
    await b.prisma.empresa.updateMany({ data: { razonSocial: "NOMBRE CAMBIADO DESPUÉS" } });
    expect(await leerEmpresas(ruta)).toEqual(["EMPRESA DE RESPALDO S.A."]);
    await b.prisma.empresa.updateMany({ data: { razonSocial: "EMPRESA DE RESPALDO S.A." } });
  });

  it("la etiqueta no puede escapar de la carpeta de respaldos", async () => {
    const ruta = await b.respaldos.crear("pre-actualizacion", "../../evil\\x'; DROP");
    expect(path.dirname(ruta)).toBe(backups);
    expect(path.basename(ruta)).not.toMatch(/[\\/']/);
  });

  it("lista del más reciente al más antiguo con su motivo", async () => {
    const lista = b.respaldos.listar();
    expect(lista.length).toBeGreaterThanOrEqual(3);
    expect(lista.every((r) => r.motivo === "pre-actualizacion" && r.bytes > 0)).toBe(true);
    expect(lista.map((r) => r.archivo)).toEqual([...lista.map((r) => r.archivo)].sort().reverse());
  });

  it("rota por motivo: conserva los N más recientes de cada tipo sin tocar los del otro", async () => {
    const dir = path.join(raiz, "rotacion");
    mkdirSync(dir, { recursive: true });
    for (const n of ["2020-01-01", "2020-01-02", "2020-01-03"]) writeFileSync(path.join(dir, `vendeya-pre-migracion-${n}.db`), "x");
    const servicio = new RespaldoService(b.prisma, dir, 2);
    for (let i = 0; i < 3; i++) await servicio.crear("pre-actualizacion", `9.${i}.0`);
    const archivos = nombresEn(dir);
    expect(archivos.filter((f) => f.startsWith("vendeya-pre-actualizacion-"))).toHaveLength(2);
    expect(archivos.filter((f) => f.startsWith("vendeya-pre-actualizacion-")).some((f) => f.endsWith("-v9.0.0.db"))).toBe(false); // el más antiguo salió
    expect(archivos.filter((f) => f.startsWith("vendeya-pre-migracion-"))).toHaveLength(3); // los de migración intactos
  });
});

describe("Verificación", () => {
  it("rechaza un archivo vacío, uno que no es SQLite y una base sin el esquema de la aplicación", async () => {
    const vacio = path.join(raiz, "vacio.db");
    writeFileSync(vacio, "");
    await expect(verificarRespaldo(vacio)).rejects.toThrow(/vacío/);
    await expect(verificarRespaldo(path.join(raiz, "no-existe.db"))).rejects.toThrow(/no se generó/);

    const basura = path.join(raiz, "basura.db");
    writeFileSync(basura, Buffer.from("esto no es una base de datos SQLite, solo texto suelto ".repeat(40)));
    await expect(verificarRespaldo(basura)).rejects.toThrow();

    const ajena = path.join(raiz, "ajena.db");
    const db = crearPrismaPara(ajena);
    await db.$executeRawUnsafe('CREATE TABLE "otra" ("id" INTEGER)');
    await db.$disconnect();
    await expect(verificarRespaldo(ajena)).rejects.toThrow(/esquema/);
  });

  it("una copia que no pasa la verificación se borra y el error se propaga: nunca queda un respaldo inservible", async () => {
    const dir = path.join(raiz, "mala-copia");
    const dañado = {
      $executeRawUnsafe: async (sql: string): Promise<number> => {
        const destino = /VACUUM INTO '(.+)'/.exec(sql)?.[1] as string;
        mkdirSync(path.dirname(destino), { recursive: true });
        writeFileSync(destino, Buffer.from("copia dañada ".repeat(200)));
        return 0;
      },
    };
    await expect(new RespaldoService(dañado, dir).crear("pre-actualizacion", "1.0.0")).rejects.toThrow();
    expect(nombresEn(dir)).toEqual([]);
  });
});

describe("Restauración", () => {
  it("deja la base como estaba en el respaldo y descarta los archivos -wal/-shm de la anterior", async () => {
    const copia = path.join(raiz, "restaurar", "vendeya.db");
    mkdirSync(path.dirname(copia), { recursive: true });
    const ruta = await b.respaldos.crear("pre-actualizacion", "restaurar");
    cpSync(ruta, copia);
    writeFileSync(`${copia}-wal`, "restos del wal anterior");
    writeFileSync(`${copia}-shm`, "restos");
    const respaldo = await b.respaldos.crear("pre-actualizacion", "2.0.0");
    restaurarRespaldo(copia, respaldo);
    expect(existsSync(`${copia}-wal`)).toBe(false);
    expect(existsSync(`${copia}-shm`)).toBe(false);
    expect(await leerEmpresas(copia)).toEqual(["EMPRESA DE RESPALDO S.A."]);
    expect(() => restaurarRespaldo(copia, path.join(raiz, "no-existe.db"))).toThrow(/No existe el respaldo/);
  });
});

describe("Una migración que falla al actualizar", () => {
  async function conMigracionRota(contenido: string): Promise<string> {
    const copia = path.join(raiz, `migraciones-${Math.random().toString(36).slice(2, 6)}`);
    cpSync(MIGRACIONES, copia, { recursive: true });
    const extra = path.join(copia, "29991231000000_rota");
    mkdirSync(extra);
    writeFileSync(path.join(extra, "migration.sql"), contenido);
    return copia;
  }

  it("vuelve a la copia tomada justo antes: no queda nada a medias y los datos siguen intactos", async () => {
    await b.close();
    // Esta migración desactiva las claves foráneas (no es transaccional): crea una tabla y falla después → estado a medias
    const rota = await conMigracionRota('PRAGMA foreign_keys=OFF;\nCREATE TABLE "parcial" ("id" INTEGER);\nINSERT INTO "no_existe" VALUES (1);\n');
    const error = await iniciarBackend({ dbPath, migrationsDir: rota, port: 0, logLevel: "silent" }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(MigracionFallidaError);
    const fallo = error as MigracionFallidaError;
    expect(fallo.migracion).toBe("29991231000000_rota");
    expect(fallo.message).toContain("no_existe");
    expect(fallo.restaurado).toBe(true);
    expect(fallo.respaldo).not.toBeNull();
    expect(existsSync(fallo.respaldo as string)).toBe(true);
    expect(path.basename(fallo.respaldo as string)).toMatch(/^vendeya-pre-migracion-/);

    const db = crearPrismaPara(dbPath);
    try {
      const tablas = await db.$queryRawUnsafe<Array<{ name: string }>>(`SELECT name FROM sqlite_master WHERE name='parcial'`);
      expect(tablas).toEqual([]); // la tabla a medias desapareció con la restauración
      expect(await db.empresa.count()).toBe(1);
    } finally {
      await db.$disconnect();
    }

    // La versión anterior (o la corregida) puede arrancar sobre esos mismos datos
    b = await iniciarBackend({ dbPath, migrationsDir: MIGRACIONES, port: 0, logLevel: "silent" });
    expect(await b.prisma.empresa.count()).toBe(1);
  });

  it("en una base nueva no hay nada que restaurar: el error no promete una copia que no existe", async () => {
    const nueva = path.join(raiz, "nueva", "vendeya.db");
    const rota = await conMigracionRota('CREATE TABLE "x" ("id" INTEGER);\nINSERT INTO "no_existe" VALUES (1);\n');
    const error = (await iniciarBackend({ dbPath: nueva, migrationsDir: rota, port: 0, logLevel: "silent" }).catch((e: unknown) => e)) as MigracionFallidaError;
    expect(error).toBeInstanceOf(MigracionFallidaError);
    expect(error.respaldo).toBeNull();
    expect(error.restaurado).toBe(false);
  });
});

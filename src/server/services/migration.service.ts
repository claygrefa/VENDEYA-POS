// ============================================================
// src/server/services/migration.service.ts
// Aplica las migraciones de prisma/migrations al iniciar la app, sin
// depender del CLI de Prisma (que no viaja en el instalador).
// - Compatible con la tabla `_prisma_migrations` (mismo checksum SHA-256),
//   por lo que `prisma migrate dev/status` sigue funcionando en desarrollo.
// - Antes de aplicar migraciones pendientes sobre una BD existente genera un
//   respaldo consistente con `VACUUM INTO`.
// ============================================================
import { createHash, randomUUID } from "crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import type { Prisma, PrismaClient } from "@prisma/client";
import { RespaldoService } from "./respaldo.service";

export interface MigrationOptions {
  /** Carpeta con subcarpetas `<timestamp>_<nombre>/migration.sql` */
  migrationsDir: string;
  /** Carpeta donde se guardan los respaldos previos a migrar */
  backupsDir: string;
  /** Ruta del archivo SQLite (para saber si ya existía con datos) */
  dbPath: string;
  /** Cantidad máxima de respaldos previos a conservar (default 5) */
  maxRespaldos?: number;
}

export interface ResultadoMigracion {
  /** Nombres de las migraciones aplicadas en esta ejecución */
  aplicadas: string[];
  /** Ruta del respaldo generado, o null si no hizo falta */
  respaldo: string | null;
}

interface MigracionEnDisco {
  nombre: string;
  sql: string;
  checksum: string;
}

/**
 * Una migración falló al actualizar. `respaldo` es la copia verificada tomada justo antes (null si la base era nueva y no había
 * nada que proteger); `restaurado` lo marca quien la devolvió a la base. Los datos del cliente nunca deben quedar a medio migrar.
 */
export class MigracionFallidaError extends Error {
  restaurado = false;
  constructor(readonly migracion: string, causa: unknown, readonly respaldo: string | null) {
    super(`La migración "${migracion}" falló: ${causa instanceof Error ? causa.message : String(causa)}`);
    this.name = "MigracionFallidaError";
  }
}

const CREAR_TABLA_MIGRACIONES = `CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "checksum" TEXT NOT NULL,
  "finished_at" DATETIME,
  "migration_name" TEXT NOT NULL,
  "logs" TEXT,
  "rolled_back_at" DATETIME,
  "started_at" DATETIME NOT NULL DEFAULT current_timestamp,
  "applied_steps_count" INTEGER UNSIGNED NOT NULL DEFAULT 0
)`;

type Ejecutor = Pick<PrismaClient, "$executeRawUnsafe" | "$queryRawUnsafe">;

/** Divide un script SQL en sentencias, descartando comentarios de línea. */
export function dividirSentencias(sql: string): string[] {
  const sinComentarios = sql
    .split(/\r?\n/)
    .filter((linea) => !linea.trim().startsWith("--"))
    .join("\n");
  return sinComentarios
    .split(/;[ \t]*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function ejecutar(db: Ejecutor, sentencia: string): Promise<void> {
  // Los PRAGMA pueden devolver filas; SQLite/Prisma no lo permite con executeRaw.
  if (/^PRAGMA\b/i.test(sentencia)) {
    await db.$queryRawUnsafe(sentencia);
  } else {
    await db.$executeRawUnsafe(sentencia);
  }
}

function checksumDe(contenido: string): string {
  return createHash("sha256").update(contenido).digest("hex");
}

export class MigrationService {
  private readonly respaldos: RespaldoService;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly opciones: MigrationOptions
  ) {
    this.respaldos = new RespaldoService(prisma, opciones.backupsDir, opciones.maxRespaldos ?? 5);
  }

  /** Lee las migraciones de disco ordenadas por nombre (el timestamp ordena cronológicamente). */
  listarEnDisco(): MigracionEnDisco[] {
    const { migrationsDir } = this.opciones;
    if (!existsSync(migrationsDir)) {
      throw new Error(`No se encontró la carpeta de migraciones: ${migrationsDir}`);
    }
    return readdirSync(migrationsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(path.join(migrationsDir, d.name, "migration.sql")))
      .map((d) => d.name)
      .sort()
      .map((nombre) => {
        const sql = readFileSync(path.join(migrationsDir, nombre, "migration.sql"), "utf8");
        return { nombre, sql, checksum: checksumDe(sql) };
      });
  }

  private async listarAplicadas(): Promise<Map<string, string>> {
    const filas = await this.prisma.$queryRawUnsafe<Array<{ migration_name: string; checksum: string }>>(
      `SELECT "migration_name", "checksum" FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL`
    );
    return new Map(filas.map((f) => [f.migration_name, f.checksum]));
  }

  /** Aplica las migraciones pendientes. Idempotente. */
  async migrar(): Promise<ResultadoMigracion> {
    const { dbPath } = this.opciones;
    // Debe evaluarse antes de cualquier consulta: Prisma crea el archivo al primer acceso.
    const existiaConDatos = existsSync(dbPath) && statSync(dbPath).size > 0;

    const enDisco = this.listarEnDisco();
    await this.prisma.$executeRawUnsafe(CREAR_TABLA_MIGRACIONES);
    const aplicadas = await this.listarAplicadas();

    for (const m of enDisco) {
      const previo = aplicadas.get(m.nombre);
      if (previo !== undefined && previo !== m.checksum) {
        throw new Error(
          `La migración "${m.nombre}" ya aplicada fue modificada (checksum distinto). No se puede continuar.`
        );
      }
    }

    const pendientes = enDisco.filter((m) => !aplicadas.has(m.nombre));
    if (pendientes.length === 0) {
      return { aplicadas: [], respaldo: null };
    }

    const respaldo = existiaConDatos ? await this.respaldos.crear("pre-migracion") : null;

    for (const m of pendientes) {
      try {
        await this.aplicar(m);
      } catch (e) {
        throw new MigracionFallidaError(m.nombre, e, respaldo);
      }
    }
    return { aplicadas: pendientes.map((m) => m.nombre), respaldo };
  }

  private async aplicar(m: MigracionEnDisco): Promise<void> {
    const sentencias = dividirSentencias(m.sql);
    const iniciada = new Date();

    const registrar = (db: Ejecutor): Promise<number> =>
      db.$executeRawUnsafe(
        `INSERT INTO "_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES (?,?,?,?,?,?)`,
        randomUUID(),
        m.checksum,
        new Date().toISOString(),
        m.nombre,
        iniciada.toISOString(),
        sentencias.length
      );

    // Las migraciones que redefinen tablas desactivan foreign_keys, y ese PRAGMA no
    // surte efecto dentro de una transacción: se ejecutan secuencialmente (el respaldo
    // previo es la red de seguridad). El resto es atómico.
    if (/PRAGMA\s+foreign_keys\s*=\s*OFF/i.test(m.sql)) {
      for (const s of sentencias) await ejecutar(this.prisma, s);
      await registrar(this.prisma);
      return;
    }

    await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        for (const s of sentencias) await ejecutar(tx, s);
        await registrar(tx);
      },
      { timeout: 120_000, maxWait: 30_000 }
    );
  }
}

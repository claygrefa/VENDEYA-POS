// ============================================================
// tests/performance/base.ts — Obtiene la base de datos grande del banco de rendimiento (se genera UNA vez y se reutiliza)
//
// La base queda en out/rendimiento/base-<parámetros>.db (carpeta ignorada por git). Cada ejecución trabaja sobre una COPIA, de modo que las
// pruebas (que venden, anulan y cierran turnos) nunca alteran la base original. Para forzar una regeneración: borre esa carpeta.
// ============================================================
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync, readFileSync } from "fs";
import path from "path";
import { runSeed } from "../../prisma/seed";
import { iniciarBackend } from "../../src/server";
import { generarBase, PARAMETROS_COMPLETOS, type ParametrosBase, type ResumenBase } from "./generador";

export const RAIZ = path.resolve(__dirname, "../..");
export const CARPETA = path.join(RAIZ, "out", "rendimiento");
export const PASSWORD_ADMIN = "ClaveDePrueba1";

/** Parámetros de esta ejecución: los completos, ajustables por variables de entorno para pruebas rápidas en equipos modestos. */
export function parametros(): ParametrosBase {
  const n = (clave: string, defecto: number): number => {
    const v = Number(process.env[clave]);
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : defecto;
  };
  return {
    ...PARAMETROS_COMPLETOS,
    productos: n("VENDEYA_RENDIMIENTO_PRODUCTOS", PARAMETROS_COMPLETOS.productos),
    clientes: n("VENDEYA_RENDIMIENTO_CLIENTES", PARAMETROS_COMPLETOS.clientes),
    dias: n("VENDEYA_RENDIMIENTO_DIAS", PARAMETROS_COMPLETOS.dias),
    ventasPorDia: n("VENDEYA_RENDIMIENTO_VENTAS_DIA", PARAMETROS_COMPLETOS.ventasPorDia),
    ventasTurnoAbierto: n("VENDEYA_RENDIMIENTO_TURNO_ABIERTO", PARAMETROS_COMPLETOS.ventasTurnoAbierto),
  };
}

export const nombreBase = (p: ParametrosBase): string => `base-${p.productos}p-${p.clientes}c-${p.dias}d-${p.ventasPorDia}v-${p.ventasTurnoAbierto}t-s${p.semilla}`;

const salida = (m: string): void => void process.stdout.write(`[rendimiento] ${m}\n`);

/**
 * Devuelve la ruta de una COPIA de trabajo de la base grande y el resumen de lo que contiene. Genera la base si aún no existe
 * (varios minutos con los parámetros completos).
 */
export async function obtenerCopiaDeTrabajo(p: ParametrosBase, destino: string): Promise<{ ruta: string; resumen: ResumenBase; generada: boolean }> {
  mkdirSync(CARPETA, { recursive: true });
  const base = path.join(CARPETA, `${nombreBase(p)}.db`);
  const info = `${base}.json`;
  let generada = false;
  if (!existsSync(base) || !existsSync(info)) {
    generada = true;
    const temporal = `${base}.generando`;
    for (const sufijo of ["", "-wal", "-shm", "-journal"]) rmSync(`${temporal}${sufijo}`, { force: true });
    salida(`generando la base (${p.productos} productos, ${p.clientes} clientes, ${p.dias} días × ${p.ventasPorDia} ventas)…`);
    const b = await iniciarBackend({ dbPath: temporal, migrationsDir: path.join(RAIZ, "prisma", "migrations"), port: 0, logLevel: "silent" });
    try {
      await runSeed(b.prisma, { adminPassword: PASSWORD_ADMIN });
      const resumen = await generarBase(b.prisma, p, (m) => salida(m));
      await b.prisma.$queryRawUnsafe("PRAGMA wal_checkpoint(TRUNCATE)");
      writeFileSync(info, JSON.stringify(resumen, null, 2));
      salida(`base generada en ${resumen.segundos} s`);
    } finally {
      await b.close();
    }
    renameSync(temporal, base);
    for (const sufijo of ["-wal", "-shm", "-journal"]) rmSync(`${temporal}${sufijo}`, { force: true });
  }
  mkdirSync(path.dirname(destino), { recursive: true });
  copyFileSync(base, destino);
  return { ruta: destino, resumen: JSON.parse(readFileSync(info, "utf8")) as ResumenBase, generada };
}

export const tamanoMB = (ruta: string): number => Math.round((statSync(ruta).size / 1_048_576) * 10) / 10;

// ============================================================
// src/server/config/database.config.ts — Cliente Prisma singleton
// ============================================================
import { PrismaClient } from "@prisma/client";

/** Convierte una ruta de archivo en URL de datasource SQLite (separadores `/`). */
export function sqliteUrl(rutaArchivo: string): string {
  return `file:${rutaArchivo.replace(/\\/g, "/")}`;
}

/**
 * Cliente Prisma apuntando a un archivo SQLite concreto (no usa el singleton).
 *
 * Usa UNA sola conexión: SQLite admite un único escritor, y con varias conexiones las
 * transacciones concurrentes compiten por el bloqueo y fallan por timeout. Con una conexión
 * se encolan en orden (hasta `pool_timeout` s). Consecuencia: dentro de un callback de
 * `$transaction` hay que usar siempre el cliente `tx`, nunca el cliente base (se bloquearía).
 */
export function crearPrismaPara(rutaArchivo: string): PrismaClient {
  const url = `${sqliteUrl(rutaArchivo)}?connection_limit=1&pool_timeout=60&socket_timeout=60`;
  // Con una sola conexión las transacciones se encolan: la espera por 2 s que trae Prisma por defecto falla bajo carga
  // ("Unable to start a transaction in the given time") aunque no haya ningún error. Se amplía para todas las transacciones.
  return new PrismaClient({ datasources: { db: { url } }, transactionOptions: { maxWait: 30_000, timeout: 60_000 } });
}

let instancia: PrismaClient | null = null;

/** Devuelve el cliente Prisma compartido (se crea una sola vez por proceso). */
export function getPrisma(): PrismaClient {
  if (instancia === null) {
    instancia = new PrismaClient();
  }
  return instancia;
}

/** Cierra la conexión y libera el singleton (apagado limpio / pruebas). */
export async function disconnectPrisma(): Promise<void> {
  if (instancia !== null) {
    await instancia.$disconnect();
    instancia = null;
  }
}

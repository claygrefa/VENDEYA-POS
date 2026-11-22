// ============================================================
// src/server/config/database.config.ts — Cliente Prisma singleton
// ============================================================
import { PrismaClient } from "@prisma/client";

/** Convierte una ruta de archivo en URL de datasource SQLite (separadores `/`). */
export function sqliteUrl(rutaArchivo: string): string {
  return `file:${rutaArchivo.replace(/\\/g, "/")}`;
}

/** Cliente Prisma apuntando a un archivo SQLite concreto (no usa el singleton). */
export function crearPrismaPara(rutaArchivo: string): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: sqliteUrl(rutaArchivo) } } });
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

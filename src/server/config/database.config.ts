// ============================================================
// src/server/config/database.config.ts — Cliente Prisma singleton
// ============================================================
import { PrismaClient } from "@prisma/client";

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

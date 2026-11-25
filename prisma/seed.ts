// ============================================================
// prisma/seed.ts — Datos base de VENDEYA POS (idempotente)
// Ejecutar: npm run prisma:seed
// ============================================================
import { PrismaClient } from "@prisma/client";
import { crearInstalacion, sembrarBase } from "../src/server/services/setup/instalacion.util";
import type { GiroNegocio } from "../src/shared/types/feature-flags.types";


export { ROLES_BASE } from "../src/server/services/setup/instalacion.util";

export interface SeedOptions {
  adminPassword?: string;
  giroNegocio?: GiroNegocio;
}

export interface SeedResult {
  empresaId: string;
  sucursalId: string;
  puntoEmisionId: string;
  adminId: string;
  clienteConsumidorFinalId: string;
}

/** Datos de DESARROLLO: una empresa de demostración. En producción la crea el asistente de configuración inicial. */
export async function runSeed(prisma: PrismaClient, opciones: SeedOptions = {}): Promise<SeedResult> {
  const adminPassword = opciones.adminPassword ?? process.env["SEED_ADMIN_PASSWORD"] ?? "Admin123!";
  const giro: GiroNegocio = opciones.giroNegocio ?? "RETAIL_GENERAL";
  const roles = await sembrarBase(prisma);
  return crearInstalacion(prisma, roles, {
    empresa: {
      ruc: "9999999999001",
      razonSocial: "EMPRESA DE DEMOSTRACION S.A.",
      nombreComercial: "VENDEYA DEMO",
      direccionMatriz: "Quito, Ecuador",
      telefono: "022000000",
      email: "demo@vendeya.local",
      tipoContribuyente: "SOCIEDAD",
      regimenTributario: "GENERAL",
      ambienteSRI: "PRUEBAS",
    },
    sucursal: { nombre: "Matriz", direccion: "Quito, Ecuador", telefono: "022000000" },
    giro,
    admin: { username: "admin", password: adminPassword, nombre: "Administrador", apellido: "Sistema" },
  });
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const resultado = await runSeed(prisma);
    console.log("Seed completado:", resultado);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}

// ============================================================
// prisma/seed.ts — Datos base de VENDEYA POS (idempotente)
// Ejecutar: npm run prisma:seed
// ============================================================
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/server/services/password.util";
import { TARIFAS_IVA, CONSUMIDOR_FINAL } from "../src/shared/constants/sri.constants";
import { FEATURE_FLAGS_POR_GIRO, type GiroNegocio } from "../src/shared/types/feature-flags.types";

export const ROLES_BASE = ["ADMIN", "SUPERVISOR", "CAJERO", "BODEGUERO", "CONTADOR"] as const;
type RolBase = (typeof ROLES_BASE)[number];

const MODULOS = [
  "ventas", "caja", "inventario", "clientes", "proveedores",
  "reportes", "sri", "configuracion", "usuarios",
] as const;
const ACCIONES = ["crear", "leer", "actualizar", "eliminar", "anular", "exportar"] as const;

/** Predicado sobre la clave "modulo:accion" que define los permisos de cada rol. */
const PERMISOS_POR_ROL: Record<RolBase, (clave: string) => boolean> = {
  ADMIN: () => true,
  SUPERVISOR: (p) =>
    !p.startsWith("usuarios:") && !p.startsWith("configuracion:") && !p.endsWith(":eliminar"),
  CAJERO: (p) =>
    ["ventas:crear", "ventas:leer", "caja:crear", "caja:leer", "clientes:crear", "clientes:leer", "inventario:leer"].includes(p),
  BODEGUERO: (p) =>
    p.startsWith("inventario:") || (p.startsWith("proveedores:") && !p.endsWith(":eliminar")),
  CONTADOR: (p) =>
    p.startsWith("reportes:") || ["sri:leer", "sri:exportar", "ventas:leer", "ventas:exportar"].includes(p),
};

const DESCRIPCION_ROL: Record<RolBase, string> = {
  ADMIN: "Administrador con acceso total",
  SUPERVISOR: "Supervisor: anulaciones, arqueos y reportes",
  CAJERO: "Cajero: ventas y operación de caja",
  BODEGUERO: "Bodeguero: inventario y proveedores",
  CONTADOR: "Contador: reportes y comprobantes SRI",
};

const UNIDADES = [
  { codigo: "UN", nombre: "Unidad", permiteDecimales: false },
  { codigo: "KG", nombre: "Kilogramo", permiteDecimales: true },
  { codigo: "LB", nombre: "Libra", permiteDecimales: true },
  { codigo: "L", nombre: "Litro", permiteDecimales: true },
  { codigo: "M", nombre: "Metro", permiteDecimales: true },
  { codigo: "PAQ", nombre: "Paquete", permiteDecimales: false },
  { codigo: "CJ", nombre: "Caja", permiteDecimales: false },
  { codigo: "SRV", nombre: "Servicio", permiteDecimales: false },
] as const;

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

export async function runSeed(prisma: PrismaClient, opciones: SeedOptions = {}): Promise<SeedResult> {
  const adminPassword = opciones.adminPassword ?? process.env["SEED_ADMIN_PASSWORD"] ?? "Admin123!";
  const giro: GiroNegocio = opciones.giroNegocio ?? "RETAIL_GENERAL";

  // ── Permisos y roles RBAC ──────────────────────────────────
  const claves: string[] = [];
  const permisoIds = new Map<string, string>();
  for (const modulo of MODULOS) {
    for (const accion of ACCIONES) {
      const p = await prisma.permiso.upsert({
        where: { modulo_accion_recurso: { modulo, accion, recurso: "*" } },
        update: {},
        create: { modulo, accion, recurso: "*" },
      });
      claves.push(`${modulo}:${accion}`);
      permisoIds.set(`${modulo}:${accion}`, p.id);
    }
  }

  const rolIds = new Map<string, string>();
  for (const nombre of ROLES_BASE) {
    const rol = await prisma.rol.upsert({
      where: { nombre },
      update: { descripcion: DESCRIPCION_ROL[nombre] },
      create: { nombre, descripcion: DESCRIPCION_ROL[nombre] },
    });
    rolIds.set(nombre, rol.id);
    for (const clave of claves.filter(PERMISOS_POR_ROL[nombre])) {
      const permisoId = permisoIds.get(clave) as string;
      await prisma.rolPermiso.upsert({
        where: { rolId_permisoId: { rolId: rol.id, permisoId } },
        update: {},
        create: { rolId: rol.id, permisoId },
      });
    }
  }

  // ── Unidades de medida y categoría por defecto ─────────────
  for (const u of UNIDADES) {
    await prisma.unidadMedida.upsert({
      where: { codigo: u.codigo },
      update: { permiteDecimales: u.permiteDecimales },
      create: u,
    });
  }
  const catExistente = await prisma.categoria.findFirst({ where: { nombre: "General" } });
  if (catExistente === null) {
    await prisma.categoria.create({ data: { nombre: "General", descripcion: "Categoría por defecto" } });
  }

  // ── Empresa, sucursal y punto de emisión base ──────────────
  // RUC marcador de posición: el SetupWizard (Semana 17) lo reemplaza con datos reales.
  const empresa = await prisma.empresa.upsert({
    where: { ruc: "9999999999001" },
    update: {},
    create: {
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
  });
  const sucursal = await prisma.sucursal.upsert({
    where: { empresaId_codigo: { empresaId: empresa.id, codigo: "001" } },
    update: {},
    create: { empresaId: empresa.id, codigo: "001", nombre: "Matriz", direccion: "Quito, Ecuador", telefono: "022000000" },
  });
  const punto = await prisma.puntoEmision.upsert({
    where: { sucursalId_codigo: { sucursalId: sucursal.id, codigo: "001" } },
    update: {},
    create: { sucursalId: sucursal.id, codigo: "001", descripcion: "Caja principal" },
  });

  // ── Impuestos SRI vigentes ─────────────────────────────────
  for (const t of TARIFAS_IVA) {
    await prisma.tarifaImpuesto.upsert({
      where: { empresaId_tipoImpuesto_codigo: { empresaId: empresa.id, tipoImpuesto: "IVA", codigo: t.codigo } },
      update: { porcentaje: t.porcentaje, descripcion: t.descripcion },
      create: { empresaId: empresa.id, tipoImpuesto: "IVA", codigo: t.codigo, porcentaje: t.porcentaje, descripcion: t.descripcion },
    });
  }

  // ── Usuario administrador ──────────────────────────────────
  const adminExistente = await prisma.usuario.findUnique({ where: { username: "admin" } });
  const adminId =
    adminExistente !== null
      ? adminExistente.id
      : (
          await prisma.usuario.create({
            data: {
              empresaId: empresa.id,
              rolId: rolIds.get("ADMIN") as string,
              username: "admin",
              passwordHash: await hashPassword(adminPassword),
              nombre: "Administrador",
              apellido: "Sistema",
            },
          })
        ).id;

  // ── Consumidor Final ───────────────────────────────────────
  const consumidor = await prisma.cliente.upsert({
    where: {
      tipoIdentificacion_identificacion: {
        tipoIdentificacion: CONSUMIDOR_FINAL.tipoIdentificacion,
        identificacion: CONSUMIDOR_FINAL.identificacion,
      },
    },
    update: {},
    create: {
      tipoIdentificacion: CONSUMIDOR_FINAL.tipoIdentificacion,
      identificacion: CONSUMIDOR_FINAL.identificacion,
      razonSocial: CONSUMIDOR_FINAL.razonSocial,
    },
  });

  // ── Configuración de giro (feature flags) ──────────────────
  const f = FEATURE_FLAGS_POR_GIRO[giro];
  await prisma.configuracionGiro.upsert({
    where: { empresaId: empresa.id },
    update: {},
    create: {
      empresaId: empresa.id,
      giroNegocio: giro,
      moduloInventario: f.moduloInventario,
      moduloKardex: f.moduloKardex,
      moduloLotes: f.moduloLotes,
      moduloVencimientos: f.moduloVencimientos,
      moduloMesas: f.moduloMesas,
      moduloComandasCocina: f.moduloComandasCocina,
      moduloBalanza: f.moduloBalanza,
      moduloListasPrecios: f.moduloListasPrecios,
      moduloCuentasPorCobrar: f.moduloCuentasPorCobrar,
      moduloCuentasPorPagar: f.moduloCuentasPorPagar,
      emitirFacturas: f.emitirFacturas,
      emitirNotasCredito: f.emitirNotasCredito,
      emitirRetenciones: f.emitirRetenciones,
      emitirGuiasRemision: f.emitirGuiasRemision,
      emitirLiquidaciones: f.emitirLiquidaciones,
      impresionTermica: f.impresionTermica,
      aperturaGaveta: f.aperturaGaveta,
      lecturaCodigoBarras: f.lecturaCodigoBarras,
      sincronizacionLAN: f.sincronizacionLAN,
      modoTactil: f.modoTacticl,
    },
  });

  return {
    empresaId: empresa.id,
    sucursalId: sucursal.id,
    puntoEmisionId: punto.id,
    adminId,
    clienteConsumidorFinalId: consumidor.id,
  };
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

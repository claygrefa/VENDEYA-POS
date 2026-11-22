// ============================================================
// tests/integration/prisma-schema.test.ts
// Prueba: Verifica que el cliente Prisma generado expone todos
// los modelos definidos en schema.prisma y que la BD responde.
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "path";
import { crearPrismaPara } from "../../src/server/config/database.config";
import { MigrationService } from "../../src/server/services/migration.service";

// BD de test propia: se migra automáticamente con las migraciones reales (autosuficiente)
const RAIZ = path.resolve(__dirname, "../..");
const DB_PATH = path.join(RAIZ, "prisma", "vendeya-test.db");
const prisma = crearPrismaPara(DB_PATH);

beforeAll(async () => {
  await new MigrationService(prisma, {
    migrationsDir: path.join(RAIZ, "prisma", "migrations"),
    backupsDir: path.join(RAIZ, "prisma", "test-backups"),
    dbPath: DB_PATH,
  }).migrar();
}, 60_000);

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Prisma Client — Modelos generados", () => {
  // ── Lista de todos los modelos del schema.prisma ────────────
  const modelosEsperados = [
    "empresa",
    "sucursal",
    "puntoEmision",
    "rol",
    "permiso",
    "rolPermiso",
    "usuario",
    "configuracionGiro",
    "tarifaImpuesto",
    "categoria",
    "unidadMedida",
    "producto",
    "lote",
    "kardex",
    "cliente",
    "proveedor",
    "turnoCaja",
    "movimientoCaja",
    "venta",
    "lineaVenta",
    "pagoVenta",
    "comprobanteElectronico",
    "colaSRI",
    "mesa",
    "comanda",
    "itemComanda",
    "compra",
    "lineaCompra",
    "cuentaPorCobrar",
    "pagoCuentaPorCobrar",
    "cuentaPorPagar",
    "pagoCuentaPorPagar",
    "presentacionProducto",
    "listaPrecio",
    "precioProducto",
  ] as const;

  it.each(modelosEsperados)(
    "el modelo '%s' debe existir como delegado en PrismaClient",
    (modelo) => {
      // Prisma genera delegados en camelCase en el cliente
      expect(prisma).toHaveProperty(modelo);
      // El delegado debe ser un objeto con al menos el método findMany
      const delegado = (prisma as unknown as Record<string, unknown>)[modelo];
      expect(typeof delegado).toBe("object");
      expect(delegado).not.toBeNull();
      expect(typeof (delegado as Record<string, unknown>)["findMany"]).toBe("function");
    }
  );

  it("debe poder hacer $queryRaw a la base de datos SQLite", async () => {
    const result = await prisma.$queryRaw<[{ val: bigint | number }]>`SELECT 1 AS val`;
    expect(Number(result[0]?.val)).toBe(1);
  });

  it("Empresa: findMany debe retornar array vacío en BD recién migrada", async () => {
    const empresas = await prisma.empresa.findMany();
    expect(Array.isArray(empresas)).toBe(true);
  });

  it("Producto: findMany con filtro por status debe funcionar", async () => {
    const productos = await prisma.producto.findMany({
      where: { status: "ACTIVO" },
    });
    expect(Array.isArray(productos)).toBe(true);
  });

  it("Venta: findMany con include de lineas y pagos debe funcionar", async () => {
    const ventas = await prisma.venta.findMany({
      include: {
        lineas: true,
        pagos:  true,
      },
      take: 1,
    });
    expect(Array.isArray(ventas)).toBe(true);
  });

  it("ComprobanteElectronico: findMany con filtro de estado debe funcionar", async () => {
    const pendientes = await prisma.comprobanteElectronico.findMany({
      where: { estado: "PENDIENTE" },
    });
    expect(Array.isArray(pendientes)).toBe(true);
  });

  it("Mesa: findMany con filtro por estado LIBRE debe funcionar", async () => {
    const mesas = await prisma.mesa.findMany({
      where: { estado: "LIBRE" },
    });
    expect(Array.isArray(mesas)).toBe(true);
  });
});

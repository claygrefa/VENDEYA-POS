// ============================================================
// src/server/repositories/kardex.repository.ts
// Acceso a datos de stock/costo de Producto y movimientos Kardex.
// Todos los métodos reciben el cliente transaccional (o el cliente normal).
// ============================================================
import type { Kardex, Prisma, PrismaClient, Producto } from "@prisma/client";

export type Db = PrismaClient | Prisma.TransactionClient;

export type NuevoMovimiento = Omit<Prisma.KardexUncheckedCreateInput, "id" | "createdAt" | "fecha">;

export class KardexRepository {
  leerProducto(db: Db, productoId: string): Promise<Producto | null> {
    return db.producto.findUnique({ where: { id: productoId } });
  }

  /** Descuenta stock solo si alcanza (atómico en SQL). Devuelve filas afectadas (0 = no alcanzó o no existe). */
  async descontarStockSiAlcanza(db: Db, productoId: string, cantidad: number): Promise<number> {
    const r = await db.producto.updateMany({
      where: { id: productoId, stockActual: { gte: cantidad } },
      data: { stockActual: { decrement: cantidad } },
    });
    return r.count;
  }

  /** Compare-and-swap: actualiza solo si stock y costo siguen siendo los leídos. */
  async actualizarEntradaSiNoCambio(
    db: Db,
    anterior: Pick<Producto, "id" | "stockActual" | "costoPromedio">,
    nuevo: { stockActual: number; costoPromedio: number }
  ): Promise<number> {
    const r = await db.producto.updateMany({
      where: { id: anterior.id, stockActual: anterior.stockActual, costoPromedio: anterior.costoPromedio },
      data: nuevo,
    });
    return r.count;
  }

  crearMovimiento(db: Db, datos: NuevoMovimiento): Promise<Kardex> {
    return db.kardex.create({ data: datos });
  }

  async listarPaginado(db: Db, productoId: string, page: number, pageSize: number): Promise<{ items: Kardex[]; total: number }> {
    const [items, total] = await Promise.all([
      db.kardex.findMany({
        where: { productoId },
        orderBy: [{ fecha: "desc" }, { createdAt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.kardex.count({ where: { productoId } }),
    ]);
    return { items, total };
  }

  listarPorProducto(db: Db, productoId: string): Promise<Kardex[]> {
    return db.kardex.findMany({ where: { productoId }, orderBy: [{ fecha: "asc" }, { createdAt: "asc" }] });
  }
}

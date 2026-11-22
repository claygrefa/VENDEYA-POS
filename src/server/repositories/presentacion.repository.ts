// ============================================================
// src/server/repositories/presentacion.repository.ts — Presentaciones y códigos de barras
// ============================================================
import type { Prisma, PresentacionProducto, Producto } from "@prisma/client";
import type { Db } from "./kardex.repository";

export type PresentacionConProducto = PresentacionProducto & { producto: Producto };

/** ¿El código de barras ya lo usa otro producto u otra presentación? */
export async function codigoBarrasEnUso(
  db: Db,
  codigo: string,
  ignorar: { productoId?: string; presentacionId?: string } = {}
): Promise<boolean> {
  const producto = await db.producto.findFirst({
    where: { codigoBarras: codigo, ...(ignorar.productoId !== undefined ? { id: { not: ignorar.productoId } } : {}) },
    select: { id: true },
  });
  if (producto !== null) return true;
  const presentacion = await db.presentacionProducto.findFirst({
    where: { codigoBarras: codigo, ...(ignorar.presentacionId !== undefined ? { id: { not: ignorar.presentacionId } } : {}) },
    select: { id: true },
  });
  return presentacion !== null;
}

export class PresentacionRepository {
  producto(db: Db, id: string): Promise<Producto | null> {
    return db.producto.findUnique({ where: { id } });
  }

  buscarPorId(db: Db, id: string): Promise<PresentacionConProducto | null> {
    return db.presentacionProducto.findUnique({ where: { id }, include: { producto: true } });
  }

  nombreExiste(db: Db, productoId: string, nombre: string, ignorarId?: string): Promise<{ id: string } | null> {
    return db.presentacionProducto.findFirst({
      where: { productoId, nombre, ...(ignorarId !== undefined ? { id: { not: ignorarId } } : {}) },
      select: { id: true },
    });
  }

  listarPorProducto(db: Db, productoId: string): Promise<PresentacionProducto[]> {
    return db.presentacionProducto.findMany({ where: { productoId }, orderBy: { factor: "asc" } });
  }

  crear(db: Db, data: Prisma.PresentacionProductoUncheckedCreateInput): Promise<PresentacionProducto> {
    return db.presentacionProducto.create({ data });
  }

  actualizar(db: Db, id: string, data: Prisma.PresentacionProductoUncheckedUpdateInput): Promise<PresentacionProducto> {
    return db.presentacionProducto.update({ where: { id }, data });
  }
}

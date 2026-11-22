// ============================================================
// src/server/repositories/listaPrecio.repository.ts
// ============================================================
import type { Cliente, ListaPrecio, PrecioProducto, Prisma, PresentacionProducto, Producto } from "@prisma/client";
import type { Db } from "./kardex.repository";

export type PrecioConDetalle = PrecioProducto & {
  producto: Pick<Producto, "id" | "codigo" | "nombre">;
  presentacion: Pick<PresentacionProducto, "id" | "nombre" | "factor"> | null;
};

const incluirDetalle = {
  producto: { select: { id: true, codigo: true, nombre: true } },
  presentacion: { select: { id: true, nombre: true, factor: true } },
} satisfies Prisma.PrecioProductoInclude;

export class ListaPrecioRepository {
  crear(db: Db, data: { empresaId: string; nombre: string; descripcion: string }): Promise<ListaPrecio> {
    return db.listaPrecio.create({ data });
  }

  buscarPorId(db: Db, id: string, empresaId: string): Promise<ListaPrecio | null> {
    return db.listaPrecio.findFirst({ where: { id, empresaId } });
  }

  nombreExiste(db: Db, empresaId: string, nombre: string, ignorarId?: string): Promise<{ id: string } | null> {
    return db.listaPrecio.findFirst({
      where: { empresaId, nombre, ...(ignorarId !== undefined ? { id: { not: ignorarId } } : {}) },
      select: { id: true },
    });
  }

  listar(db: Db, empresaId: string): Promise<ListaPrecio[]> {
    return db.listaPrecio.findMany({ where: { empresaId }, orderBy: { nombre: "asc" } });
  }

  actualizar(db: Db, id: string, data: Prisma.ListaPrecioUpdateInput): Promise<ListaPrecio> {
    return db.listaPrecio.update({ where: { id }, data });
  }

  producto(db: Db, id: string): Promise<Producto | null> {
    return db.producto.findUnique({ where: { id } });
  }

  presentacion(db: Db, id: string): Promise<PresentacionProducto | null> {
    return db.presentacionProducto.findUnique({ where: { id } });
  }

  buscarPrecio(db: Db, listaPrecioId: string, productoId: string, presentacionId: string | null): Promise<PrecioProducto | null> {
    return db.precioProducto.findFirst({ where: { listaPrecioId, productoId, presentacionId } });
  }

  crearPrecio(db: Db, data: { listaPrecioId: string; productoId: string; presentacionId: string | null; precio: number }): Promise<PrecioConDetalle> {
    return db.precioProducto.create({ data, include: incluirDetalle });
  }

  actualizarPrecio(db: Db, id: string, precio: number): Promise<PrecioConDetalle> {
    return db.precioProducto.update({ where: { id }, data: { precio }, include: incluirDetalle });
  }

  async eliminarPrecio(db: Db, id: string, listaPrecioId: string): Promise<number> {
    const r = await db.precioProducto.deleteMany({ where: { id, listaPrecioId } });
    return r.count;
  }

  preciosDeLista(db: Db, listaPrecioId: string): Promise<PrecioConDetalle[]> {
    return db.precioProducto.findMany({ where: { listaPrecioId }, include: incluirDetalle, orderBy: { createdAt: "asc" } });
  }

  cliente(db: Db, id: string): Promise<Cliente | null> {
    return db.cliente.findUnique({ where: { id } });
  }

  asignarACliente(db: Db, clienteId: string, listaPrecioId: string | null): Promise<Cliente> {
    return db.cliente.update({ where: { id: clienteId }, data: { listaPrecioId } });
  }
}

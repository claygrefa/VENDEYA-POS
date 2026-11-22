// ============================================================
// src/server/repositories/lote.repository.ts
// ============================================================
import type { Lote, Prisma, Producto } from "@prisma/client";
import type { Db } from "./kardex.repository";
import type { ResultadoPaginado } from "./producto.repository";

const incluirProducto = {
  producto: { select: { id: true, codigo: true, nombre: true, principioActivo: true } },
} satisfies Prisma.LoteInclude;

export type LoteConProducto = Prisma.LoteGetPayload<{ include: typeof incluirProducto }>;

export interface FiltroLotes {
  page: number;
  pageSize: number;
  productoId?: string;
  status?: string;
  conStock?: boolean;
}

export class LoteRepository {
  producto(db: Db, id: string): Promise<Producto | null> {
    return db.producto.findUnique({ where: { id } });
  }

  porId(db: Db, id: string): Promise<LoteConProducto | null> {
    return db.lote.findUnique({ where: { id }, include: incluirProducto });
  }

  porProductoYNumero(db: Db, productoId: string, numeroLote: string): Promise<Lote | null> {
    return db.lote.findUnique({ where: { productoId_numeroLote: { productoId, numeroLote } } });
  }

  crear(db: Db, data: Prisma.LoteUncheckedCreateInput): Promise<Lote> {
    return db.lote.create({ data });
  }

  /** Repone un lote existente (nueva entrada del mismo número de lote). */
  incrementar(db: Db, id: string, cantidad: number): Promise<Lote> {
    return db.lote.update({ where: { id }, data: { cantidadActual: { increment: cantidad }, cantidadInicial: { increment: cantidad } } });
  }

  async descontarSiAlcanza(db: Db, id: string, productoId: string, cantidad: number): Promise<number> {
    const r = await db.lote.updateMany({
      where: { id, productoId, cantidadActual: { gte: cantidad } },
      data: { cantidadActual: { decrement: cantidad } },
    });
    return r.count;
  }

  actualizar(db: Db, id: string, data: Prisma.LoteUncheckedUpdateInput): Promise<LoteConProducto> {
    return db.lote.update({ where: { id }, data, include: incluirProducto });
  }

  async listar(db: Db, f: FiltroLotes): Promise<ResultadoPaginado<LoteConProducto>> {
    const where: Prisma.LoteWhereInput = {
      ...(f.productoId !== undefined ? { productoId: f.productoId } : {}),
      ...(f.status !== undefined ? { status: f.status } : {}),
      ...(f.conStock === true ? { cantidadActual: { gt: 0 } } : {}),
    };
    const [items, total] = await Promise.all([
      db.lote.findMany({
        where,
        include: incluirProducto,
        orderBy: [{ fechaVencimiento: "asc" }, { createdAt: "asc" }],
        skip: (f.page - 1) * f.pageSize,
        take: f.pageSize,
      }),
      db.lote.count({ where }),
    ]);
    return { items, total, page: f.page, pageSize: f.pageSize };
  }

  /** Lotes ACTIVOS con existencia que vencen hasta `hasta` (incluye los ya vencidos). */
  conExistenciaHasta(db: Db, hasta: Date): Promise<LoteConProducto[]> {
    return db.lote.findMany({
      where: { status: "ACTIVO", cantidadActual: { gt: 0 }, fechaVencimiento: { lte: hasta } },
      include: incluirProducto,
      orderBy: { fechaVencimiento: "asc" },
    });
  }

  /** Productos BIEN activos con mínimo configurado (el filtro stock <= mínimo se aplica en el servicio). */
  productosConMinimo(db: Db): Promise<Producto[]> {
    return db.producto.findMany({ where: { tipo: "BIEN", status: "ACTIVO", stockMinimo: { gt: 0 } }, orderBy: { nombre: "asc" } });
  }
}

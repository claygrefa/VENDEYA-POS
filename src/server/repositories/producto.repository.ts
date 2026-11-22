// ============================================================
// src/server/repositories/producto.repository.ts
// ============================================================
import type { Prisma, PrismaClient, Producto } from "@prisma/client";
import { codigoBarrasEnUso, type PresentacionConProducto } from "./presentacion.repository";

export interface ResultadoPaginado<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface FiltroProductos {
  page: number;
  pageSize: number;
  search?: string;
}

export class ProductoRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findById(id: string): Promise<Producto | null> {
    return this.prisma.producto.findUnique({ where: { id } });
  }

  findByCodigo(codigo: string): Promise<Producto | null> {
    return this.prisma.producto.findUnique({ where: { codigo } });
  }

  findByCodigoBarras(codigoBarras: string): Promise<Producto | null> {
    return this.prisma.producto.findFirst({ where: { codigoBarras, status: "ACTIVO" } });
  }

  /** Código de barras ya usado por otro producto u otra presentación. */
  codigoBarrasEnUso(codigo: string, ignorarProductoId?: string): Promise<boolean> {
    return codigoBarrasEnUso(this.prisma, codigo, ignorarProductoId !== undefined ? { productoId: ignorarProductoId } : {});
  }

  /** Presentación activa (de un producto activo) por su código de barras. */
  findPresentacionPorCodigoBarras(codigoBarras: string): Promise<PresentacionConProducto | null> {
    return this.prisma.presentacionProducto.findFirst({
      where: { codigoBarras, status: "ACTIVO", producto: { status: "ACTIVO" } },
      include: { producto: true },
    });
  }

  async categoriaExiste(id: string): Promise<boolean> {
    return (await this.prisma.categoria.findUnique({ where: { id }, select: { id: true } })) !== null;
  }

  async unidadExiste(id: string): Promise<boolean> {
    return (await this.prisma.unidadMedida.findUnique({ where: { id }, select: { id: true } })) !== null;
  }

  async buscar(filtro: FiltroProductos): Promise<ResultadoPaginado<Producto>> {
    const texto = filtro.search;
    const where: Prisma.ProductoWhereInput = {
      status: "ACTIVO",
      ...(texto !== undefined && texto !== ""
        ? {
            OR: [
              { nombre: { contains: texto } },
              { codigo: { contains: texto } },
              { codigoBarras: { contains: texto } },
              { principioActivo: { contains: texto } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.producto.findMany({
        where,
        orderBy: { nombre: "asc" },
        skip: (filtro.page - 1) * filtro.pageSize,
        take: filtro.pageSize,
      }),
      this.prisma.producto.count({ where }),
    ]);
    return { items, total, page: filtro.page, pageSize: filtro.pageSize };
  }

  create(data: Prisma.ProductoUncheckedCreateInput): Promise<Producto> {
    return this.prisma.producto.create({ data });
  }

  update(id: string, data: Prisma.ProductoUncheckedUpdateInput): Promise<Producto> {
    return this.prisma.producto.update({ where: { id }, data });
  }
}

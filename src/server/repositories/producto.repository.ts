// ============================================================
// src/server/repositories/producto.repository.ts
// ============================================================
import { Prisma, type PrismaClient, type Producto } from "@prisma/client";
import { codigoBarrasEnUso, type PresentacionConProducto } from "./presentacion.repository";

/** Lo que necesita una pantalla de venta de cada producto: su unidad de medida y la tarifa de IVA asignada. */
export const incluirParaVenta = {
  unidadMedida: { select: { codigo: true, nombre: true, permiteDecimales: true } },
  tarifaImpuesto: { select: { porcentaje: true } },
} satisfies Prisma.ProductoInclude;

export type ProductoConDetalle = Prisma.ProductoGetPayload<{ include: typeof incluirParaVenta }>;

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

  async buscar(filtro: FiltroProductos): Promise<ResultadoPaginado<ProductoConDetalle>> {
    const { search, page, pageSize } = filtro;
    const offset = (page - 1) * pageSize;
    if (search !== undefined && search !== "") {
      const patron = `%${search}%`;
      // Usa frases literales en FTS5. Los patrones LIKE con comodines del usuario conservan su semántica anterior.
      const frase = `"${search.replaceAll('"', '""')}"`;
      const coincidencias = /^([^%_\x00]){3,}$/u.test(search)
        ? Prisma.sql`
          SELECT p.id, p.nombre FROM ProductoBusqueda
          JOIN Producto p ON p.rowid = ProductoBusqueda.rowid
          WHERE ProductoBusqueda MATCH ${frase} AND p.status = 'ACTIVO'
            AND (p.nombre LIKE ${patron} OR p.codigo LIKE ${patron} OR p.codigoBarras LIKE ${patron} OR p.principioActivo LIKE ${patron})
        `
        : Prisma.sql`
          SELECT id, nombre FROM Producto WHERE status = 'ACTIVO'
            AND (nombre LIKE ${patron} OR codigo LIKE ${patron} OR codigoBarras LIKE ${patron} OR principioActivo LIKE ${patron})
        `;
      return this.prisma.$transaction(async (tx) => {
        // Reutiliza el conjunto encontrado para obtener el total y la página de una misma lectura.
        const filas = await tx.$queryRaw<Array<{ id: string | null; total: bigint }>>`
          WITH coincidencias AS MATERIALIZED (${coincidencias}), pagina AS (
            SELECT id, nombre FROM coincidencias ORDER BY nombre, id LIMIT ${pageSize} OFFSET ${offset}
          )
          SELECT pagina.id, conteo.total
          FROM (SELECT COUNT(*) AS total FROM coincidencias) AS conteo
          LEFT JOIN pagina ON TRUE ORDER BY pagina.nombre, pagina.id
        `;
        const ids = filas.flatMap(({ id }) => id === null ? [] : [id]);
        const productos = await tx.producto.findMany({ where: { id: { in: ids } }, include: incluirParaVenta });
        const porId = new Map(productos.map((producto) => [producto.id, producto]));
        const items = ids.map((id) => porId.get(id)!);
        return { items, total: Number(filas[0]?.total ?? 0), page, pageSize };
      });
    }
    const where = { status: "ACTIVO" };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.producto.findMany({
        where,
        include: incluirParaVenta,
        orderBy: { nombre: "asc" },
        skip: offset,
        take: pageSize,
      }),
      this.prisma.producto.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  create(data: Prisma.ProductoUncheckedCreateInput): Promise<Producto> {
    return this.prisma.producto.create({ data });
  }

  update(id: string, data: Prisma.ProductoUncheckedUpdateInput): Promise<Producto> {
    return this.prisma.producto.update({ where: { id }, data });
  }
}

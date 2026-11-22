// ============================================================
// src/server/services/producto.service.ts
// ============================================================
import type { Producto } from "@prisma/client";
import { PaginacionSchema } from "../../shared/schemas/paginacion.schema";
import { ProductoSchema } from "../../shared/schemas/producto.schema";
import type { ProductoRepository, ResultadoPaginado } from "../repositories/producto.repository";
import { AppError } from "./appError.util";
import { omitUndefined } from "./object.util";
import { parsear } from "./validation.util";

export class ProductoService {
  constructor(private readonly repo: ProductoRepository) {}

  async crear(entrada: unknown): Promise<Producto> {
    const datos = parsear(ProductoSchema, entrada);
    if ((await this.repo.findByCodigo(datos.codigo)) !== null) {
      throw new AppError("DUPLICADO", `Ya existe un producto con código ${datos.codigo}`);
    }
    const margen =
      datos.precioCompra > 0 ? ((datos.precioVenta - datos.precioCompra) / datos.precioCompra) * 100 : 0;
    return this.repo.create({ ...omitUndefined(datos), margen: Math.round(margen * 100) / 100 });
  }

  async obtener(id: string): Promise<Producto> {
    const producto = await this.repo.findById(id);
    if (producto === null) throw new AppError("NO_ENCONTRADO", "Producto no encontrado");
    return producto;
  }

  async actualizar(id: string, entrada: unknown): Promise<Producto> {
    const datos = parsear(ProductoSchema.partial(), entrada);
    await this.obtener(id);
    if (datos.codigo !== undefined) {
      const otro = await this.repo.findByCodigo(datos.codigo);
      if (otro !== null && otro.id !== id) {
        throw new AppError("DUPLICADO", `Ya existe un producto con código ${datos.codigo}`);
      }
    }
    return this.repo.update(id, omitUndefined(datos));
  }

  /** Búsqueda paginada por nombre, código, código de barras o principio activo. */
  buscar(entrada: unknown): Promise<ResultadoPaginado<Producto>> {
    const p = parsear(PaginacionSchema, entrada ?? {});
    return this.repo.buscar({ page: p.page, pageSize: p.pageSize, ...(p.search !== undefined ? { search: p.search } : {}) });
  }

  /** Lookup exacto para el lector de códigos de barras (Semana 14/15). */
  async porCodigoBarras(codigoBarras: string): Promise<Producto> {
    const producto = await this.repo.findByCodigoBarras(codigoBarras);
    if (producto === null) throw new AppError("NO_ENCONTRADO", `Sin producto para el código ${codigoBarras}`);
    return producto;
  }
}

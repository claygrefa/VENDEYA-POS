// ============================================================
// src/server/services/producto.service.ts
// ============================================================
import type { PresentacionProducto, Producto } from "@prisma/client";
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
    await this.validarReferencias(datos.categoriaId, datos.unidadMedidaId);
    await this.validarCodigoBarras(datos.codigoBarras);
    if (datos.requiereLote && datos.tipo !== "BIEN") {
      throw new AppError("VALIDACION", "Solo los bienes con inventario pueden requerir lote");
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
    const actual = await this.obtener(id);
    await this.validarReferencias(datos.categoriaId, datos.unidadMedidaId);
    await this.validarCodigoBarras(datos.codigoBarras, id);
    const tipoFinal = datos.tipo ?? actual.tipo;
    const requiereLoteFinal = datos.requiereLote ?? actual.requiereLote;
    if (requiereLoteFinal && tipoFinal !== "BIEN") {
      throw new AppError("VALIDACION", "Solo los bienes con inventario pueden requerir lote");
    }
    if (datos.requiereLote !== undefined && datos.requiereLote !== actual.requiereLote && actual.stockActual !== 0) {
      throw new AppError(
        "VALIDACION",
        "No se puede cambiar el manejo de lotes con existencias: ajuste el stock a cero y vuelva a ingresarlo"
      );
    }
    if (datos.codigo !== undefined) {
      const otro = await this.repo.findByCodigo(datos.codigo);
      if (otro !== null && otro.id !== id) {
        throw new AppError("DUPLICADO", `Ya existe un producto con código ${datos.codigo}`);
      }
    }
    return this.repo.update(id, omitUndefined(datos));
  }

  /** Búsqueda paginada por nombre, código, código de barras o principio activo. */
  async buscar(entrada: unknown): Promise<ResultadoPaginado<Producto>> {
    const p = parsear(PaginacionSchema, entrada ?? {});
    return this.repo.buscar({ page: p.page, pageSize: p.pageSize, ...(p.search !== undefined ? { search: p.search } : {}) });
  }

  /**
   * Lookup exacto para el lector de códigos de barras: coincide con el código del producto o
   * con el de una de sus presentaciones (`presentacion` indica cuál se escaneó).
   */
  async porCodigoBarras(codigoBarras: string): Promise<Producto & { presentacion: PresentacionProducto | null }> {
    const producto = await this.repo.findByCodigoBarras(codigoBarras);
    if (producto !== null) return { ...producto, presentacion: null };

    const encontrada = await this.repo.findPresentacionPorCodigoBarras(codigoBarras);
    if (encontrada === null) throw new AppError("NO_ENCONTRADO", `Sin producto para el código ${codigoBarras}`);
    const { producto: dueno, ...presentacion } = encontrada;
    return { ...dueno, presentacion };
  }

  private async validarReferencias(categoriaId?: string, unidadMedidaId?: string): Promise<void> {
    if (categoriaId !== undefined && !(await this.repo.categoriaExiste(categoriaId))) {
      throw new AppError("NO_ENCONTRADO", "Categoría no encontrada");
    }
    if (unidadMedidaId !== undefined && !(await this.repo.unidadExiste(unidadMedidaId))) {
      throw new AppError("NO_ENCONTRADO", "Unidad de medida no encontrada");
    }
  }

  private async validarCodigoBarras(codigoBarras: string | null | undefined, ignorarProductoId?: string): Promise<void> {
    if (codigoBarras == null || codigoBarras === "") return;
    if (await this.repo.codigoBarrasEnUso(codigoBarras, ignorarProductoId)) {
      throw new AppError("DUPLICADO", `El código de barras ${codigoBarras} ya está en uso`);
    }
  }
}

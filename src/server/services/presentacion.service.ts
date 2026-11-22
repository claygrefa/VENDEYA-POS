// ============================================================
// src/server/services/presentacion.service.ts — Presentaciones de producto (caja, paquete…)
// ============================================================
import type { PresentacionProducto, PrismaClient } from "@prisma/client";
import { PresentacionActualizarSchema, PresentacionSchema } from "../../shared/schemas/inventario.schema";
import type { Db } from "../repositories/kardex.repository";
import { codigoBarrasEnUso, type PresentacionRepository } from "../repositories/presentacion.repository";
import { AppError } from "./appError.util";
import { omitUndefined } from "./object.util";
import { parsear } from "./validation.util";

export class PresentacionService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly repo: PresentacionRepository
  ) {}

  async crear(productoId: string, entrada: unknown): Promise<PresentacionProducto> {
    const datos = parsear(PresentacionSchema, entrada);
    return this.prisma.$transaction(async (tx) => {
      const producto = await this.repo.producto(tx, productoId);
      if (producto === null) throw new AppError("NO_ENCONTRADO", "Producto no encontrado");
      if (producto.tipo !== "BIEN") {
        throw new AppError("VALIDACION", `"${producto.nombre}" es un servicio: no tiene presentaciones`);
      }
      await this.validarUnicos(tx, productoId, datos.nombre, datos.codigoBarras ?? null);
      return this.repo.crear(tx, {
        productoId,
        nombre: datos.nombre,
        factor: datos.factor,
        codigoBarras: datos.codigoBarras ?? null,
        precioVenta: datos.precioVenta ?? null,
      });
    });
  }

  async listar(productoId: string): Promise<PresentacionProducto[]> {
    if ((await this.repo.producto(this.prisma, productoId)) === null) {
      throw new AppError("NO_ENCONTRADO", "Producto no encontrado");
    }
    return this.repo.listarPorProducto(this.prisma, productoId);
  }

  async actualizar(id: string, entrada: unknown): Promise<PresentacionProducto> {
    const datos = parsear(PresentacionActualizarSchema, entrada);
    return this.prisma.$transaction(async (tx) => {
      const actual = await this.repo.buscarPorId(tx, id);
      if (actual === null) throw new AppError("NO_ENCONTRADO", "Presentación no encontrada");
      await this.validarUnicos(
        tx,
        actual.productoId,
        datos.nombre !== undefined && datos.nombre !== actual.nombre ? datos.nombre : null,
        datos.codigoBarras != null && datos.codigoBarras !== actual.codigoBarras ? datos.codigoBarras : null,
        id
      );
      return this.repo.actualizar(tx, id, omitUndefined(datos));
    });
  }

  /** `null` = no se valida ese campo (no cambió o no se informó). */
  private async validarUnicos(db: Db, productoId: string, nombre: string | null, codigoBarras: string | null, ignorarId?: string): Promise<void> {
    if (nombre !== null && (await this.repo.nombreExiste(db, productoId, nombre, ignorarId)) !== null) {
      throw new AppError("DUPLICADO", `El producto ya tiene una presentación llamada "${nombre}"`);
    }
    if (codigoBarras !== null && (await codigoBarrasEnUso(db, codigoBarras, ignorarId !== undefined ? { presentacionId: ignorarId } : {}))) {
      throw new AppError("DUPLICADO", `El código de barras ${codigoBarras} ya está en uso`);
    }
  }
}

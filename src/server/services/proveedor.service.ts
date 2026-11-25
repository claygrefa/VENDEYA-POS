// ============================================================
// src/server/services/proveedor.service.ts — Proveedores (alta, edición y búsqueda)
// ============================================================
import type { PrismaClient, Proveedor } from "@prisma/client";
import { PaginacionSchema } from "../../shared/schemas/paginacion.schema";
import { ProveedorActualizarSchema, ProveedorSchema } from "../../shared/schemas/gestion.schema";
import type { ResultadoPaginado } from "../repositories/producto.repository";
import { AppError } from "./appError.util";
import { omitUndefined } from "./object.util";
import { parsear } from "./validation.util";

export class ProveedorService {
  constructor(private readonly prisma: PrismaClient) {}

  async crear(entrada: unknown): Promise<Proveedor> {
    const d = parsear(ProveedorSchema, entrada);
    if ((await this.prisma.proveedor.findUnique({ where: { ruc: d.ruc } })) !== null) throw new AppError("DUPLICADO", `Ya existe un proveedor con RUC ${d.ruc}`);
    return this.prisma.proveedor.create({ data: omitUndefined(d) });
  }

  async obtener(id: string): Promise<Proveedor> {
    const p = await this.prisma.proveedor.findUnique({ where: { id } });
    if (p === null) throw new AppError("NO_ENCONTRADO", "Proveedor no encontrado");
    return p;
  }

  async actualizar(id: string, entrada: unknown): Promise<Proveedor> {
    await this.obtener(id);
    const d = parsear(ProveedorActualizarSchema, entrada);
    if (d.ruc !== undefined) {
      const otro = await this.prisma.proveedor.findUnique({ where: { ruc: d.ruc } });
      if (otro !== null && otro.id !== id) throw new AppError("DUPLICADO", `Ya existe un proveedor con RUC ${d.ruc}`);
    }
    return this.prisma.proveedor.update({ where: { id }, data: omitUndefined(d) });
  }

  async buscar(entrada: unknown): Promise<ResultadoPaginado<Proveedor>> {
    const p = parsear(PaginacionSchema, entrada ?? {});
    const texto = p.search;
    const where = texto !== undefined && texto !== "" ? { OR: [{ razonSocial: { contains: texto } }, { ruc: { contains: texto } }, { nombreComercial: { contains: texto } }] } : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.proveedor.findMany({ where, orderBy: { razonSocial: "asc" }, skip: (p.page - 1) * p.pageSize, take: p.pageSize }),
      this.prisma.proveedor.count({ where }),
    ]);
    return { items, total, page: p.page, pageSize: p.pageSize };
  }
}

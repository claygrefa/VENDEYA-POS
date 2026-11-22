// ============================================================
// src/server/repositories/cliente.repository.ts
// ============================================================
import type { Cliente, Prisma, PrismaClient } from "@prisma/client";
import type { FiltroProductos, ResultadoPaginado } from "./producto.repository";

export type FiltroClientes = FiltroProductos;

export class ClienteRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findById(id: string): Promise<Cliente | null> {
    return this.prisma.cliente.findUnique({ where: { id } });
  }

  findByIdentificacion(tipoIdentificacion: string, identificacion: string): Promise<Cliente | null> {
    return this.prisma.cliente.findUnique({
      where: { tipoIdentificacion_identificacion: { tipoIdentificacion, identificacion } },
    });
  }

  async buscar(filtro: FiltroClientes): Promise<ResultadoPaginado<Cliente>> {
    const texto = filtro.search;
    const where: Prisma.ClienteWhereInput = {
      status: "ACTIVO",
      ...(texto !== undefined && texto !== ""
        ? { OR: [{ razonSocial: { contains: texto } }, { identificacion: { contains: texto } }] }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.cliente.findMany({
        where,
        orderBy: { razonSocial: "asc" },
        skip: (filtro.page - 1) * filtro.pageSize,
        take: filtro.pageSize,
      }),
      this.prisma.cliente.count({ where }),
    ]);
    return { items, total, page: filtro.page, pageSize: filtro.pageSize };
  }

  create(data: Prisma.ClienteCreateInput): Promise<Cliente> {
    return this.prisma.cliente.create({ data });
  }

  update(id: string, data: Prisma.ClienteUpdateInput): Promise<Cliente> {
    return this.prisma.cliente.update({ where: { id }, data });
  }
}

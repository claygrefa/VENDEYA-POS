// ============================================================
// src/server/repositories/empresa.repository.ts
// ============================================================
import type { Empresa, Prisma, PrismaClient } from "@prisma/client";

export class EmpresaRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findById(id: string): Promise<Empresa | null> {
    return this.prisma.empresa.findUnique({ where: { id } });
  }

  findByRuc(ruc: string): Promise<Empresa | null> {
    return this.prisma.empresa.findUnique({ where: { ruc } });
  }

  /** Puntos de emisión activos de la empresa con su sucursal (el POS los necesita para abrir turno y vender). */
  puntosEmision(empresaId: string) {
    return this.prisma.puntoEmision.findMany({
      where: { status: "ACTIVO", sucursal: { empresaId, status: "ACTIVO" } },
      select: { id: true, codigo: true, descripcion: true, sucursal: { select: { id: true, codigo: true, nombre: true } } },
      orderBy: [{ sucursal: { codigo: "asc" } }, { codigo: "asc" }],
    });
  }

  create(data: Prisma.EmpresaCreateInput): Promise<Empresa> {
    return this.prisma.empresa.create({ data });
  }

  update(id: string, data: Prisma.EmpresaUpdateInput): Promise<Empresa> {
    return this.prisma.empresa.update({ where: { id }, data });
  }
}

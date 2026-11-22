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

  create(data: Prisma.EmpresaCreateInput): Promise<Empresa> {
    return this.prisma.empresa.create({ data });
  }

  update(id: string, data: Prisma.EmpresaUpdateInput): Promise<Empresa> {
    return this.prisma.empresa.update({ where: { id }, data });
  }
}

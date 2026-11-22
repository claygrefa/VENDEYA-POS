// ============================================================
// src/server/services/empresa.service.ts
// ============================================================
import type { Empresa } from "@prisma/client";
import { EmpresaSchema } from "../../shared/schemas/empresa.schema";
import type { EmpresaRepository } from "../repositories/empresa.repository";
import { AppError } from "./appError.util";
import { omitUndefined } from "./object.util";
import { parsear } from "./validation.util";

export class EmpresaService {
  constructor(private readonly repo: EmpresaRepository) {}

  async registrar(entrada: unknown): Promise<Empresa> {
    const datos = parsear(EmpresaSchema, entrada);
    if ((await this.repo.findByRuc(datos.ruc)) !== null) {
      throw new AppError("DUPLICADO", `Ya existe una empresa con RUC ${datos.ruc}`);
    }
    return this.repo.create(omitUndefined(datos));
  }

  async obtener(id: string): Promise<Empresa> {
    const empresa = await this.repo.findById(id);
    if (empresa === null) throw new AppError("NO_ENCONTRADO", "Empresa no encontrada");
    return empresa;
  }

  async actualizar(id: string, entrada: unknown): Promise<Empresa> {
    const datos = parsear(EmpresaSchema.partial(), entrada);
    await this.obtener(id);
    if (datos.ruc !== undefined) {
      const otra = await this.repo.findByRuc(datos.ruc);
      if (otra !== null && otra.id !== id) {
        throw new AppError("DUPLICADO", `Ya existe una empresa con RUC ${datos.ruc}`);
      }
    }
    return this.repo.update(id, omitUndefined(datos));
  }
}

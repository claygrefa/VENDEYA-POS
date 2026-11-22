// ============================================================
// src/server/services/cliente.service.ts
// ============================================================
import type { Cliente } from "@prisma/client";
import { CONSUMIDOR_FINAL } from "../../shared/constants/sri.constants";
import { ClienteSchema } from "../../shared/schemas/cliente.schema";
import { PaginacionSchema } from "../../shared/schemas/paginacion.schema";
import type { ClienteRepository } from "../repositories/cliente.repository";
import type { ResultadoPaginado } from "../repositories/producto.repository";
import { AppError } from "./appError.util";
import { omitUndefined } from "./object.util";
import { parsear } from "./validation.util";

export class ClienteService {
  constructor(private readonly repo: ClienteRepository) {}

  async crear(entrada: unknown): Promise<Cliente> {
    const datos = parsear(ClienteSchema, entrada);
    if ((await this.repo.findByIdentificacion(datos.tipoIdentificacion, datos.identificacion)) !== null) {
      throw new AppError("DUPLICADO", `Ya existe un cliente con identificación ${datos.identificacion}`);
    }
    return this.repo.create(omitUndefined(datos));
  }

  async obtener(id: string): Promise<Cliente> {
    const cliente = await this.repo.findById(id);
    if (cliente === null) throw new AppError("NO_ENCONTRADO", "Cliente no encontrado");
    return cliente;
  }

  async actualizar(id: string, entrada: unknown): Promise<Cliente> {
    // Se valida el objeto completo fusionado para que la identificación siga siendo coherente con su tipo.
    const actual = await this.obtener(id);
    const fusionado = { ...actual, ...(entrada as Record<string, unknown>) };
    const datos = parsear(ClienteSchema, {
      tipoIdentificacion: fusionado.tipoIdentificacion,
      identificacion: fusionado.identificacion,
      razonSocial: fusionado.razonSocial,
      nombreComercial: fusionado.nombreComercial,
      email: fusionado.email,
      telefono: fusionado.telefono,
      direccion: fusionado.direccion,
      limiteCredito: fusionado.limiteCredito,
      diasCredito: fusionado.diasCredito,
      descuentoHabitual: fusionado.descuentoHabitual,
    });
    const otro = await this.repo.findByIdentificacion(datos.tipoIdentificacion, datos.identificacion);
    if (otro !== null && otro.id !== id) {
      throw new AppError("DUPLICADO", `Ya existe un cliente con identificación ${datos.identificacion}`);
    }
    return this.repo.update(id, omitUndefined(datos));
  }

  buscar(entrada: unknown): Promise<ResultadoPaginado<Cliente>> {
    const p = parsear(PaginacionSchema, entrada ?? {});
    return this.repo.buscar({ page: p.page, pageSize: p.pageSize, ...(p.search !== undefined ? { search: p.search } : {}) });
  }

  async consumidorFinal(): Promise<Cliente> {
    const c = await this.repo.findByIdentificacion(CONSUMIDOR_FINAL.tipoIdentificacion, CONSUMIDOR_FINAL.identificacion);
    if (c === null) throw new AppError("NO_ENCONTRADO", "Cliente Consumidor Final no existe (ejecutar seed)");
    return c;
  }
}

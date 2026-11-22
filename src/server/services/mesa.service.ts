// ============================================================
// src/server/services/mesa.service.ts — Plano de mesas
// ============================================================
import type { Mesa, PrismaClient } from "@prisma/client";
import { FiltroMesasSchema, MesaActualizarSchema, MesaEstadoSchema, MesaSchema } from "../../shared/schemas/restaurante.schema";
import type { MesaRepository } from "../repositories/mesa.repository";
import { AppError } from "./appError.util";
import type { GiroService } from "./giro.service";
import { omitUndefined } from "./object.util";
import type { ActorCaja } from "./turno.service";
import { parsear } from "./validation.util";
import { round2 } from "./ventaCalculo.util";

export interface CuentaAbiertaResumen {
  id: string;
  numero: number;
  meseroId: string | null;
  comensales: number;
  abiertaDesde: Date;
  /** Suma de los ítems vigentes por cobrar (sin IVA) */
  consumo: number;
  items: number;
}

export interface MesaDelPlano {
  id: string;
  sucursalId: string;
  numero: number;
  nombre: string;
  capacidad: number;
  zona: string;
  estado: string;
  cuenta: CuentaAbiertaResumen | null;
}

export class MesaService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly repo: MesaRepository,
    private readonly giro: GiroService
  ) {}

  async crear(entrada: unknown, actor: ActorCaja): Promise<Mesa> {
    const datos = parsear(MesaSchema, entrada);
    await this.giro.exigir(this.prisma, actor.empresaId, "moduloMesas");
    return this.prisma.$transaction(async (tx) => {
      const sucursal = await this.repo.sucursal(tx, datos.sucursalId);
      if (sucursal === null || sucursal.empresaId !== actor.empresaId) throw new AppError("NO_ENCONTRADO", "Sucursal no encontrada");
      if ((await this.repo.numeroExiste(tx, sucursal.id, datos.numero)) !== null) {
        throw new AppError("DUPLICADO", `Ya existe la mesa número ${datos.numero} en la sucursal`);
      }
      return this.repo.crear(tx, datos);
    });
  }

  async actualizar(id: string, entrada: unknown, actor: ActorCaja): Promise<Mesa> {
    const datos = parsear(MesaActualizarSchema, entrada);
    await this.giro.exigir(this.prisma, actor.empresaId, "moduloMesas");
    return this.prisma.$transaction(async (tx) => {
      const mesa = await this.repo.buscarPorId(tx, id, actor.empresaId);
      if (mesa === null) throw new AppError("NO_ENCONTRADO", "Mesa no encontrada");
      if (datos.numero !== undefined && (await this.repo.numeroExiste(tx, mesa.sucursalId, datos.numero, id)) !== null) {
        throw new AppError("DUPLICADO", `Ya existe la mesa número ${datos.numero} en la sucursal`);
      }
      if (datos.status === "INACTIVO" && (await this.repo.tieneCuentaAbierta(tx, id))) {
        throw new AppError("ESTADO_INVALIDO", "No se puede desactivar una mesa con la cuenta abierta");
      }
      return this.repo.actualizar(tx, id, omitUndefined(datos));
    });
  }

  /** Mapa de mesas activas por zona, con el consumo de su cuenta abierta. */
  async listar(entrada: unknown, actor: ActorCaja): Promise<MesaDelPlano[]> {
    const f = parsear(FiltroMesasSchema, entrada ?? {});
    await this.giro.exigir(this.prisma, actor.empresaId, "moduloMesas");
    const mesas = await this.repo.listar(this.prisma, { empresaId: actor.empresaId, ...omitUndefined(f) });
    return mesas.map((m) => {
      const cuenta = m.comandas[0];
      return {
        id: m.id,
        sucursalId: m.sucursalId,
        numero: m.numero,
        nombre: m.nombre,
        capacidad: m.capacidad,
        zona: m.zona,
        estado: m.estado,
        cuenta:
          cuenta === undefined
            ? null
            : {
                id: cuenta.id,
                numero: cuenta.numero,
                meseroId: cuenta.meseroId,
                comensales: cuenta.comensales,
                abiertaDesde: cuenta.createdAt,
                consumo: round2(cuenta.items.reduce((acc, i) => acc + i.total, 0)),
                items: cuenta.items.length,
              },
      };
    });
  }

  /** Marca una mesa sin cuenta como LIBRE o RESERVADA. La OCUPADA solo la gestiona la apertura/cierre de cuentas. */
  async cambiarEstado(id: string, entrada: unknown, actor: ActorCaja): Promise<Mesa> {
    const { estado } = parsear(MesaEstadoSchema, entrada);
    await this.giro.exigir(this.prisma, actor.empresaId, "moduloMesas");
    return this.prisma.$transaction(async (tx) => {
      const mesa = await this.repo.buscarPorId(tx, id, actor.empresaId);
      if (mesa === null) throw new AppError("NO_ENCONTRADO", "Mesa no encontrada");
      if (mesa.status !== "ACTIVO") throw new AppError("ESTADO_INVALIDO", "La mesa está inactiva");
      if (await this.repo.tieneCuentaAbierta(tx, id)) {
        throw new AppError("ESTADO_INVALIDO", "La mesa tiene una cuenta abierta: ciérrela o anúlela primero");
      }
      return this.repo.actualizar(tx, id, { estado });
    });
  }
}

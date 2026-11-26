// ============================================================
// src/server/services/sucursal.service.ts — Sucursales (establecimientos) y puntos de emisión (cajas)
//
//   · El código (001, 002…) se asigna solo, es consecutivo y NO se cambia ni se reutiliza: es parte de la serie de los comprobantes
//     electrónicos y de la clave de acceso. Para el SRI el establecimiento debe estar registrado en el RUC antes de facturar con él.
//   · Nada se borra: se desactiva. Una sucursal o un punto desactivados dejan de ofrecerse para abrir turno y vender, pero su historia
//     (ventas, comprobantes, secuenciales) queda intacta.
//   · La empresa siempre conserva al menos un punto de emisión activo en una sucursal activa, y no se desactiva una sucursal con turnos
//     de caja o cuentas de mesa abiertos.
// ============================================================
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  ActualizarPuntoEmisionSchema, ActualizarSucursalSchema, EstadoSucursalSchema, NuevaSucursalSchema, NuevoPuntoEmisionSchema,
} from "../../shared/schemas/sucursal.schema";
import { AppError } from "./appError.util";
import { omitUndefined } from "./object.util";
import { parsear } from "./validation.util";

export interface ActorEmpresa {
  empresaId: string;
}

export interface PuntoEmisionDetalle {
  id: string;
  codigo: string;
  descripcion: string;
  estado: string;
}

export interface SucursalDetalle {
  id: string;
  codigo: string;
  nombre: string;
  direccion: string;
  telefono: string;
  estado: string;
  /** Turnos de caja abiertos ahora mismo en la sucursal */
  turnosAbiertos: number;
  puntosEmision: PuntoEmisionDetalle[];
}

const incluir = {
  puntosEmision: { orderBy: { codigo: "asc" } },
  _count: { select: { turnos: { where: { estado: "ABIERTO" } } } },
} satisfies Prisma.SucursalInclude;
type SucursalConPuntos = Prisma.SucursalGetPayload<{ include: typeof incluir }>;

/** Siguiente código de tres cifras a partir de los existentes (nunca reutiliza el de una sucursal o punto desactivado). */
export function siguienteCodigo(existentes: ReadonlyArray<string>): string {
  const mayor = existentes.reduce((m, c) => Math.max(m, Number.parseInt(c, 10) || 0), 0);
  if (mayor >= 999) throw new AppError("ESTADO_INVALIDO", "Se alcanzó el máximo de 999 códigos");
  return String(mayor + 1).padStart(3, "0");
}

function aDetalle(s: SucursalConPuntos): SucursalDetalle {
  return {
    id: s.id,
    codigo: s.codigo,
    nombre: s.nombre,
    direccion: s.direccion,
    telefono: s.telefono,
    estado: s.status,
    turnosAbiertos: s._count.turnos,
    puntosEmision: s.puntosEmision.map((p) => ({ id: p.id, codigo: p.codigo, descripcion: p.descripcion, estado: p.status })),
  };
}

export class SucursalService {
  constructor(private readonly prisma: PrismaClient) {}

  private async obtener(actor: ActorEmpresa, id: string): Promise<SucursalConPuntos> {
    const s = await this.prisma.sucursal.findFirst({ where: { id, empresaId: actor.empresaId }, include: incluir });
    if (s === null) throw new AppError("NO_ENCONTRADO", "Sucursal no encontrada");
    return s;
  }

  async listar(actor: ActorEmpresa): Promise<{ items: SucursalDetalle[] }> {
    const filas = await this.prisma.sucursal.findMany({ where: { empresaId: actor.empresaId }, include: incluir, orderBy: { codigo: "asc" } });
    return { items: filas.map(aDetalle) };
  }

  /** Crea la sucursal con su primer punto de emisión («Caja principal»), para que pueda operar desde el primer momento. */
  async crear(actor: ActorEmpresa, entrada: unknown): Promise<SucursalDetalle> {
    const datos = parsear(NuevaSucursalSchema, entrada);
    const id = await this.prisma.$transaction(async (tx) => {
      const codigos = (await tx.sucursal.findMany({ where: { empresaId: actor.empresaId }, select: { codigo: true } })).map((s) => s.codigo);
      const s = await tx.sucursal.create({
        data: {
          empresaId: actor.empresaId,
          codigo: siguienteCodigo(codigos),
          nombre: datos.nombre,
          direccion: datos.direccion,
          telefono: datos.telefono,
          puntosEmision: { create: { codigo: "001", descripcion: "Caja principal" } },
        },
      });
      return s.id;
    });
    return aDetalle(await this.obtener(actor, id));
  }

  async actualizar(actor: ActorEmpresa, id: string, entrada: unknown): Promise<SucursalDetalle> {
    const datos = parsear(ActualizarSucursalSchema, entrada);
    await this.obtener(actor, id);
    await this.prisma.sucursal.update({ where: { id }, data: omitUndefined(datos) });
    return aDetalle(await this.obtener(actor, id));
  }

  async cambiarEstado(actor: ActorEmpresa, id: string, entrada: unknown): Promise<SucursalDetalle> {
    const { estado } = parsear(EstadoSucursalSchema, entrada);
    const s = await this.obtener(actor, id);
    if (s.status === estado) return aDetalle(s);
    if (estado === "INACTIVO") {
      if (s._count.turnos > 0) throw new AppError("ESTADO_INVALIDO", "La sucursal tiene turnos de caja abiertos: ciérrelos antes de desactivarla");
      const cuentas = await this.prisma.comanda.count({ where: { sucursalId: id, estado: "ABIERTA" } });
      if (cuentas > 0) throw new AppError("ESTADO_INVALIDO", "La sucursal tiene cuentas de mesa abiertas: cóbrelas o anúlelas antes de desactivarla");
      await this.exigirOtroPuntoActivo(actor, { sucursalId: id }, "desactivar la sucursal");
    }
    await this.prisma.sucursal.update({ where: { id }, data: { status: estado } });
    return aDetalle(await this.obtener(actor, id));
  }

  async crearPunto(actor: ActorEmpresa, sucursalId: string, entrada: unknown): Promise<SucursalDetalle> {
    const datos = parsear(NuevoPuntoEmisionSchema, entrada);
    const s = await this.obtener(actor, sucursalId);
    await this.prisma.puntoEmision.create({ data: { sucursalId, codigo: siguienteCodigo(s.puntosEmision.map((p) => p.codigo)), descripcion: datos.descripcion } });
    return aDetalle(await this.obtener(actor, sucursalId));
  }

  async actualizarPunto(actor: ActorEmpresa, id: string, entrada: unknown): Promise<SucursalDetalle> {
    const datos = parsear(ActualizarPuntoEmisionSchema, entrada);
    const punto = await this.prisma.puntoEmision.findFirst({ where: { id, sucursal: { empresaId: actor.empresaId } } });
    if (punto === null) throw new AppError("NO_ENCONTRADO", "Punto de emisión no encontrado");
    if (datos.estado === "INACTIVO" && punto.status === "ACTIVO") {
      await this.exigirOtroPuntoActivo(actor, { puntoId: id }, "desactivar el punto de emisión");
    }
    await this.prisma.puntoEmision.update({
      where: { id },
      data: {
        ...(datos.descripcion !== undefined ? { descripcion: datos.descripcion } : {}),
        ...(datos.estado !== undefined ? { status: datos.estado } : {}),
      },
    });
    return aDetalle(await this.obtener(actor, punto.sucursalId));
  }

  /** Tras desactivar lo indicado debe quedar al menos un punto activo en una sucursal activa (si no, no se podría vender). */
  private async exigirOtroPuntoActivo(actor: ActorEmpresa, excluir: { sucursalId?: string; puntoId?: string }, accion: string): Promise<void> {
    const restantes = await this.prisma.puntoEmision.count({
      where: {
        status: "ACTIVO",
        sucursal: { empresaId: actor.empresaId, status: "ACTIVO", ...(excluir.sucursalId !== undefined ? { id: { not: excluir.sucursalId } } : {}) },
        ...(excluir.puntoId !== undefined ? { id: { not: excluir.puntoId } } : {}),
      },
    });
    if (restantes === 0) throw new AppError("ESTADO_INVALIDO", `No se puede ${accion}: la empresa se quedaría sin ningún punto de emisión activo para vender`);
  }
}

// ============================================================
// src/server/services/consulta.service.ts — Listados para las vistas de gestión: ventas, compras y catálogos
// ============================================================
import type { Prisma, PrismaClient } from "@prisma/client";
import { FiltroComprasSchema, FiltroVentasSchema } from "../../shared/schemas/gestion.schema";
import type { ResultadoPaginado } from "../repositories/producto.repository";
import { esSupervisor, type ActorCaja } from "./turno.service";
import { parsear } from "./validation.util";

const DIA_MS = 86_400_000;
const OFFSET_ECUADOR_MS = 5 * 3_600_000;

/** `2024-05-10` → inicio de ese día en Ecuador (UTC−5), expresado en UTC. */
export function inicioDiaEcuador(fecha: string): Date {
  const [a, m, d] = fecha.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(a, m - 1, d) + OFFSET_ECUADOR_MS);
}

/** Rango [desde, hasta+1 día) en UTC para filtrar por fechas civiles de Ecuador. */
export function rangoFechas(desde?: string, hasta?: string): { gte?: Date; lt?: Date } {
  return {
    ...(desde !== undefined ? { gte: inicioDiaEcuador(desde) } : {}),
    ...(hasta !== undefined ? { lt: new Date(inicioDiaEcuador(hasta).getTime() + DIA_MS) } : {}),
  };
}

export interface VentaListada {
  id: string;
  numero: string;
  createdAt: Date;
  estado: string;
  total: number;
  propina: number;
  clienteNombre: string | null;
  cajero: string;
  turnoId: string;
  comprobante: { id: string; estado: string } | null;
}

export interface CompraListada {
  id: string;
  numeroFactura: string;
  fecha: Date;
  proveedor: string;
  formaPago: string;
  total: number;
  estado: string;
  tipoDocumento: string;
}

export class ConsultaService {
  constructor(private readonly prisma: PrismaClient) {}

  /** Ventas de la empresa; quien no es supervisor solo ve las suyas. */
  async ventas(entrada: unknown, actor: ActorCaja): Promise<ResultadoPaginado<VentaListada>> {
    const f = parsear(FiltroVentasSchema, entrada ?? {});
    const rango = rangoFechas(f.desde, f.hasta);
    const where: Prisma.VentaWhereInput = {
      sucursal: { empresaId: actor.empresaId },
      ...(esSupervisor(actor) ? {} : { cajeroId: actor.id }),
      ...(f.turnoId !== undefined ? { turnoId: f.turnoId } : {}),
      ...(f.estado !== undefined ? { estado: f.estado } : {}),
      ...(rango.gte !== undefined || rango.lt !== undefined ? { createdAt: rango } : {}),
      ...(f.search !== undefined && f.search !== "" ? { OR: [{ numero: { contains: f.search } }, { clienteNombre: { contains: f.search } }] } : {}),
    };
    const [filas, total] = await this.prisma.$transaction([
      this.prisma.venta.findMany({
        where,
        select: {
          id: true, numero: true, createdAt: true, estado: true, total: true, propina: true, clienteNombre: true, turnoId: true,
          cajero: { select: { nombre: true, apellido: true } },
          comprobante: { select: { id: true, estado: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (f.page - 1) * f.pageSize,
        take: f.pageSize,
      }),
      this.prisma.venta.count({ where }),
    ]);
    const items = filas.map((v) => ({ id: v.id, numero: v.numero, createdAt: v.createdAt, estado: v.estado, total: v.total, propina: v.propina, clienteNombre: v.clienteNombre, cajero: `${v.cajero.nombre} ${v.cajero.apellido}`.trim(), turnoId: v.turnoId, comprobante: v.comprobante }));
    return { items, total, page: f.page, pageSize: f.pageSize };
  }

  async compras(entrada: unknown, actor: ActorCaja): Promise<ResultadoPaginado<CompraListada>> {
    const f = parsear(FiltroComprasSchema, entrada ?? {});
    const rango = rangoFechas(f.desde, f.hasta);
    const where: Prisma.CompraWhereInput = {
      sucursal: { empresaId: actor.empresaId },
      ...(rango.gte !== undefined || rango.lt !== undefined ? { fecha: rango } : {}),
      ...(f.search !== undefined && f.search !== "" ? { OR: [{ numeroFactura: { contains: f.search } }, { proveedor: { razonSocial: { contains: f.search } } }] } : {}),
    };
    const [filas, total] = await this.prisma.$transaction([
      this.prisma.compra.findMany({ where, include: { proveedor: { select: { razonSocial: true } } }, orderBy: { fecha: "desc" }, skip: (f.page - 1) * f.pageSize, take: f.pageSize }),
      this.prisma.compra.count({ where }),
    ]);
    const items = filas.map((c) => ({ id: c.id, numeroFactura: c.numeroFactura, fecha: c.fecha, proveedor: c.proveedor.razonSocial, formaPago: c.formaPago, total: c.total, estado: c.estado, tipoDocumento: c.tipoDocumento }));
    return { items, total, page: f.page, pageSize: f.pageSize };
  }

  /** Categorías y unidades de medida activas (para los formularios de producto). */
  async catalogos(): Promise<{ categorias: Array<{ id: string; nombre: string }>; unidades: Array<{ id: string; codigo: string; nombre: string; permiteDecimales: boolean }> }> {
    const [categorias, unidades] = await Promise.all([
      this.prisma.categoria.findMany({ where: { status: "ACTIVO" }, select: { id: true, nombre: true }, orderBy: { nombre: "asc" } }),
      this.prisma.unidadMedida.findMany({ where: { status: "ACTIVO" }, select: { id: true, codigo: true, nombre: true, permiteDecimales: true }, orderBy: { nombre: "asc" } }),
    ]);
    return { categorias, unidades };
  }
}

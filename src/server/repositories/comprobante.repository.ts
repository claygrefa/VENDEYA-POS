// ============================================================
// src/server/repositories/comprobante.repository.ts — Comprobantes electrónicos y su cola de envío
// ============================================================
import type { ColaSRI, ComprobanteElectronico, Prisma } from "@prisma/client";
import type { Db } from "./kardex.repository";
import type { ResultadoPaginado } from "./producto.repository";

/** Todo lo que hace falta para generar el XML de una venta. */
const incluirParaEmision = {
  lineas: { include: { producto: { select: { codigo: true, unidadMedida: { select: { nombre: true } } } } } },
  pagos: true,
  cliente: true,
  cuentaPorCobrar: { select: { fechaEmision: true, fechaVencimiento: true } },
  puntoEmision: true,
  sucursal: { include: { empresa: true } },
  comprobante: true,
} satisfies Prisma.VentaInclude;

export type VentaParaEmision = Prisma.VentaGetPayload<{ include: typeof incluirParaEmision }>;

const incluirDetalle = {
  colaSRI: true,
  origen: { select: { id: true, claveAcceso: true, serie: true, secuencial: true, tipoComprobante: true } },
} satisfies Prisma.ComprobanteElectronicoInclude;

export type ComprobanteDetalle = Prisma.ComprobanteElectronicoGetPayload<{ include: typeof incluirDetalle }>;

/** Campos del listado: todo menos los XML (pueden pesar decenas de KB; se consultan por id). */
const seleccionResumen = {
  id: true, ventaId: true, empresaId: true, sucursalId: true, puntoEmisionId: true, claveAcceso: true,
  tipoComprobante: true, ambiente: true, serie: true, secuencial: true, fechaEmision: true, estado: true,
  numeroAutorizacion: true, fechaAutorizacion: true, mensajesRespuesta: true, intentosEnvio: true, proximoIntento: true,
  motivo: true, comprobanteOrigenId: true, createdAt: true, updatedAt: true,
  colaSRI: true,
  origen: { select: { id: true, claveAcceso: true, serie: true, secuencial: true, tipoComprobante: true } },
} satisfies Prisma.ComprobanteElectronicoSelect;

export type ComprobanteResumen = Prisma.ComprobanteElectronicoGetPayload<{ select: typeof seleccionResumen }>;

export interface NuevoComprobante {
  ventaId: string | null;
  empresaId: string;
  sucursalId: string;
  puntoEmisionId: string;
  claveAcceso: string;
  tipoComprobante: string;
  ambiente: string;
  serie: string;
  secuencial: string;
  fechaEmision: Date;
  xmlGenerado: string;
  motivo: string | null;
  comprobanteOrigenId: string | null;
}

export interface FiltroComprobantes {
  empresaId: string;
  page: number;
  pageSize: number;
  estado?: string;
  tipoComprobante?: string;
}

export class ComprobanteRepository {
  ventaParaEmision(db: Db, ventaId: string, empresaId: string): Promise<VentaParaEmision | null> {
    return db.venta.findFirst({ where: { id: ventaId, sucursal: { empresaId } }, include: incluirParaEmision });
  }

  /** Próximo secuencial (sin reservarlo): permite generar y validar el XML antes de escribir nada. */
  async siguienteSecuencial(db: Db, puntoEmisionId: string, tipoComprobante: string): Promise<number> {
    const fila = await db.secuencialComprobante.findUnique({ where: { puntoEmisionId_tipoComprobante: { puntoEmisionId, tipoComprobante } } });
    return (fila?.ultimo ?? 0) + 1;
  }

  /** Reserva atómicamente el siguiente secuencial y lo devuelve. */
  async reservarSecuencial(db: Db, puntoEmisionId: string, tipoComprobante: string): Promise<number> {
    const fila = await db.secuencialComprobante.upsert({
      where: { puntoEmisionId_tipoComprobante: { puntoEmisionId, tipoComprobante } },
      update: { ultimo: { increment: 1 } },
      create: { puntoEmisionId, tipoComprobante, ultimo: 1 },
    });
    return fila.ultimo;
  }

  crear(db: Db, c: NuevoComprobante): Promise<ComprobanteElectronico> {
    return db.comprobanteElectronico.create({ data: c });
  }

  crearCola(db: Db, comprobanteId: string, prioridad = 5): Promise<ColaSRI> {
    return db.colaSRI.create({ data: { comprobanteId, prioridad } });
  }

  async marcarAnulado(db: Db, id: string): Promise<void> {
    await db.colaSRI.deleteMany({ where: { comprobanteId: id } });
    await db.comprobanteElectronico.update({ where: { id }, data: { estado: "ANULADO", proximoIntento: null } });
  }

  /**
   * Guarda el XML firmado solo si el comprobante sigue en uno de los estados permitidos (evita pisar un envío en curso).
   * Devuelve false si el estado cambió entre la lectura y la escritura.
   */
  async guardarXmlFirmado(db: Db, id: string, xmlFirmado: string, estadosPermitidos: readonly string[]): Promise<boolean> {
    const r = await db.comprobanteElectronico.updateMany({ where: { id, estado: { in: [...estadosPermitidos] } }, data: { xmlFirmado } });
    return r.count === 1;
  }

  /** Asigna (o corrige) el comprador de una venta antes de emitir su factura. */
  async asignarClienteAVenta(db: Db, ventaId: string, cliente: { id: string; identificacion: string; razonSocial: string }): Promise<void> {
    await db.venta.update({
      where: { id: ventaId },
      data: { clienteId: cliente.id, clienteRuc: cliente.identificacion, clienteNombre: cliente.razonSocial },
    });
  }

  buscarCliente(db: Db, id: string): Promise<{ id: string; identificacion: string; razonSocial: string; status: string } | null> {
    return db.cliente.findUnique({ where: { id }, select: { id: true, identificacion: true, razonSocial: true, status: true } });
  }

  buscarPorId(db: Db, id: string, empresaId: string): Promise<ComprobanteDetalle | null> {
    return db.comprobanteElectronico.findFirst({ where: { id, empresaId }, include: incluirDetalle });
  }

  async listar(db: Db, f: FiltroComprobantes): Promise<ResultadoPaginado<ComprobanteResumen>> {
    const where: Prisma.ComprobanteElectronicoWhereInput = {
      empresaId: f.empresaId,
      ...(f.estado !== undefined ? { estado: f.estado } : {}),
      ...(f.tipoComprobante !== undefined ? { tipoComprobante: f.tipoComprobante } : {}),
    };
    const [items, total] = await Promise.all([
      db.comprobanteElectronico.findMany({
        where,
        select: seleccionResumen,
        orderBy: { createdAt: "desc" },
        skip: (f.page - 1) * f.pageSize,
        take: f.pageSize,
      }),
      db.comprobanteElectronico.count({ where }),
    ]);
    return { items, total, page: f.page, pageSize: f.pageSize };
  }
}

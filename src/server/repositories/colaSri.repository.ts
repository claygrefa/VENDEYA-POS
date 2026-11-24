// ============================================================
// src/server/repositories/colaSri.repository.ts — Cola de envíos al SRI (ColaSRI) y estado de los comprobantes
// ============================================================
import type { ComprobanteElectronico, Prisma } from "@prisma/client";
import type { Db } from "./kardex.repository";

export interface ResultadoFinal {
  estado: "AUTORIZADO" | "RECHAZADO" | "DEVUELTO";
  mensajesRespuesta: string | null;
  xmlAutorizado?: string | null;
  numeroAutorizacion?: string | null;
  fechaAutorizacion?: Date | null;
}

export interface ItemCola {
  id: string;
  claveAcceso: string;
  tipoComprobante: string;
  serie: string;
  secuencial: string;
  estado: string;
  fechaEmision: Date;
  intentos: number;
  ultimoError: string | null;
  proximoIntento: Date | null;
  ultimoIntentoAt: Date | null;
}

export interface EstadoCola {
  /** Cantidad de comprobantes de la empresa por estado */
  porEstado: Record<string, number>;
  /** Comprobantes aún en la cola (más antiguos primero) */
  pendientes: ItemCola[];
}

export class ColaSriRepository {
  /** Ids de los comprobantes listos para enviar: en cola, PENDIENTES, sin reintento diferido y sin otro proceso encima. */
  async listosParaEnviar(db: Db, ahora: Date, limite: number): Promise<string[]> {
    const filas = await db.colaSRI.findMany({
      where: {
        procesandoDesde: null,
        comprobante: { estado: "PENDIENTE", OR: [{ proximoIntento: null }, { proximoIntento: { lte: ahora } }] },
      },
      // Orden de la ficha (9.18): por prioridad y, dentro de ella, cronológico por fecha de emisión
      orderBy: [{ prioridad: "asc" }, { comprobante: { fechaEmision: "asc" } }, { createdAt: "asc" }],
      take: limite,
      select: { comprobanteId: true },
    });
    return filas.map((f) => f.comprobanteId);
  }

  /** Toma el comprobante para enviarlo (PENDIENTE → EN_PROCESO). false si otro proceso se adelantó o ya no está pendiente. */
  async reclamar(db: Db, comprobanteId: string, ahora: Date): Promise<boolean> {
    const cola = await db.colaSRI.updateMany({
      where: { comprobanteId, procesandoDesde: null },
      data: { procesandoDesde: ahora, ultimoIntentoAt: ahora, intentos: { increment: 1 } },
    });
    if (cola.count !== 1) return false;
    const c = await db.comprobanteElectronico.updateMany({
      where: { id: comprobanteId, estado: "PENDIENTE" },
      data: { estado: "EN_PROCESO", intentosEnvio: { increment: 1 } },
    });
    if (c.count !== 1) {
      await db.colaSRI.updateMany({ where: { comprobanteId }, data: { procesandoDesde: null, intentos: { decrement: 1 } } });
      return false;
    }
    return true;
  }

  /** Devuelve el comprobante a PENDIENTE para reintentarlo más tarde. */
  async liberar(db: Db, comprobanteId: string, error: string, proximoIntento: Date): Promise<void> {
    await db.comprobanteElectronico.updateMany({ where: { id: comprobanteId, estado: { in: ["EN_PROCESO", "PENDIENTE"] } }, data: { estado: "PENDIENTE", proximoIntento } });
    await db.colaSRI.updateMany({ where: { comprobanteId }, data: { procesandoDesde: null, ultimoError: error.slice(0, 500) } });
  }

  /** Falla antes de enviar (p. ej. sin certificado): cuenta el intento sin haber tomado el comprobante. */
  async registrarFalloPrevio(db: Db, comprobanteId: string, error: string, ahora: Date, proximoIntento: Date): Promise<void> {
    await db.comprobanteElectronico.updateMany({ where: { id: comprobanteId, estado: "PENDIENTE" }, data: { proximoIntento, intentosEnvio: { increment: 1 } } });
    await db.colaSRI.updateMany({
      where: { comprobanteId },
      data: { ultimoError: error.slice(0, 500), ultimoIntentoAt: ahora, intentos: { increment: 1 } },
    });
  }

  /** Estado definitivo (AUTORIZADO, RECHAZADO o DEVUELTO): sale de la cola. */
  async finalizar(db: Db, comprobanteId: string, r: ResultadoFinal): Promise<void> {
    await db.comprobanteElectronico.update({
      where: { id: comprobanteId },
      data: {
        estado: r.estado,
        proximoIntento: null,
        mensajesRespuesta: r.mensajesRespuesta,
        ...(r.xmlAutorizado !== undefined ? { xmlAutorizado: r.xmlAutorizado } : {}),
        ...(r.numeroAutorizacion !== undefined ? { numeroAutorizacion: r.numeroAutorizacion } : {}),
        ...(r.fechaAutorizacion !== undefined ? { fechaAutorizacion: r.fechaAutorizacion } : {}),
      },
    });
    await db.colaSRI.deleteMany({ where: { comprobanteId } });
  }

  /**
   * Libera los comprobantes que quedaron EN_PROCESO (corte de energía o cierre a mitad de un envío).
   * `antesDe` null = todos (arranque, cuando ningún envío puede estar en curso); si no, solo los más viejos que esa fecha.
   */
  async recuperarEnProceso(db: Db, antesDe: Date | null): Promise<number> {
    const filas = await db.colaSRI.findMany({
      where: { procesandoDesde: antesDe === null ? { not: null } : { not: null, lt: antesDe } },
      select: { comprobanteId: true },
    });
    for (const f of filas) {
      await db.comprobanteElectronico.updateMany({ where: { id: f.comprobanteId, estado: "EN_PROCESO" }, data: { estado: "PENDIENTE", proximoIntento: null } });
      await db.colaSRI.updateMany({ where: { comprobanteId: f.comprobanteId }, data: { procesandoDesde: null, ultimoError: "Envío interrumpido: se reintentará" } });
    }
    return filas.length;
  }

  buscar(db: Db, id: string, empresaId: string): Promise<(ComprobanteElectronico & { colaSRI: { id: string } | null }) | null> {
    return db.comprobanteElectronico.findFirst({ where: { id, empresaId }, include: { colaSRI: { select: { id: true } } } });
  }

  /** Deja el comprobante listo para enviarse ya: PENDIENTE, sin espera y con un registro de cola reiniciado. */
  async reiniciar(db: Db, comprobanteId: string, descartarFirma: boolean): Promise<void> {
    await db.comprobanteElectronico.update({
      where: { id: comprobanteId },
      data: { estado: "PENDIENTE", proximoIntento: null, ...(descartarFirma ? { xmlFirmado: null } : {}) },
    });
    await db.colaSRI.upsert({
      where: { comprobanteId },
      create: { comprobanteId },
      update: { intentos: 0, ultimoError: null, procesandoDesde: null },
    });
  }

  async estado(db: Db, empresaId: string, limite: number): Promise<EstadoCola> {
    const grupos = await db.comprobanteElectronico.groupBy({ by: ["estado"], where: { empresaId }, _count: { _all: true } });
    const porEstado: Record<string, number> = {};
    for (const g of grupos) porEstado[g.estado] = g._count._all;

    const filas = await db.colaSRI.findMany({
      where: { comprobante: { empresaId } },
      orderBy: [{ prioridad: "asc" }, { comprobante: { fechaEmision: "asc" } }],
      take: limite,
      include: { comprobante: { select: { claveAcceso: true, tipoComprobante: true, serie: true, secuencial: true, estado: true, fechaEmision: true, proximoIntento: true } } },
    } satisfies Prisma.ColaSRIFindManyArgs);
    const pendientes: ItemCola[] = filas.map((f) => ({
      id: f.comprobanteId,
      claveAcceso: f.comprobante.claveAcceso,
      tipoComprobante: f.comprobante.tipoComprobante,
      serie: f.comprobante.serie,
      secuencial: f.comprobante.secuencial,
      estado: f.comprobante.estado,
      fechaEmision: f.comprobante.fechaEmision,
      intentos: f.intentos,
      ultimoError: f.ultimoError,
      proximoIntento: f.comprobante.proximoIntento,
      ultimoIntentoAt: f.ultimoIntentoAt,
    }));
    return { porEstado, pendientes };
  }
}

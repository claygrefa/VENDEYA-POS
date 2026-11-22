// ============================================================
// src/server/repositories/comanda.repository.ts — Cuentas de mesa, ítems y cobros
// ============================================================
import type { CobroComanda, ItemComanda, Mesa, Prisma, Producto, PuntoEmision, TarifaImpuesto, UnidadMedida } from "@prisma/client";
import type { Db } from "./kardex.repository";

const incluirDetalle = {
  mesa: { select: { id: true, numero: true, nombre: true, zona: true } },
  items: { include: { producto: { select: { id: true, codigo: true, nombre: true } } }, orderBy: { createdAt: "asc" } },
  cobros: { orderBy: { createdAt: "asc" } },
} satisfies Prisma.ComandaInclude;

export type ComandaDetalle = Prisma.ComandaGetPayload<{ include: typeof incluirDetalle }>;
export type ProductoDeMenu = Producto & { unidadMedida: UnidadMedida; tarifaImpuesto: TarifaImpuesto | null };

const incluirCocina = {
  producto: { select: { id: true, codigo: true, nombre: true } },
  comanda: { select: { id: true, numero: true, sucursalId: true, mesa: { select: { nombre: true, zona: true } } } },
} satisfies Prisma.ItemComandaInclude;

export type ItemDeCocina = Prisma.ItemComandaGetPayload<{ include: typeof incluirCocina }>;

export interface FiltroComandas {
  empresaId: string;
  estado?: string;
  sucursalId?: string;
  mesaId?: string;
}

export class ComandaRepository {
  // ── Mesas y referencias ──────────────────────────────────
  mesa(db: Db, id: string, empresaId: string): Promise<Mesa | null> {
    return db.mesa.findFirst({ where: { id, sucursal: { empresaId } } });
  }

  actualizarEstadoMesa(db: Db, id: string, estado: "LIBRE" | "OCUPADA" | "RESERVADA"): Promise<Mesa> {
    return db.mesa.update({ where: { id }, data: { estado } });
  }

  async usuarioDeEmpresa(db: Db, id: string, empresaId: string): Promise<boolean> {
    return (await db.usuario.count({ where: { id, empresaId, status: "ACTIVO" } })) > 0;
  }

  puntoEmision(db: Db, id: string): Promise<PuntoEmision | null> {
    return db.puntoEmision.findUnique({ where: { id } });
  }

  productosDeMenu(db: Db, ids: string[]): Promise<ProductoDeMenu[]> {
    return db.producto.findMany({ where: { id: { in: ids } }, include: { unidadMedida: true, tarifaImpuesto: true } });
  }

  async tarifasIva(db: Db, empresaId: string): Promise<Map<string, number>> {
    const tarifas = await db.tarifaImpuesto.findMany({ where: { empresaId, tipoImpuesto: "IVA", vigente: true } });
    return new Map(tarifas.map((t) => [t.codigo, t.porcentaje]));
  }

  // ── Comandas ─────────────────────────────────────────────
  /** Incrementa y devuelve el consecutivo de comanda de la sucursal. */
  async reservarNumero(db: Db, sucursalId: string): Promise<number> {
    const s = await db.sucursal.update({ where: { id: sucursalId }, data: { secuencialComanda: { increment: 1 } } });
    return s.secuencialComanda;
  }

  async comandaAbiertaDeMesa(db: Db, mesaId: string): Promise<{ id: string } | null> {
    return db.comanda.findFirst({ where: { mesaId, estado: "ABIERTA" }, select: { id: true } });
  }

  async crear(
    db: Db,
    data: { sucursalId: string; numero: number; mesaId: string; meseroId: string; comensales: number; observaciones: string | null }
  ): Promise<{ id: string }> {
    return db.comanda.create({ data, select: { id: true } });
  }

  buscarPorId(db: Db, id: string, empresaId: string): Promise<ComandaDetalle | null> {
    return db.comanda.findFirst({ where: { id, sucursal: { empresaId } }, include: incluirDetalle });
  }

  listar(db: Db, f: FiltroComandas): Promise<ComandaDetalle[]> {
    return db.comanda.findMany({
      where: {
        sucursal: { empresaId: f.empresaId },
        ...(f.estado !== undefined ? { estado: f.estado } : {}),
        ...(f.sucursalId !== undefined ? { sucursalId: f.sucursalId } : {}),
        ...(f.mesaId !== undefined ? { mesaId: f.mesaId } : {}),
      },
      include: incluirDetalle,
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  }

  actualizar(db: Db, id: string, data: Prisma.ComandaUncheckedUpdateInput): Promise<{ id: string }> {
    return db.comanda.update({ where: { id }, data, select: { id: true } });
  }

  // ── Ítems ────────────────────────────────────────────────
  crearItem(db: Db, data: Prisma.ItemComandaUncheckedCreateInput): Promise<ItemComanda> {
    return db.itemComanda.create({ data });
  }

  actualizarItem(db: Db, id: string, data: Prisma.ItemComandaUncheckedUpdateInput): Promise<ItemComanda> {
    return db.itemComanda.update({ where: { id }, data });
  }

  async maxEnvio(db: Db, comandaId: string): Promise<number> {
    const r = await db.itemComanda.aggregate({ where: { comandaId }, _max: { envio: true } });
    return r._max.envio ?? 0;
  }

  /** Pasa a EN_PREPARACION todos los ítems PENDIENTE de la cuenta. Devuelve cuántos. */
  async marcarEnviados(db: Db, comandaId: string, envio: number, fecha: Date): Promise<number> {
    const r = await db.itemComanda.updateMany({
      where: { comandaId, estado: "PENDIENTE" },
      data: { estado: "EN_PREPARACION", envio, enviadoAt: fecha },
    });
    return r.count;
  }

  itemsDeEnvio(db: Db, comandaId: string, envio: number): Promise<Array<ItemComanda & { producto: { nombre: string } }>> {
    return db.itemComanda.findMany({
      where: { comandaId, envio },
      include: { producto: { select: { nombre: true } } },
      orderBy: { createdAt: "asc" },
    });
  }

  async marcarCobrados(db: Db, ids: string[], ventaId: string | null): Promise<void> {
    await db.itemComanda.updateMany({ where: { id: { in: ids } }, data: { cobrado: true, ventaId } });
  }

  async cancelarTodos(db: Db, comandaId: string, motivo: string): Promise<void> {
    await db.itemComanda.updateMany({
      where: { comandaId, estado: { not: "CANCELADO" } },
      data: { estado: "CANCELADO", motivoCancelacion: motivo },
    });
  }

  async trasladarItems(db: Db, origenId: string, destinoId: string): Promise<void> {
    await db.itemComanda.updateMany({ where: { comandaId: origenId }, data: { comandaId: destinoId } });
  }

  // ── Cobros ───────────────────────────────────────────────
  crearCobro(db: Db, data: { comandaId: string; ventaId: string; modo: string; parte: number | null }): Promise<CobroComanda> {
    return db.cobroComanda.create({ data });
  }

  // ── Cocina ───────────────────────────────────────────────
  itemsParaCocina(db: Db, f: { empresaId: string; estado: string; destino?: string; sucursalId?: string }): Promise<ItemDeCocina[]> {
    return db.itemComanda.findMany({
      where: {
        estado: f.estado,
        ...(f.destino !== undefined ? { destino: f.destino } : {}),
        comanda: {
          estado: "ABIERTA",
          sucursal: { empresaId: f.empresaId },
          ...(f.sucursalId !== undefined ? { sucursalId: f.sucursalId } : {}),
        },
      },
      include: incluirCocina,
      orderBy: [{ enviadoAt: "asc" }, { createdAt: "asc" }],
    });
  }
}

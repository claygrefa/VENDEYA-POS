// ============================================================
// src/server/services/lote.service.ts — Lotes y fechas de vencimiento (Farmacia)
// ============================================================
import type { Lote, PrismaClient } from "@prisma/client";
import { FiltroLotesSchema, LoteActualizarSchema, LoteCrearSchema } from "../../shared/schemas/inventario.schema";
import type { Db } from "../repositories/kardex.repository";
import type { LoteConProducto, LoteRepository } from "../repositories/lote.repository";
import type { ResultadoPaginado } from "../repositories/producto.repository";
import { AppError } from "./appError.util";
import type { GiroService } from "./giro.service";
import { estaVencido } from "./inventario.util";
import type { KardexService } from "./kardex.service";
import { omitUndefined } from "./object.util";
import type { ActorCaja } from "./turno.service";
import { parsear } from "./validation.util";
import { round4 } from "./ventaCalculo.util";

export interface IngresoLote {
  productoId: string;
  numeroLote: string;
  fechaVencimiento: Date;
  fechaFabricacion?: Date | null | undefined;
  /** En unidades base */
  cantidad: number;
  proveedorId?: string | null | undefined;
}

const TX_OPCIONES = { maxWait: 30_000, timeout: 60_000 } as const;

const mismoDia = (a: Date, b: Date): boolean => a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);

export class LoteService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly repo: LoteRepository,
    private readonly kardex: KardexService,
    private readonly giro: GiroService
  ) {}

  /**
   * Registra existencias en un lote (lo crea o repone el existente). No toca Kardex ni stock del
   * producto: el llamador (compra, ajuste) registra el movimiento en la misma transacción.
   */
  async ingresar(db: Db, e: IngresoLote): Promise<Lote> {
    if (!(e.cantidad > 0)) throw new AppError("VALIDACION", "La cantidad del lote debe ser mayor a cero");
    if (estaVencido(e.fechaVencimiento)) {
      throw new AppError("VALIDACION", `El lote ${e.numeroLote} ya está vencido: no se puede ingresar`);
    }
    if (e.fechaFabricacion != null && e.fechaFabricacion.getTime() > e.fechaVencimiento.getTime()) {
      throw new AppError("VALIDACION", "La fecha de fabricación no puede ser posterior a la de vencimiento");
    }
    const cantidad = round4(e.cantidad);

    const existente = await this.repo.porProductoYNumero(db, e.productoId, e.numeroLote);
    if (existente !== null) {
      if (existente.status !== "ACTIVO") {
        throw new AppError("VALIDACION", `El lote ${e.numeroLote} está bloqueado y no admite ingresos`);
      }
      if (!mismoDia(existente.fechaVencimiento, e.fechaVencimiento)) {
        throw new AppError(
          "VALIDACION",
          `El lote ${e.numeroLote} ya existe con otra fecha de vencimiento (${existente.fechaVencimiento.toISOString().slice(0, 10)})`
        );
      }
      return this.repo.incrementar(db, existente.id, cantidad);
    }
    return this.repo.crear(db, {
      productoId: e.productoId,
      numeroLote: e.numeroLote,
      fechaVencimiento: e.fechaVencimiento,
      fechaFabricacion: e.fechaFabricacion ?? null,
      cantidadInicial: cantidad,
      cantidadActual: cantidad,
      proveedorId: e.proveedorId ?? null,
    });
  }

  /** Alta manual de un lote con existencias: entrada de inventario (AJUSTE_ENTRADA) + lote. */
  async crear(entrada: unknown, actor: ActorCaja): Promise<LoteConProducto> {
    const datos = parsear(LoteCrearSchema, entrada);
    await this.giro.exigir(this.prisma, actor.empresaId, "moduloLotes");

    return this.prisma.$transaction(async (tx) => {
      const producto = await this.repo.producto(tx, datos.productoId);
      if (producto === null) throw new AppError("NO_ENCONTRADO", "Producto no encontrado");
      if (producto.tipo !== "BIEN" || !producto.requiereLote) {
        throw new AppError("VALIDACION", `"${producto.nombre}" no está configurado para manejar lotes`);
      }
      const lote = await this.ingresar(tx, {
        productoId: producto.id,
        numeroLote: datos.numeroLote,
        fechaVencimiento: datos.fechaVencimiento,
        fechaFabricacion: datos.fechaFabricacion,
        cantidad: datos.cantidad,
        proveedorId: datos.proveedorId,
      });
      await this.kardex.registrarEntrada(tx, {
        productoId: producto.id,
        cantidad: datos.cantidad,
        costoUnitario: datos.costoUnitario,
        tipoMovimiento: "AJUSTE_ENTRADA",
        referencia: lote.id,
        observacion: `Ingreso de lote ${datos.numeroLote}`,
      });
      return (await this.repo.porId(tx, lote.id)) as LoteConProducto;
    }, TX_OPCIONES);
  }

  async obtener(id: string, actor: ActorCaja): Promise<LoteConProducto> {
    await this.giro.exigir(this.prisma, actor.empresaId, "moduloLotes");
    const lote = await this.repo.porId(this.prisma, id);
    if (lote === null) throw new AppError("NO_ENCONTRADO", "Lote no encontrado");
    return lote;
  }

  async listar(entrada: unknown, actor: ActorCaja): Promise<ResultadoPaginado<LoteConProducto>> {
    const f = parsear(FiltroLotesSchema, entrada ?? {});
    await this.giro.exigir(this.prisma, actor.empresaId, "moduloLotes");
    return this.repo.listar(this.prisma, {
      page: f.page,
      pageSize: f.pageSize,
      ...omitUndefined({ productoId: f.productoId, status: f.status, conStock: f.conStock }),
    });
  }

  /** Corrige fechas o bloquea/desbloquea un lote (las cantidades solo cambian por movimientos). */
  async actualizar(id: string, entrada: unknown, actor: ActorCaja): Promise<LoteConProducto> {
    const datos = parsear(LoteActualizarSchema, entrada);
    await this.giro.exigir(this.prisma, actor.empresaId, "moduloLotes");
    return this.prisma.$transaction(async (tx) => {
      const lote = await this.repo.porId(tx, id);
      if (lote === null) throw new AppError("NO_ENCONTRADO", "Lote no encontrado");
      const vence = datos.fechaVencimiento ?? lote.fechaVencimiento;
      const fabrica = datos.fechaFabricacion ?? lote.fechaFabricacion;
      if (fabrica !== null && fabrica.getTime() > vence.getTime()) {
        throw new AppError("VALIDACION", "La fecha de fabricación no puede ser posterior a la de vencimiento");
      }
      return this.repo.actualizar(tx, id, omitUndefined(datos));
    });
  }
}

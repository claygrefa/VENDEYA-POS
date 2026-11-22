// ============================================================
// src/server/services/kardex.service.ts — Kardex valorado (costo promedio ponderado)
// Cada operación debe invocarse dentro de la transacción del llamador (`db`),
// de modo que stock, costo y movimiento se confirmen o se reviertan juntos.
// ============================================================
import type { Kardex } from "@prisma/client";
import type { Db, KardexRepository } from "../repositories/kardex.repository";
import { AppError } from "./appError.util";
import { calcularCostoPromedio, round2, round4 } from "./ventaCalculo.util";

export type TipoEntrada = "COMPRA" | "AJUSTE_ENTRADA" | "DEVOLUCION";
export type TipoSalida = "VENTA" | "AJUSTE_SALIDA";

export interface MovimientoBase {
  productoId: string;
  cantidad: number;
  referencia?: string;
  observacion?: string;
}

export interface EntradaKardex extends MovimientoBase {
  tipoMovimiento: TipoEntrada;
  costoUnitario: number;
}

export interface SalidaKardex extends MovimientoBase {
  tipoMovimiento: TipoSalida;
}

const MAX_REINTENTOS_CAS = 5;

function validarCantidad(cantidad: number): void {
  if (!Number.isFinite(cantidad) || cantidad <= 0) {
    throw new AppError("VALIDACION", "La cantidad del movimiento debe ser mayor a cero");
  }
}

export class KardexService {
  constructor(private readonly repo: KardexRepository) {}

  /** Entrada de stock: recalcula el costo promedio ponderado. */
  async registrarEntrada(db: Db, e: EntradaKardex): Promise<Kardex> {
    validarCantidad(e.cantidad);
    if (!Number.isFinite(e.costoUnitario) || e.costoUnitario < 0) {
      throw new AppError("VALIDACION", "El costo unitario no puede ser negativo");
    }
    const cantidad = round4(e.cantidad);

    for (let intento = 0; intento < MAX_REINTENTOS_CAS; intento++) {
      const p = await this.repo.leerProducto(db, e.productoId);
      if (p === null) throw new AppError("NO_ENCONTRADO", "Producto no encontrado");

      const costoPromedio = calcularCostoPromedio(p.stockActual, p.costoPromedio, cantidad, e.costoUnitario);
      const stockResultante = round4(p.stockActual + cantidad);

      const filas = await this.repo.actualizarEntradaSiNoCambio(db, p, { stockActual: stockResultante, costoPromedio });
      if (filas === 0) continue; // otro proceso modificó el producto: reintentar con datos frescos

      return this.repo.crearMovimiento(db, {
        productoId: p.id,
        tipoMovimiento: e.tipoMovimiento,
        cantidad,
        costoUnitario: round4(e.costoUnitario),
        costoTotal: round2(cantidad * e.costoUnitario),
        stockAnterior: p.stockActual,
        stockResultante,
        costoPromAnterior: p.costoPromedio,
        costoPromResultante: costoPromedio,
        referencia: e.referencia ?? null,
        observacion: e.observacion ?? null,
      });
    }
    throw new AppError("ESTADO_INVALIDO", "No se pudo actualizar el producto por modificaciones concurrentes");
  }

  /** Salida de stock al costo promedio vigente (el costo promedio no cambia en una salida). */
  async registrarSalida(db: Db, s: SalidaKardex): Promise<Kardex> {
    validarCantidad(s.cantidad);
    const cantidad = round4(s.cantidad);

    const filas = await this.repo.descontarStockSiAlcanza(db, s.productoId, cantidad);
    const p = await this.repo.leerProducto(db, s.productoId);
    if (p === null) throw new AppError("NO_ENCONTRADO", "Producto no encontrado");
    if (filas === 0) {
      throw new AppError(
        "STOCK_INSUFICIENTE",
        `Stock insuficiente para "${p.nombre}": disponible ${p.stockActual}, solicitado ${cantidad}`
      );
    }

    return this.repo.crearMovimiento(db, {
      productoId: p.id,
      tipoMovimiento: s.tipoMovimiento,
      cantidad,
      costoUnitario: p.costoPromedio,
      costoTotal: round2(cantidad * p.costoPromedio),
      stockAnterior: round4(p.stockActual + cantidad),
      stockResultante: p.stockActual,
      costoPromAnterior: p.costoPromedio,
      costoPromResultante: p.costoPromedio,
      referencia: s.referencia ?? null,
      observacion: s.observacion ?? null,
    });
  }

  historial(db: Db, productoId: string): Promise<Kardex[]> {
    return this.repo.listarPorProducto(db, productoId);
  }
}

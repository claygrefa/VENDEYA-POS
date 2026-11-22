// ============================================================
// src/server/services/venta.service.ts — Motor transaccional ACID de ventas
// ============================================================
import type { Cliente, PrismaClient } from "@prisma/client";
import { CONSUMIDOR_FINAL } from "../../shared/constants/sri.constants";
import { AnularVentaSchema, VentaInputSchema } from "../../shared/schemas/venta.schema";
import type { Db } from "../repositories/kardex.repository";
import type { VentaCompleta, VentaRepository } from "../repositories/venta.repository";
import { AppError } from "./appError.util";
import type { CuentaPorCobrarService } from "./cuentaPorCobrar.service";
import type { KardexService } from "./kardex.service";
import { resolverPorcentajeIva } from "./impuesto.util";
import { parsear } from "./validation.util";
import { calcularLinea, calcularTotales, distribuirPagos, round2, round4 } from "./ventaCalculo.util";

/** Usuario que ejecuta la operación (proviene de la sesión). */
export interface ActorVenta {
  id: string;
  empresaId: string;
}

const TX_OPCIONES = { maxWait: 30_000, timeout: 60_000 } as const;

export function formatearNumeroVenta(sucursal: string, punto: string, secuencial: number): string {
  return `${sucursal}-${punto}-${String(secuencial).padStart(9, "0")}`;
}

export class VentaService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly repo: VentaRepository,
    private readonly kardex: KardexService,
    private readonly cuentasPorCobrar: CuentaPorCobrarService
  ) {}

  /**
   * Registra una venta completa en una única transacción: número secuencial, líneas con IVA,
   * pagos/cambio, descuento de stock + Kardex (y lote). Cualquier error revierte todo,
   * incluido el secuencial.
   */
  async crear(entrada: unknown, actor: ActorVenta): Promise<VentaCompleta> {
    const datos = parsear(VentaInputSchema, entrada);

    return this.prisma.$transaction(async (tx) => {
      // 1) Primera escritura: reserva el secuencial y toma el bloqueo de escritura.
      const punto = await this.repo.reservarSecuencial(tx, datos.puntoEmisionId);
      if (punto === null) throw new AppError("NO_ENCONTRADO", "Punto de emisión no encontrado");
      if (punto.sucursal.empresaId !== actor.empresaId) {
        throw new AppError("NO_ENCONTRADO", "Punto de emisión no encontrado");
      }
      if (punto.status !== "ACTIVO" || punto.sucursal.status !== "ACTIVO") {
        throw new AppError("VALIDACION", "El punto de emisión o la sucursal están inactivos");
      }

      // 2) Regla mínima de caja: el cajero debe tener un turno abierto en la sucursal.
      const turno = await this.repo.turnoAbierto(tx, actor.id, punto.sucursalId);
      if (turno === null) {
        throw new AppError("TURNO_REQUERIDO", "Debe abrir un turno de caja antes de registrar ventas");
      }

      // 3) Productos, tarifas y cliente
      const idsProducto = [...new Set(datos.lineas.map((l) => l.productoId))];
      const productos = new Map((await this.repo.productosPorIds(tx, idsProducto)).map((p) => [p.id, p]));
      const tarifas = await this.repo.tarifasIva(tx, actor.empresaId);

      let clienteRegistrado: Cliente | null = null;
      let clienteId: string | null = null;
      let clienteRuc: string = datos.clienteRuc ?? CONSUMIDOR_FINAL.identificacion;
      let clienteNombre: string = datos.clienteNombre ?? CONSUMIDOR_FINAL.razonSocial;
      if (datos.clienteId != null) {
        const cliente = await this.repo.cliente(tx, datos.clienteId);
        if (cliente === null || cliente.status !== "ACTIVO") throw new AppError("NO_ENCONTRADO", "Cliente no encontrado");
        clienteRegistrado = cliente;
        clienteId = cliente.id;
        clienteRuc = cliente.identificacion;
        clienteNombre = cliente.razonSocial;
      }
      if (datos.pagos.some((p) => p.formaPago === "CREDITO") && clienteId === null) {
        throw new AppError("VALIDACION", "Una venta a crédito requiere un cliente registrado");
      }

      // 4) Cálculo de líneas
      const calculadas = datos.lineas.map((l) => {
        const producto = productos.get(l.productoId);
        if (producto === undefined) throw new AppError("NO_ENCONTRADO", `Producto ${l.productoId} no encontrado`);
        if (producto.status !== "ACTIVO") {
          throw new AppError("VALIDACION", `El producto "${producto.nombre}" está inactivo`);
        }
        const porcentajeIva = resolverPorcentajeIva(producto, tarifas);
        const calculo = calcularLinea({
          cantidad: l.cantidad,
          precioUnitario: l.precioUnitario,
          descuento: l.descuento,
          tipoDescuento: l.tipoDescuento,
          porcentajeIva,
        });
        return { entrada: l, producto, porcentajeIva, calculo };
      });

      const totales = calcularTotales(calculadas.map((c) => c.calculo));
      const pagos = distribuirPagos(totales.total, datos.pagos);
      const numero = formatearNumeroVenta(punto.sucursal.codigo, punto.codigo, punto.secuencialVenta);

      // 5) Persistencia de la venta
      const venta = await this.repo.crear(tx, {
        numero,
        sucursalId: punto.sucursalId,
        puntoEmisionId: punto.id,
        turnoId: turno.id,
        cajeroId: actor.id,
        clienteId,
        clienteRuc,
        clienteNombre,
        ...totales,
        observaciones: datos.observaciones ?? null,
        lineas: calculadas.map((c) => ({
          productoId: c.producto.id,
          loteId: c.entrada.loteId ?? null,
          descripcion: c.producto.nombre,
          cantidad: c.entrada.cantidad,
          precioUnitario: c.entrada.precioUnitario,
          descuento: c.calculo.descuento,
          tipoDescuento: c.entrada.tipoDescuento,
          subtotal: c.calculo.subtotal,
          iva: c.calculo.iva,
          porcentajeIva: c.porcentajeIva,
          total: c.calculo.total,
          // Costo al momento de la venta (para margen y reversión por anulación)
          costoUnitario: c.producto.tipo === "BIEN" ? c.producto.costoPromedio : 0,
        })),
        pagos: datos.pagos.map((p, i) => ({
          formaPago: p.formaPago,
          monto: p.monto,
          referencia: p.referencia ?? null,
          cambio: pagos.cambioPorPago[i] ?? 0,
        })),
      });

      // 5b) Venta a crédito: genera la cuenta por cobrar (valida el límite de crédito)
      const montoCredito = round2(datos.pagos.filter((p) => p.formaPago === "CREDITO").reduce((acc, p) => acc + p.monto, 0));
      if (montoCredito > 0 && clienteRegistrado !== null) {
        await this.cuentasPorCobrar.generarPorVenta(tx, {
          ventaId: venta.id,
          cliente: clienteRegistrado,
          monto: montoCredito,
          fecha: venta.createdAt,
        });
      }

      // 6) Inventario: lote (si aplica) y Kardex. Falla de stock → rollback total.
      for (const c of calculadas) {
        if (c.producto.tipo !== "BIEN") continue;
        if (c.entrada.loteId != null) await this.descontarLote(tx, c.entrada.loteId, c.producto.id, c.entrada.cantidad);
        await this.kardex.registrarSalida(tx, {
          productoId: c.producto.id,
          cantidad: c.entrada.cantidad,
          tipoMovimiento: "VENTA",
          referencia: venta.id,
          observacion: `Venta ${numero}`,
        });
      }

      return venta;
    }, TX_OPCIONES);
  }

  /** Anula una venta COMPLETADA y revierte su inventario con movimientos DEVOLUCION. */
  async anular(ventaId: string, entrada: unknown, actor: ActorVenta): Promise<VentaCompleta> {
    const { motivo } = parsear(AnularVentaSchema, entrada);

    return this.prisma.$transaction(async (tx) => {
      // Cambio de estado atómico: dos anulaciones simultáneas no pueden revertir el stock dos veces.
      const filas = await this.repo.marcarAnulada(tx, ventaId, actor.empresaId, {
        motivo,
        anuladaPorId: actor.id,
        fecha: new Date(),
      });
      const venta = await this.repo.buscarPorId(tx, ventaId, actor.empresaId);
      if (venta === null) throw new AppError("NO_ENCONTRADO", "Venta no encontrada");
      if (filas === 0) throw new AppError("ESTADO_INVALIDO", `La venta ${venta.numero} ya está anulada`);
      if (venta.comprobante?.estado === "AUTORIZADO") {
        throw new AppError(
          "ESTADO_INVALIDO",
          `La venta ${venta.numero} tiene una factura autorizada por el SRI: debe emitirse una nota de crédito`
        );
      }

      // Venta a crédito: anula su cuenta por cobrar (falla si ya tiene abonos)
      await this.cuentasPorCobrar.anularPorVenta(tx, venta.id);

      const tipos = new Map((await this.repo.productosTipo(tx, venta.lineas.map((l) => l.productoId))).map((p) => [p.id, p.tipo]));
      for (const l of venta.lineas) {
        if (tipos.get(l.productoId) !== "BIEN") continue;
        if (l.loteId !== null) await this.repo.reponerLote(tx, l.loteId, l.cantidad);
        await this.kardex.registrarEntrada(tx, {
          productoId: l.productoId,
          cantidad: l.cantidad,
          costoUnitario: l.costoUnitario, // al costo original de la venta
          tipoMovimiento: "DEVOLUCION",
          referencia: venta.id,
          observacion: `Anulación venta ${venta.numero}: ${motivo}`,
        });
      }
      return venta;
    }, TX_OPCIONES);
  }

  async obtener(ventaId: string, actor: ActorVenta): Promise<VentaCompleta> {
    const venta = await this.repo.buscarPorId(this.prisma, ventaId, actor.empresaId);
    if (venta === null) throw new AppError("NO_ENCONTRADO", "Venta no encontrada");
    return venta;
  }

  // ── Internos ───────────────────────────────────────────────

  private async descontarLote(db: Db, loteId: string, productoId: string, cantidad: number): Promise<void> {
    const lote = await this.repo.lote(db, loteId);
    if (lote === null || lote.productoId !== productoId) throw new AppError("NO_ENCONTRADO", "Lote no encontrado para el producto");
    if (lote.status !== "ACTIVO" || lote.fechaVencimiento.getTime() < Date.now()) {
      throw new AppError("VALIDACION", `El lote ${lote.numeroLote} está vencido o inactivo`);
    }
    const filas = await this.repo.descontarLoteSiAlcanza(db, loteId, productoId, round4(cantidad));
    if (filas === 0) {
      throw new AppError("STOCK_INSUFICIENTE", `Stock insuficiente en el lote ${lote.numeroLote}: disponible ${lote.cantidadActual}`);
    }
  }
}

// ============================================================
// src/server/services/venta.service.ts — Motor transaccional ACID de ventas
// ============================================================
import type { Cliente, PresentacionProducto, PrismaClient } from "@prisma/client";
import { CONSUMIDOR_FINAL } from "../../shared/constants/sri.constants";
import { AnularVentaSchema, VentaInputSchema } from "../../shared/schemas/venta.schema";
import type { Db } from "../repositories/kardex.repository";
import type { ProductoConTarifa, VentaCompleta, VentaRepository } from "../repositories/venta.repository";
import { AppError } from "./appError.util";
import type { CuentaPorCobrarService } from "./cuentaPorCobrar.service";
import type { ComprobanteService } from "./sri/comprobante.service";
import { resolverTarifaIva } from "./impuesto.util";
import {
  aUnidadesBase,
  asignarFefo,
  repartirProporcional,
  resolverPrecioUnitario,
  validarCantidadVenta,
} from "./inventario.util";
import type { KardexService } from "./kardex.service";
import { confirmarIntento, type ResultadoIntento } from "./intentoCobro.service";
import { parsear } from "./validation.util";
import { calcularLinea, calcularTotales, distribuirPagos, round2, round4 } from "./ventaCalculo.util";

/** Usuario que ejecuta la operación (proviene de la sesión). */
export interface ActorVenta {
  id: string;
  empresaId: string;
  /** Permisos "modulo:accion"; sin ellos no se puede modificar el precio de una línea. */
  permisos?: readonly string[];
}

/** Permiso necesario para vender a un precio distinto del resuelto por el sistema. */
export const PERMISO_MODIFICAR_PRECIO = "ventas:actualizar";

/** Venta registrada; `advertencias` informa lo que no pudo completarse sin afectar la venta (p. ej. la factura electrónica). */
export type VentaEmitida = VentaCompleta & { advertencias: string[] };

/** Opciones internas (no expuestas por HTTP) para ventas originadas por otros módulos. */
export interface OpcionesVenta {
  /**
   * La venta cobra los ítems de una comanda ya aceptada: se respetan los precios pactados al
   * pedir y las cantidades proporcionales (división en partes iguales).
   */
  desdeComanda?: boolean;
}

const TX_OPCIONES = { maxWait: 30_000, timeout: 60_000 } as const;
const TOLERANCIA_PRECIO = 0.005;

export function formatearNumeroVenta(sucursal: string, punto: string, secuencial: number): string {
  return `${sucursal}-${punto}-${String(secuencial).padStart(9, "0")}`;
}

/** Línea ya resuelta (precio, presentación, lote) lista para calcular y persistir. */
interface LineaResuelta {
  producto: ProductoConTarifa;
  presentacion: PresentacionProducto | null;
  factor: number;
  /** En unidades de venta */
  cantidad: number;
  /** En unidades base (lo que se descuenta del stock) */
  cantidadBase: number;
  precioUnitario: number;
  descuento: number;
  tipoDescuento: "PORCENTAJE" | "VALOR";
  loteId: string | null;
}

export class VentaService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly repo: VentaRepository,
    private readonly kardex: KardexService,
    private readonly cuentasPorCobrar: CuentaPorCobrarService,
    private readonly comprobantes: ComprobanteService
  ) {}

  /**
   * Registra una venta completa en una única transacción: número secuencial, precios (lista →
   * presentación → catálogo), líneas con IVA, pagos/cambio, lotes (FEFO) y descuento de stock +
   * Kardex en unidades base. Cualquier error revierte todo, incluido el secuencial.
   */
  async crear(entrada: unknown, actor: ActorVenta): Promise<VentaEmitida> {
    return this.prisma.$transaction((tx) => this.crearEnTx(tx, entrada, actor), TX_OPCIONES);
  }

  registrarCobro(entrada: unknown, actor: ActorVenta, autorizar: (tx: Db) => Promise<void>): Promise<ResultadoIntento<VentaEmitida>> {
    const { intentoId, ...datos } = parsear(VentaInputSchema, entrada);
    return confirmarIntento(this.prisma, actor, intentoId, ["venta", datos], async (tx) => {
      await autorizar(tx);
      return this.crearEnTx(tx, datos, actor);
    });
  }

  /**
   * Igual que `crear`, pero dentro de una transacción ya abierta (p. ej. el cobro de una comanda,
   * que debe confirmarse o revertirse junto con el cierre de la mesa). Con el pool de una conexión
   * no se pueden anidar transacciones: quien necesite componer operaciones usa este método.
   */
  async crearEnTx(tx: Db, entrada: unknown, actor: ActorVenta, opciones: OpcionesVenta = {}): Promise<VentaEmitida> {
    const datos = parsear(VentaInputSchema, entrada);

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

    // 3) Productos, presentaciones, tarifas y cliente
    const idsProducto = [...new Set(datos.lineas.map((l) => l.productoId))];
    const idsPresentacion = [...new Set(datos.lineas.flatMap((l) => (l.presentacionId != null ? [l.presentacionId] : [])))];
    const productos = new Map((await this.repo.productosPorIds(tx, idsProducto)).map((p) => [p.id, p]));
    const presentaciones = new Map((await this.repo.presentacionesPorIds(tx, idsPresentacion)).map((p) => [p.id, p]));
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

    // Lista de precios del cliente (solo si el giro tiene el módulo habilitado)
    const listaId = clienteRegistrado?.listaPrecioId ?? null;
    const preciosLista =
      listaId !== null && (await this.repo.listasPreciosHabilitadas(tx, actor.empresaId))
        ? await this.repo.preciosDeLista(tx, listaId, idsProducto)
        : [];

    // 4) Resolución de líneas: precio, presentación y lotes (FEFO)
    const puedeModificarPrecio = opciones.desdeComanda === true || actor.permisos?.includes(PERMISO_MODIFICAR_PRECIO) === true;
    const consumidoPorLote = new Map<string, number>();
    const resueltas: LineaResuelta[] = [];

    for (const l of datos.lineas) {
      const producto = productos.get(l.productoId);
      if (producto === undefined) throw new AppError("NO_ENCONTRADO", `Producto ${l.productoId} no encontrado`);
      if (producto.status !== "ACTIVO") throw new AppError("VALIDACION", `El producto "${producto.nombre}" está inactivo`);

      let presentacion: PresentacionProducto | null = null;
      if (l.presentacionId != null) {
        presentacion = presentaciones.get(l.presentacionId) ?? null;
        if (presentacion === null || presentacion.productoId !== producto.id) {
          throw new AppError("NO_ENCONTRADO", `La presentación no pertenece al producto "${producto.nombre}"`);
        }
        if (presentacion.status !== "ACTIVO") {
          throw new AppError("VALIDACION", `La presentación "${presentacion.nombre}" está inactiva`);
        }
      }
      const factor = presentacion?.factor ?? 1;

      if (opciones.desdeComanda !== true) {
        validarCantidadVenta({
          cantidad: l.cantidad,
          permiteDecimales: producto.unidadMedida.permiteDecimales,
          esPresentacion: presentacion !== null,
          nombre: producto.nombre,
        });
      }

      // Precio: lo resuelve el servidor; cambiarlo exige permiso
      let precioUnitario = resolverPrecioUnitario({
        precioProducto: producto.precioVenta,
        factor,
        esPresentacion: presentacion !== null,
        precioPresentacion: presentacion?.precioVenta ?? null,
        precioListaBase: preciosLista.find((p) => p.productoId === producto.id && p.presentacionId === null)?.precio ?? null,
        precioListaPresentacion:
          presentacion === null ? null : (preciosLista.find((p) => p.presentacionId === presentacion?.id)?.precio ?? null),
      });
      if (l.precioUnitario !== undefined && Math.abs(l.precioUnitario - precioUnitario) > TOLERANCIA_PRECIO) {
        if (!puedeModificarPrecio) {
          throw new AppError(
            "VALIDACION",
            `Precio no autorizado para "${producto.nombre}": corresponde ${precioUnitario.toFixed(2)} y se envió ${l.precioUnitario.toFixed(2)}`
          );
        }
        precioUnitario = l.precioUnitario;
      }

      const cantidadBase = aUnidadesBase(l.cantidad, factor);
      const base = {
        producto,
        presentacion,
        factor,
        precioUnitario,
        tipoDescuento: l.tipoDescuento,
      };

      // FEFO: producto con lote y sin lote explícito → se reparte entre los lotes que vencen primero
      if (producto.tipo === "BIEN" && producto.requiereLote && l.loteId == null) {
        const disponibles = (await this.repo.lotesDisponibles(tx, producto.id)).map((lote) => ({
          id: lote.id,
          cantidadActual: round4(lote.cantidadActual - (consumidoPorLote.get(lote.id) ?? 0)),
          fechaVencimiento: lote.fechaVencimiento,
          createdAt: lote.createdAt,
        }));
        const { asignaciones, faltante } = asignarFefo(disponibles, cantidadBase);
        if (faltante > 0) {
          throw new AppError(
            "STOCK_INSUFICIENTE",
            `Stock insuficiente en lotes vigentes de "${producto.nombre}": disponible ${round4(cantidadBase - faltante)}, solicitado ${cantidadBase}`
          );
        }
        for (const a of asignaciones) {
          consumidoPorLote.set(a.loteId, round4((consumidoPorLote.get(a.loteId) ?? 0) + a.cantidad));
        }

        if (asignaciones.length === 1) {
          resueltas.push({ ...base, cantidad: l.cantidad, cantidadBase, descuento: l.descuento, loteId: asignaciones[0]?.loteId ?? null });
        } else {
          // Una línea por lote; el descuento por valor se prorratea por cantidad
          const descuentos =
            l.tipoDescuento === "VALOR"
              ? repartirProporcional(l.descuento, asignaciones.map((a) => a.cantidad))
              : asignaciones.map(() => l.descuento);
          asignaciones.forEach((a, i) =>
            resueltas.push({
              ...base,
              cantidad: round4(a.cantidad / factor),
              cantidadBase: a.cantidad,
              descuento: descuentos[i] ?? 0,
              loteId: a.loteId,
            })
          );
        }
      } else {
        resueltas.push({ ...base, cantidad: l.cantidad, cantidadBase, descuento: l.descuento, loteId: l.loteId ?? null });
      }
    }

    // 5) Cálculo de importes
    const calculadas = resueltas.map((r) => {
      const tarifa = resolverTarifaIva(r.producto, tarifas);
      const porcentajeIva = tarifa.porcentaje;
      const calculo = calcularLinea({
        cantidad: r.cantidad,
        precioUnitario: r.precioUnitario,
        descuento: r.descuento,
        tipoDescuento: r.tipoDescuento,
        porcentajeIva,
      });
      return { ...r, porcentajeIva, codigoIva: tarifa.codigo, calculo };
    });

    const totales = calcularTotales(calculadas.map((c) => c.calculo));
    // La propina no lleva IVA pero se cobra junto con la venta: los pagos deben cubrir total + propina
    const propina = round2(datos.propina);
    const pagos = distribuirPagos(round2(totales.total + propina), datos.pagos);
    const numero = formatearNumeroVenta(punto.sucursal.codigo, punto.codigo, punto.secuencialVenta);

    // 6) Persistencia de la venta
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
      propina,
      observaciones: datos.observaciones ?? null,
      lineas: calculadas.map((c) => ({
        productoId: c.producto.id,
        loteId: c.loteId,
        presentacionId: c.presentacion?.id ?? null,
        factorConversion: c.factor,
        cantidadBase: c.producto.tipo === "BIEN" ? c.cantidadBase : 0,
        descripcion: c.presentacion !== null ? `${c.producto.nombre} (${c.presentacion.nombre})` : c.producto.nombre,
        cantidad: c.cantidad,
        precioUnitario: c.precioUnitario,
        descuento: c.calculo.descuento,
        tipoDescuento: c.tipoDescuento,
        subtotal: c.calculo.subtotal,
        iva: c.calculo.iva,
        porcentajeIva: c.porcentajeIva,
        codigoIvaSRI: c.codigoIva,
        total: c.calculo.total,
        // Costo por unidad BASE al momento de la venta (para margen y reversión por anulación)
        costoUnitario: c.producto.tipo === "BIEN" ? c.producto.costoPromedio : 0,
      })),
      pagos: datos.pagos.map((p, i) => ({
        formaPago: p.formaPago,
        monto: p.monto,
        referencia: p.referencia ?? null,
        cambio: pagos.cambioPorPago[i] ?? 0,
      })),
    });

    // 6b) Venta a crédito: genera la cuenta por cobrar (valida el límite de crédito)
    const montoCredito = round2(datos.pagos.filter((p) => p.formaPago === "CREDITO").reduce((acc, p) => acc + p.monto, 0));
    if (montoCredito > 0 && clienteRegistrado !== null) {
      await this.cuentasPorCobrar.generarPorVenta(tx, {
        ventaId: venta.id,
        cliente: clienteRegistrado,
        monto: montoCredito,
        fecha: venta.createdAt,
      });
    }

    // 7) Inventario en unidades base: lote (si aplica) y Kardex. Falla de stock → rollback total.
    for (const c of calculadas) {
      if (c.producto.tipo !== "BIEN") continue;
      if (c.loteId !== null) await this.descontarLote(tx, c.loteId, c.producto.id, c.cantidadBase);
      await this.kardex.registrarSalida(tx, {
        productoId: c.producto.id,
        cantidad: c.cantidadBase,
        tipoMovimiento: "VENTA",
        referencia: venta.id,
        observacion: `Venta ${numero}`,
      });
    }

    // 8) Factura electrónica (opcional). Nunca bloquea la venta: si no puede generarse, la venta queda registrada y se
    //    informa el motivo en `advertencias` (se puede reintentar con POST /api/ventas/:id/comprobante).
    const advertencias: string[] = [];
    let conComprobante: VentaCompleta = venta;
    if (datos.emitirFactura) {
      try {
        const r = await this.comprobantes.emitirFacturaEnTx(tx, venta.id, actor.empresaId);
        if (r.creado) conComprobante = (await this.repo.buscarPorId(tx, venta.id, actor.empresaId)) ?? venta;
      } catch (e) {
        // Los AppError se lanzan antes de escribir nada, de modo que la transacción de la venta sigue limpia.
        if (!(e instanceof AppError)) throw e;
        advertencias.push(`Factura electrónica no generada: ${e.message}`);
      }
    }
    return Object.assign(conComprobante, { advertencias });
  }

  /** Anula una venta COMPLETADA y revierte su inventario (en unidades base) con movimientos DEVOLUCION. */
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

      // Factura electrónica de la venta
      const factura = venta.comprobante;
      if (factura !== null && factura.estado !== "ANULADO") {
        if (factura.estado === "AUTORIZADO") {
          // Ya existe ante el SRI: se anula con una nota de crédito por el total (falla si no puede emitirse)
          await this.comprobantes.emitirNotaCreditoEnTx(tx, venta.id, actor.empresaId, motivo);
        } else if (factura.estado === "EN_PROCESO") {
          throw new AppError("ESTADO_INVALIDO", `La factura de la venta ${venta.numero} está en proceso de autorización: espere la respuesta del SRI`);
        } else {
          // PENDIENTE, RECHAZADO o DEVUELTO: nunca fue autorizada, se anula localmente
          await this.comprobantes.anularLocalEnTx(tx, factura.id);
        }
      }

      // Venta a crédito: anula su cuenta por cobrar (falla si ya tiene abonos)
      await this.cuentasPorCobrar.anularPorVenta(tx, venta.id);

      const tipos = new Map((await this.repo.productosTipo(tx, venta.lineas.map((l) => l.productoId))).map((p) => [p.id, p.tipo]));
      for (const l of venta.lineas) {
        if (tipos.get(l.productoId) !== "BIEN") continue;
        // Unidades base exactas guardadas en la línea (las anteriores a la migración usan `cantidad`)
        const cantidadBase = l.cantidadBase > 0 ? l.cantidadBase : l.cantidad;
        if (l.loteId !== null) await this.repo.reponerLote(tx, l.loteId, cantidadBase);
        await this.kardex.registrarEntrada(tx, {
          productoId: l.productoId,
          cantidad: cantidadBase,
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

  private async descontarLote(db: Db, loteId: string, productoId: string, cantidadBase: number): Promise<void> {
    const lote = await this.repo.lote(db, loteId);
    if (lote === null || lote.productoId !== productoId) throw new AppError("NO_ENCONTRADO", "Lote no encontrado para el producto");
    if (lote.status !== "ACTIVO" || lote.fechaVencimiento.getTime() < Date.now()) {
      throw new AppError("VALIDACION", `El lote ${lote.numeroLote} está vencido o bloqueado`);
    }
    const filas = await this.repo.descontarLoteSiAlcanza(db, loteId, productoId, round4(cantidadBase));
    if (filas === 0) {
      throw new AppError("STOCK_INSUFICIENTE", `Stock insuficiente en el lote ${lote.numeroLote}: disponible ${lote.cantidadActual}`);
    }
  }
}

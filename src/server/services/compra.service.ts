// ============================================================
// src/server/services/compra.service.ts — Compras a proveedores
// Una compra ingresa mercadería al Kardex (COMPRA, costo promedio ponderado) y, si es a
// crédito, genera su cuenta por pagar. Todo en una sola transacción.
// ============================================================
import type { PrismaClient } from "@prisma/client";
import { CompraInputSchema } from "../../shared/schemas/compra.schema";
import type { CompraCompleta, CompraRepository } from "../repositories/compra.repository";
import { AppError } from "./appError.util";
import type { CuentaPorPagarService } from "./cuentaPorPagar.service";
import type { GiroService } from "./giro.service";
import { resolverPorcentajeIva } from "./impuesto.util";
import type { KardexService } from "./kardex.service";
import type { LoteService } from "./lote.service";
import type { ActorCaja } from "./turno.service";
import { parsear } from "./validation.util";
import { calcularLinea, calcularTotales } from "./ventaCalculo.util";

const TX_OPCIONES = { maxWait: 30_000, timeout: 60_000 } as const;

export class CompraService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly repo: CompraRepository,
    private readonly kardex: KardexService,
    private readonly cuentasPorPagar: CuentaPorPagarService,
    private readonly lotes: LoteService,
    private readonly giro: GiroService
  ) {}

  async crear(entrada: unknown, actor: ActorCaja): Promise<CompraCompleta> {
    const datos = parsear(CompraInputSchema, entrada);
    const fecha = datos.fecha ?? new Date();

    return this.prisma.$transaction(async (tx) => {
      const sucursal = await this.repo.sucursal(tx, datos.sucursalId);
      if (sucursal === null || sucursal.empresaId !== actor.empresaId) throw new AppError("NO_ENCONTRADO", "Sucursal no encontrada");

      const proveedor = await this.repo.proveedor(tx, datos.proveedorId);
      if (proveedor === null) throw new AppError("NO_ENCONTRADO", "Proveedor no encontrado");
      if (proveedor.status !== "ACTIVO") throw new AppError("VALIDACION", `El proveedor "${proveedor.razonSocial}" está inactivo`);

      if ((await this.repo.facturaExiste(tx, proveedor.id, datos.numeroFactura)) !== null) {
        throw new AppError("DUPLICADO", `La factura ${datos.numeroFactura} del proveedor ya fue registrada`);
      }

      const ids = [...new Set(datos.lineas.map((l) => l.productoId))];
      const productos = new Map((await this.repo.productosPorIds(tx, ids)).map((p) => [p.id, p]));
      const tarifas = await this.repo.tarifasIva(tx, actor.empresaId);

      const calculadas = [];
      for (const l of datos.lineas) {
        const producto = productos.get(l.productoId);
        if (producto === undefined) throw new AppError("NO_ENCONTRADO", `Producto ${l.productoId} no encontrado`);
        if (producto.tipo !== "BIEN") {
          throw new AppError("VALIDACION", `"${producto.nombre}" es un servicio: solo se compran bienes con inventario`);
        }
        // Productos con lote: exigen lote y fecha de vencimiento en la compra
        if (producto.requiereLote) {
          if (l.lote === undefined) {
            throw new AppError("VALIDACION", `"${producto.nombre}" requiere número de lote y fecha de vencimiento`);
          }
          await this.giro.exigir(tx, actor.empresaId, "moduloLotes");
        } else if (l.lote !== undefined) {
          throw new AppError("VALIDACION", `"${producto.nombre}" no maneja lotes`);
        }
        const porcentajeIva = resolverPorcentajeIva(producto, tarifas);
        const calculo = calcularLinea({
          cantidad: l.cantidad,
          precioUnitario: l.costoUnitario,
          descuento: 0,
          tipoDescuento: "VALOR",
          porcentajeIva,
        });
        calculadas.push({ entrada: l, producto, porcentajeIva, calculo });
      }
      const totales = calcularTotales(calculadas.map((c) => c.calculo));

      const compra = await this.repo.crear(tx, {
        proveedorId: proveedor.id,
        sucursalId: sucursal.id,
        usuarioId: actor.id,
        numeroFactura: datos.numeroFactura,
        fecha,
        formaPago: datos.formaPago,
        subtotal: totales.subtotal,
        iva: totales.iva,
        total: totales.total,
        observaciones: datos.observaciones ?? null,
        tipoDocumento: datos.tipoDocumento,
        codSustento: datos.codSustento,
        autorizacion: datos.autorizacion ?? null,
        lineas: calculadas.map((c) => ({
          productoId: c.producto.id,
          cantidad: c.entrada.cantidad,
          costoUnitario: c.entrada.costoUnitario,
          subtotal: c.calculo.subtotal,
          iva: c.calculo.iva,
          porcentajeIva: c.porcentajeIva,
          total: c.calculo.total,
        })),
      });

      // Ingreso a inventario: el costo del Kardex es el costo sin IVA
      for (const c of calculadas) {
        if (c.entrada.lote !== undefined) {
          await this.lotes.ingresar(tx, {
            productoId: c.producto.id,
            numeroLote: c.entrada.lote.numeroLote,
            fechaVencimiento: c.entrada.lote.fechaVencimiento,
            fechaFabricacion: c.entrada.lote.fechaFabricacion,
            cantidad: c.entrada.cantidad,
            proveedorId: proveedor.id,
          });
        }
        await this.kardex.registrarEntrada(tx, {
          productoId: c.producto.id,
          cantidad: c.entrada.cantidad,
          costoUnitario: c.entrada.costoUnitario,
          tipoMovimiento: "COMPRA",
          referencia: compra.id,
          observacion: `Compra ${datos.numeroFactura} - ${proveedor.razonSocial}`,
        });
      }

      if (datos.formaPago === "CREDITO") {
        await this.cuentasPorPagar.generarPorCompra(tx, {
          compraId: compra.id,
          proveedor,
          monto: totales.total,
          fecha,
          diasCredito: datos.diasCredito,
        });
      }

      return (await this.repo.buscarPorId(tx, compra.id, actor.empresaId)) as CompraCompleta;
    }, TX_OPCIONES);
  }

  async obtener(id: string, actor: ActorCaja): Promise<CompraCompleta> {
    const compra = await this.repo.buscarPorId(this.prisma, id, actor.empresaId);
    if (compra === null) throw new AppError("NO_ENCONTRADO", "Compra no encontrada");
    return compra;
  }
}

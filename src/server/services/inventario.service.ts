// ============================================================
// src/server/services/inventario.service.ts
// Catálogo con feature flags, ajustes de inventario, consulta de Kardex y alertas.
// ============================================================
import type { Kardex, PrismaClient, Producto } from "@prisma/client";
import { PaginacionSchema } from "../../shared/schemas/paginacion.schema";
import { ProductoSchema } from "../../shared/schemas/producto.schema";
import { AjusteInventarioSchema, AlertaVencimientoQuerySchema } from "../../shared/schemas/inventario.schema";
import type { KardexRepository } from "../repositories/kardex.repository";
import type { LoteRepository } from "../repositories/lote.repository";
import { AppError } from "./appError.util";
import type { GiroService } from "./giro.service";
import { diasHastaVencimiento } from "./inventario.util";
import type { KardexService } from "./kardex.service";
import type { LoteService } from "./lote.service";
import type { ProductoService } from "./producto.service";
import type { ActorCaja } from "./turno.service";
import { parsear } from "./validation.util";
import { round4 } from "./ventaCalculo.util";

const TX_OPCIONES = { maxWait: 30_000, timeout: 60_000 } as const;

export interface AlertaLote {
  loteId: string;
  numeroLote: string;
  productoId: string;
  codigo: string;
  nombre: string;
  principioActivo: string | null;
  cantidadActual: number;
  fechaVencimiento: Date;
  /** Negativo = días transcurridos desde que venció */
  diasRestantes: number;
}

export interface AlertasVencimiento {
  dias: number;
  vencidos: AlertaLote[];
  porVencer: AlertaLote[];
}

export interface AlertaStock {
  productoId: string;
  codigo: string;
  nombre: string;
  stockActual: number;
  stockMinimo: number;
  /** Unidades necesarias para llegar al mínimo */
  faltante: number;
}

export interface ResultadoAjuste {
  movimiento: Kardex;
  producto: Producto;
}

export class InventarioService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly productos: ProductoService,
    private readonly lotes: LoteService,
    private readonly lotesRepo: LoteRepository,
    private readonly kardex: KardexService,
    private readonly kardexRepo: KardexRepository,
    private readonly giro: GiroService
  ) {}

  // ── Catálogo respetando el giro del negocio ────────────────

  async crearProducto(entrada: unknown, actor: ActorCaja): Promise<Producto> {
    const datos = parsear(ProductoSchema, entrada);
    await this.exigirModulosDelProducto(datos, actor.empresaId);
    return this.productos.crear(entrada);
  }

  async actualizarProducto(id: string, entrada: unknown, actor: ActorCaja): Promise<Producto> {
    const datos = parsear(ProductoSchema.partial(), entrada);
    await this.exigirModulosDelProducto(datos, actor.empresaId);
    return this.productos.actualizar(id, entrada);
  }

  private async exigirModulosDelProducto(datos: { requiereLote?: boolean | undefined; tieneVencimiento?: boolean | undefined }, empresaId: string): Promise<void> {
    if (datos.requiereLote === true) await this.giro.exigir(this.prisma, empresaId, "moduloLotes");
    if (datos.tieneVencimiento === true) await this.giro.exigir(this.prisma, empresaId, "moduloVencimientos");
  }

  // ── Ajustes ────────────────────────────────────────────────

  /**
   * Ajuste manual de inventario (conteo físico, merma, bonificación…) con motivo obligatorio.
   * Productos con lote: la ENTRADA indica el lote a crear/reponer y la SALIDA el lote a descontar.
   */
  async ajustar(entrada: unknown, actor: ActorCaja): Promise<ResultadoAjuste> {
    const d = parsear(AjusteInventarioSchema, entrada);

    return this.prisma.$transaction(async (tx) => {
      const producto = await this.lotesRepo.producto(tx, d.productoId);
      if (producto === null) throw new AppError("NO_ENCONTRADO", "Producto no encontrado");
      if (producto.tipo !== "BIEN") {
        throw new AppError("VALIDACION", `"${producto.nombre}" es un servicio: no maneja inventario`);
      }
      if (producto.requiereLote) await this.giro.exigir(tx, actor.empresaId, "moduloLotes");
      const observacion = `Ajuste: ${d.motivo}`;
      const cantidad = round4(d.cantidad);

      let movimiento: Kardex;
      if (d.tipo === "ENTRADA") {
        if (d.costoUnitario === undefined) throw new AppError("VALIDACION", "El costo unitario es obligatorio en un ajuste de entrada");
        if (producto.requiereLote) {
          if (d.lote === undefined) throw new AppError("VALIDACION", `"${producto.nombre}" requiere los datos del lote`);
          await this.lotes.ingresar(tx, {
            productoId: producto.id,
            numeroLote: d.lote.numeroLote,
            fechaVencimiento: d.lote.fechaVencimiento,
            fechaFabricacion: d.lote.fechaFabricacion,
            cantidad,
          });
        } else if (d.lote !== undefined) {
          throw new AppError("VALIDACION", `"${producto.nombre}" no maneja lotes`);
        }
        movimiento = await this.kardex.registrarEntrada(tx, {
          productoId: producto.id,
          cantidad,
          costoUnitario: d.costoUnitario,
          tipoMovimiento: "AJUSTE_ENTRADA",
          observacion,
        });
      } else {
        if (producto.requiereLote) {
          if (d.loteId === undefined) throw new AppError("VALIDACION", `"${producto.nombre}" requiere indicar el lote a descontar`);
          const lote = await this.lotesRepo.porId(tx, d.loteId);
          if (lote === null || lote.productoId !== producto.id) throw new AppError("NO_ENCONTRADO", "Lote no encontrado para el producto");
          if ((await this.lotesRepo.descontarSiAlcanza(tx, lote.id, producto.id, cantidad)) === 0) {
            throw new AppError("STOCK_INSUFICIENTE", `Stock insuficiente en el lote ${lote.numeroLote}: disponible ${lote.cantidadActual}`);
          }
        } else if (d.loteId !== undefined) {
          throw new AppError("VALIDACION", `"${producto.nombre}" no maneja lotes`);
        }
        movimiento = await this.kardex.registrarSalida(tx, {
          productoId: producto.id,
          cantidad,
          tipoMovimiento: "AJUSTE_SALIDA",
          observacion,
        });
      }

      return { movimiento, producto: (await this.lotesRepo.producto(tx, producto.id)) as Producto };
    }, TX_OPCIONES);
  }

  // ── Consultas ──────────────────────────────────────────────

  /** Kardex valorado de un producto, del más reciente al más antiguo. */
  async kardexDe(productoId: string, entrada: unknown): Promise<{ producto: Producto; items: Kardex[]; total: number; page: number; pageSize: number }> {
    const p = parsear(PaginacionSchema, entrada ?? {});
    const producto = await this.lotesRepo.producto(this.prisma, productoId);
    if (producto === null) throw new AppError("NO_ENCONTRADO", "Producto no encontrado");
    const { items, total } = await this.kardexRepo.listarPaginado(this.prisma, productoId, p.page, p.pageSize);
    return { producto, items, total, page: p.page, pageSize: p.pageSize };
  }

  /** Lotes con existencia ya vencidos o que vencen dentro de `dias` días. */
  async alertasVencimiento(entrada: unknown, actor: ActorCaja): Promise<AlertasVencimiento> {
    const { dias } = parsear(AlertaVencimientoQuerySchema, entrada ?? {});
    await this.giro.exigir(this.prisma, actor.empresaId, "moduloVencimientos");

    const ahora = new Date();
    const limite = new Date(ahora.getTime() + dias * 86_400_000);
    const lotes = await this.lotesRepo.conExistenciaHasta(this.prisma, limite);

    const alertas = lotes.map<AlertaLote>((l) => ({
      loteId: l.id,
      numeroLote: l.numeroLote,
      productoId: l.productoId,
      codigo: l.producto.codigo,
      nombre: l.producto.nombre,
      principioActivo: l.producto.principioActivo,
      cantidadActual: l.cantidadActual,
      fechaVencimiento: l.fechaVencimiento,
      diasRestantes: diasHastaVencimiento(l.fechaVencimiento, ahora),
    }));
    return {
      dias,
      vencidos: alertas.filter((a) => a.fechaVencimiento.getTime() < ahora.getTime()),
      porVencer: alertas.filter((a) => a.fechaVencimiento.getTime() >= ahora.getTime()),
    };
  }

  /** Productos con inventario cuyo stock está en o bajo el mínimo configurado. */
  async alertasStock(): Promise<{ total: number; items: AlertaStock[] }> {
    const candidatos = await this.lotesRepo.productosConMinimo(this.prisma);
    const items = candidatos
      .filter((p) => p.stockActual <= p.stockMinimo)
      .map<AlertaStock>((p) => ({
        productoId: p.id,
        codigo: p.codigo,
        nombre: p.nombre,
        stockActual: p.stockActual,
        stockMinimo: p.stockMinimo,
        faltante: round4(p.stockMinimo - p.stockActual),
      }));
    return { total: items.length, items };
  }
}

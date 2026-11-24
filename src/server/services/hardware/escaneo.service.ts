// ============================================================
// src/server/services/hardware/escaneo.service.ts — Qué producto (y cuánto) representa un código escaneado
//
// Orden de resolución:
//   1. Código de barras del producto  → 1 unidad.
//   2. Código de barras de una presentación (caja, paquete…) → 1 presentación (la venta aplica su factor).
//   3. Etiqueta de balanza (EAN-13 con prefijo 2, módulo de balanza activo): PLU → producto; el valor embebido es el peso
//      (kg → cantidad en la unidad del producto) o el precio (importe ÷ precio unitario).
// ============================================================
import type { PresentacionProducto, PrismaClient } from "@prisma/client";
import type { ConfiguracionRepository } from "../../repositories/configuracion.repository";
import { AppError } from "../appError.util";
import type { GiroService } from "../giro.service";
import { incluirParaVenta, type ProductoConDetalle } from "../../repositories/producto.repository";
import type { ProductoService } from "../producto.service";
import type { ActorCaja } from "../turno.service";
import { round2 } from "../ventaCalculo.util";
import { leerEtiquetaBalanza, type TipoEtiquetaBalanza } from "./codigoBarras.util";

export interface ResultadoEscaneo {
  tipo: "PRODUCTO" | "PRESENTACION" | "BALANZA";
  producto: ProductoConDetalle;
  presentacion: PresentacionProducto | null;
  /** Cantidad a vender en la unidad del producto (o en presentaciones si `tipo` es PRESENTACION) */
  cantidad: number;
  /** Solo BALANZA: peso en kilogramos y/o importe que traía la etiqueta */
  etiqueta: { plu: string; tipo: TipoEtiquetaBalanza; pesoKg: number | null; importe: number | null } | null;
}

/** Cuántas unidades de cada medida hay en un kilogramo. */
const UNIDADES_POR_KG: Record<string, number> = { KG: 1, LB: 2.20462, G: 1000 };

export function kilosAUnidad(kg: number, codigoUnidad: string): number | null {
  const f = UNIDADES_POR_KG[codigoUnidad];
  return f === undefined ? null : round3(kg * f);
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

export class EscaneoService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly productos: ProductoService,
    private readonly configuracion: ConfiguracionRepository,
    private readonly giro: GiroService
  ) {}

  async resolver(codigoEntrada: string, actor: ActorCaja): Promise<ResultadoEscaneo> {
    const codigo = codigoEntrada.trim();
    if (codigo === "" || codigo.length > 64) throw new AppError("VALIDACION", "Código de barras inválido");

    const directo = await this.buscar(codigo);
    if (directo !== null) {
      return directo.presentacion === null
        ? { tipo: "PRODUCTO", producto: directo.producto, presentacion: null, cantidad: 1, etiqueta: null }
        : { tipo: "PRESENTACION", producto: directo.producto, presentacion: directo.presentacion, cantidad: 1, etiqueta: null };
    }

    const cfg = await this.configuracion.porEmpresa(this.prisma, actor.empresaId);
    const tipo: TipoEtiquetaBalanza = cfg?.balanzaEtiqueta === "PRECIO" ? "PRECIO" : "PESO";
    const etiqueta = leerEtiquetaBalanza(codigo, tipo);
    if (etiqueta === null) throw new AppError("NO_ENCONTRADO", `Sin producto para el código ${codigo}`);

    await this.giro.exigir(this.prisma, actor.empresaId, "moduloBalanza");
    const candidatos = [...new Set([etiqueta.plu, etiqueta.plu.replace(/^0+/, "")].filter((c) => c !== ""))];
    for (const c of candidatos) {
      const encontrado = await this.buscar(c);
      if (encontrado === null || encontrado.presentacion !== null) continue;
      const producto = encontrado.producto;
      const unidad = await this.prisma.unidadMedida.findUnique({ where: { id: producto.unidadMedidaId }, select: { codigo: true, nombre: true } });
      if (unidad === null) throw new AppError("NO_ENCONTRADO", "Unidad de medida no encontrada");

      if (etiqueta.tipo === "PESO") {
        const cantidad = kilosAUnidad(etiqueta.valor, unidad.codigo);
        if (cantidad === null) throw new AppError("VALIDACION", `"${producto.nombre}" no se vende por peso (unidad ${unidad.nombre})`);
        if (cantidad <= 0) throw new AppError("VALIDACION", "La etiqueta de la balanza trae un peso de 0");
        return { tipo: "BALANZA", producto, presentacion: null, cantidad, etiqueta: { plu: etiqueta.plu, tipo: "PESO", pesoKg: etiqueta.valor, importe: null } };
      }
      // PRECIO: el importe de la etiqueta se divide para el precio unitario (sin IVA) del producto
      if (producto.precioVenta <= 0) throw new AppError("VALIDACION", `"${producto.nombre}" no tiene precio de venta`);
      if (etiqueta.valor <= 0) throw new AppError("VALIDACION", "La etiqueta de la balanza trae un importe de 0");
      const cantidad = round3(etiqueta.valor / producto.precioVenta);
      return { tipo: "BALANZA", producto, presentacion: null, cantidad, etiqueta: { plu: etiqueta.plu, tipo: "PRECIO", pesoKg: null, importe: round2(etiqueta.valor) } };
    }
    throw new AppError("NO_ENCONTRADO", `Sin producto para el PLU ${etiqueta.plu} de la balanza`);
  }

  private async buscar(codigo: string): Promise<{ producto: ProductoConDetalle; presentacion: PresentacionProducto | null } | null> {
    try {
      const r = await this.productos.porCodigoBarras(codigo);
      const { presentacion, id } = r;
      const producto = await this.prisma.producto.findUniqueOrThrow({ where: { id }, include: incluirParaVenta });
      return { producto, presentacion };
    } catch (e) {
      if (e instanceof AppError && e.codigo === "NO_ENCONTRADO") return null;
      throw e;
    }
  }
}

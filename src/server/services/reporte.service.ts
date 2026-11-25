// ============================================================
// src/server/services/reporte.service.ts — Reportes gerenciales (ventas, utilidad, stock valorado y cartera)
//
// Todos devuelven la misma forma (`Reporte`): columnas, filas y totales; sirve para la tabla de la pantalla y para el CSV.
// Las fechas son días civiles de Ecuador. Solo cuentan las ventas COMPLETADAS (las anuladas no suman).
// ============================================================
import { Prisma, type PrismaClient } from "@prisma/client";
import { ReporteQuerySchema, type TipoReporte } from "../../shared/schemas/gestion.schema";
import { AppError } from "./appError.util";
import { rangoFechas } from "./consulta.service";
import type { ActorCaja } from "./turno.service";
import { parsear } from "./validation.util";
import { round2 } from "./ventaCalculo.util";

export interface ColumnaReporte {
  clave: string;
  titulo: string;
  tipo: "texto" | "numero" | "dinero";
}

export type CeldaReporte = string | number;

export interface Reporte {
  tipo: TipoReporte;
  titulo: string;
  /** Periodo consultado (cuando aplica) */
  desde: string | null;
  hasta: string | null;
  columnas: ColumnaReporte[];
  filas: Array<Record<string, CeldaReporte>>;
  /** Suma de las columnas numéricas y de dinero */
  totales: Record<string, number>;
}

function totalizar(columnas: ColumnaReporte[], filas: Array<Record<string, CeldaReporte>>): Record<string, number> {
  const t: Record<string, number> = {};
  for (const c of columnas) {
    if (c.tipo === "texto") continue;
    t[c.clave] = round2(filas.reduce((a, f) => a + (typeof f[c.clave] === "number" ? (f[c.clave] as number) : 0), 0));
  }
  return t;
}

const D = (clave: string, titulo: string): ColumnaReporte => ({ clave, titulo, tipo: "dinero" });
const N = (clave: string, titulo: string): ColumnaReporte => ({ clave, titulo, tipo: "numero" });
const T = (clave: string, titulo: string): ColumnaReporte => ({ clave, titulo, tipo: "texto" });

/** Orden alfabético del idioma del sistema; un `Intl.Collator` reutilizado compara ~4× más rápido que `a.localeCompare(b)` (que construye uno en cada llamada). */
const comparar = new Intl.Collator().compare;

const DIA_MS = 86_400_000;
const DESFASE_ECUADOR_MS = 5 * 3_600_000;

interface AgregadoSql {
  cantidad: bigint | number;
  subtotal: number;
  descuento: number;
  iva: number;
  total: number;
}

export class ReporteService {
  constructor(private readonly prisma: PrismaClient) {}

  /** Condición SQL común: ventas COMPLETADAS de la empresa en el rango (los valores van como parámetros, nunca concatenados). Requiere los alias `v` (Venta) y `s` (Sucursal). */
  private filtroVentas(empresaId: string, rango: { gte?: Date; lt?: Date }): Prisma.Sql {
    return Prisma.sql`s.empresaId = ${empresaId} AND v.estado = 'COMPLETADA'${rango.gte !== undefined ? Prisma.sql` AND v.createdAt >= ${rango.gte.getTime()}` : Prisma.empty}${rango.lt !== undefined ? Prisma.sql` AND v.createdAt < ${rango.lt.getTime()}` : Prisma.empty}`;
  }

  async generar(tipo: string, entrada: unknown, actor: ActorCaja): Promise<Reporte> {
    const q = parsear(ReporteQuerySchema, entrada ?? {});
    if (q.formato === "csv" && !actor.permisos.includes("reportes:exportar")) {
      throw new AppError("SIN_PERMISO", "Permiso requerido: reportes:exportar");
    }
    if (q.desde !== undefined && q.hasta !== undefined && q.desde > q.hasta) throw new AppError("VALIDACION", "La fecha «desde» no puede ser posterior a «hasta»");
    switch (tipo) {
      case "ventas":
        return this.ventas(actor, q.desde, q.hasta, q.agrupar);
      case "utilidad":
        return this.utilidad(actor, q.desde, q.hasta);
      case "stock":
        return this.stock();
      case "cartera":
        return this.cartera(actor);
      default:
        throw new AppError("VALIDACION", `Reporte desconocido: ${tipo}`);
    }
  }

  private async ventas(actor: ActorCaja, desde: string | undefined, hasta: string | undefined, agrupar: "dia" | "producto" | "formaPago" | "cajero"): Promise<Reporte> {
    const rango = rangoFechas(desde, hasta);
    const filtro = this.filtroVentas(actor.empresaId, rango);
    const grupos = new Map<string, { etiqueta: string; cantidad: number; subtotal: number; descuento: number; iva: number; total: number }>();
    const sumar = (clave: string, etiqueta: string, cantidad: number, s: number, d: number, i: number, t: number): void => {
      const g = grupos.get(clave) ?? { etiqueta, cantidad: 0, subtotal: 0, descuento: 0, iva: 0, total: 0 };
      g.cantidad += cantidad;
      g.subtotal += s;
      g.descuento += d;
      g.iva += i;
      g.total += t;
      grupos.set(clave, g);
    };
    let titulo: string;
    let primera: ColumnaReporte;

    // Las sumas las hace la base de datos: con decenas de miles de ventas, traer cada fila a JavaScript para sumarla tarda segundos
    if (agrupar === "producto") {
      titulo = "Ventas por producto";
      primera = T("grupo", "Producto");
      const filas = await this.prisma.$queryRaw<Array<AgregadoSql & { codigo: string; nombre: string }>>(Prisma.sql`
        SELECT p.codigo AS codigo, p.nombre AS nombre, t.cantidad AS cantidad, t.subtotal AS subtotal, t.descuento AS descuento, t.iva AS iva, t.total AS total
        FROM (
          SELECT l.productoId AS productoId, SUM(l.cantidad) AS cantidad, SUM(l.subtotal) AS subtotal, SUM(l.descuento) AS descuento, SUM(l.iva) AS iva, SUM(l.total) AS total
          FROM LineaVenta l JOIN Venta v ON v.id = l.ventaId JOIN Sucursal s ON s.id = v.sucursalId
          WHERE ${filtro} GROUP BY l.productoId
        ) t JOIN Producto p ON p.id = t.productoId`);
      for (const f of filas) sumar(f.codigo, `${f.codigo} · ${f.nombre}`, Number(f.cantidad), Number(f.subtotal), Number(f.descuento), Number(f.iva), Number(f.total));
    } else if (agrupar === "formaPago") {
      titulo = "Ventas por forma de pago";
      primera = T("grupo", "Forma de pago");
      const filas = await this.prisma.$queryRaw<Array<{ formaPago: string; pagos: bigint | number; neto: number }>>(Prisma.sql`
        SELECT pv.formaPago AS formaPago, COUNT(*) AS pagos, SUM(pv.monto - pv.cambio) AS neto
        FROM PagoVenta pv JOIN Venta v ON v.id = pv.ventaId JOIN Sucursal s ON s.id = v.sucursalId
        WHERE ${filtro} GROUP BY pv.formaPago`);
      for (const f of filas) sumar(f.formaPago, f.formaPago, Number(f.pagos), Number(f.neto), 0, 0, Number(f.neto));
    } else if (agrupar === "cajero") {
      titulo = "Ventas por cajero";
      primera = T("grupo", "Cajero");
      const filas = await this.prisma.$queryRaw<Array<AgregadoSql & { nombre: string; apellido: string }>>(Prisma.sql`
        SELECT u.nombre AS nombre, u.apellido AS apellido, COUNT(*) AS cantidad, SUM(v.subtotal) AS subtotal, SUM(v.descuento) AS descuento, SUM(v.iva) AS iva, SUM(v.total) AS total
        FROM Venta v JOIN Sucursal s ON s.id = v.sucursalId JOIN Usuario u ON u.id = v.cajeroId
        WHERE ${filtro} GROUP BY u.id`);
      for (const f of filas) {
        const clave = `${f.nombre} ${f.apellido}`.trim(); // dos usuarios con el mismo nombre se muestran juntos, como antes
        sumar(clave, clave, Number(f.cantidad), Number(f.subtotal), Number(f.descuento), Number(f.iva), Number(f.total));
      }
    } else {
      titulo = "Ventas por día";
      primera = T("grupo", "Día");
      // Día civil de Ecuador (UTC−5, sin horario de verano): las fechas se guardan como milisegundos
      const filas = await this.prisma.$queryRaw<Array<AgregadoSql & { dia: bigint | number }>>(Prisma.sql`
        SELECT CAST((v.createdAt - ${DESFASE_ECUADOR_MS}) / ${DIA_MS} AS INTEGER) AS dia, COUNT(*) AS cantidad, SUM(v.subtotal) AS subtotal, SUM(v.descuento) AS descuento, SUM(v.iva) AS iva, SUM(v.total) AS total
        FROM Venta v JOIN Sucursal s ON s.id = v.sucursalId
        WHERE ${filtro} GROUP BY dia`);
      for (const f of filas) {
        const clave = new Date(Number(f.dia) * DIA_MS).toISOString().slice(0, 10);
        sumar(clave, clave, Number(f.cantidad), Number(f.subtotal), Number(f.descuento), Number(f.iva), Number(f.total));
      }
    }

    const columnas: ColumnaReporte[] = [primera, N("cantidad", agrupar === "producto" ? "Cantidad" : agrupar === "formaPago" ? "Pagos" : "Ventas"), D("subtotal", agrupar === "formaPago" ? "Valor" : "Subtotal"), D("descuento", "Descuento"), D("iva", "IVA"), D("total", "Total")];
    const filas = [...grupos.entries()]
      .sort(([a], [b]) => comparar(a, b))
      .map(([, g]) => ({ grupo: g.etiqueta, cantidad: round2(g.cantidad), subtotal: round2(g.subtotal), descuento: round2(g.descuento), iva: round2(g.iva), total: round2(g.total) }));
    return { tipo: "ventas", titulo, desde: desde ?? null, hasta: hasta ?? null, columnas, filas, totales: totalizar(columnas, filas) };
  }

  /** Utilidad = ventas sin IVA − costo promedio de lo vendido (al momento de cada venta). */
  private async utilidad(actor: ActorCaja, desde: string | undefined, hasta: string | undefined): Promise<Reporte> {
    const rango = rangoFechas(desde, hasta);
    const filtro = this.filtroVentas(actor.empresaId, rango);
    const lineas = await this.prisma.$queryRaw<Array<{ codigo: string; nombre: string; cantidad: number; ingresos: number; costo: number }>>(Prisma.sql`
      SELECT p.codigo AS codigo, p.nombre AS nombre, t.cantidad AS cantidad, t.ingresos AS ingresos, t.costo AS costo
      FROM (
        SELECT l.productoId AS productoId, SUM(l.cantidadBase) AS cantidad, SUM(l.subtotal) AS ingresos, SUM(l.cantidadBase * l.costoUnitario) AS costo
        FROM LineaVenta l JOIN Venta v ON v.id = l.ventaId JOIN Sucursal s ON s.id = v.sucursalId
        WHERE ${filtro} GROUP BY l.productoId
      ) t JOIN Producto p ON p.id = t.productoId`);
    const grupos = new Map<string, { nombre: string; cantidad: number; ingresos: number; costo: number }>();
    for (const l of lineas) grupos.set(l.codigo, { nombre: `${l.codigo} · ${l.nombre}`, cantidad: Number(l.cantidad), ingresos: Number(l.ingresos), costo: Number(l.costo) });
    const columnas = [T("producto", "Producto"), N("cantidad", "Cantidad (unidades base)"), D("ingresos", "Ventas sin IVA"), D("costo", "Costo"), D("utilidad", "Utilidad"), N("margen", "Margen %")];
    const filas = [...grupos.entries()]
      .sort(([a], [b]) => comparar(a, b))
      .map(([, g]) => ({ producto: g.nombre, cantidad: round2(g.cantidad), ingresos: round2(g.ingresos), costo: round2(g.costo), utilidad: round2(g.ingresos - g.costo), margen: g.ingresos > 0 ? round2(((g.ingresos - g.costo) / g.ingresos) * 100) : 0 }));
    const totales = totalizar(columnas, filas);
    totales["margen"] = (totales["ingresos"] ?? 0) > 0 ? round2(((totales["utilidad"] ?? 0) / (totales["ingresos"] ?? 1)) * 100) : 0;
    return { tipo: "utilidad", titulo: "Utilidad por producto", desde: desde ?? null, hasta: hasta ?? null, columnas, filas, totales };
  }

  /** Existencias al costo promedio ponderado. */
  private async stock(): Promise<Reporte> {
    const productos = await this.prisma.producto.findMany({ where: { tipo: "BIEN", status: "ACTIVO", stockActual: { not: 0 } }, select: { codigo: true, nombre: true, stockActual: true, costoPromedio: true, categoria: { select: { nombre: true } }, unidadMedida: { select: { codigo: true } } }, orderBy: { nombre: "asc" } });
    const columnas = [T("codigo", "Código"), T("producto", "Producto"), T("categoria", "Categoría"), T("unidad", "Unidad"), N("stock", "Existencia"), D("costo", "Costo promedio"), D("valor", "Valor")];
    const filas = productos.map((p) => ({ codigo: p.codigo, producto: p.nombre, categoria: p.categoria.nombre, unidad: p.unidadMedida.codigo, stock: round2(p.stockActual), costo: round2(p.costoPromedio), valor: round2(p.stockActual * p.costoPromedio) }));
    const totales = totalizar(columnas, filas);
    delete totales["costo"];
    return { tipo: "stock", titulo: "Stock valorado", desde: null, hasta: null, columnas, filas, totales };
  }

  /** Lo que nos deben (clientes) y lo que debemos (proveedores), con lo vencido. */
  private async cartera(actor: ActorCaja): Promise<Reporte> {
    const ahora = new Date();
    const [cobrar, pagar] = await Promise.all([
      this.prisma.cuentaPorCobrar.findMany({ where: { saldo: { gt: 0 }, estado: { not: "ANULADA" }, venta: { sucursal: { empresaId: actor.empresaId } } }, select: { saldo: true, fechaVencimiento: true, cliente: { select: { razonSocial: true } } } }),
      this.prisma.cuentaPorPagar.findMany({ where: { saldo: { gt: 0 }, estado: { not: "ANULADA" }, compra: { sucursal: { empresaId: actor.empresaId } } }, select: { saldo: true, fechaVencimiento: true, proveedor: { select: { razonSocial: true } } } }),
    ]);
    const agrupar = (tipo: string, filas: Array<{ nombre: string; saldo: number; vence: Date }>): Array<Record<string, CeldaReporte>> => {
      const m = new Map<string, { cuentas: number; saldo: number; vencido: number }>();
      for (const f of filas) {
        const g = m.get(f.nombre) ?? { cuentas: 0, saldo: 0, vencido: 0 };
        g.cuentas += 1;
        g.saldo += f.saldo;
        if (f.vence.getTime() < ahora.getTime()) g.vencido += f.saldo;
        m.set(f.nombre, g);
      }
      return [...m.entries()].sort(([a], [b]) => comparar(a, b)).map(([nombre, g]) => ({ tipo, tercero: nombre, cuentas: g.cuentas, saldo: round2(g.saldo), vencido: round2(g.vencido) }));
    };
    const columnas = [T("tipo", "Tipo"), T("tercero", "Cliente / Proveedor"), N("cuentas", "Cuentas"), D("saldo", "Saldo"), D("vencido", "Vencido")];
    const filas = [
      ...agrupar("Por cobrar", cobrar.map((c) => ({ nombre: c.cliente.razonSocial, saldo: c.saldo, vence: c.fechaVencimiento }))),
      ...agrupar("Por pagar", pagar.map((c) => ({ nombre: c.proveedor.razonSocial, saldo: c.saldo, vence: c.fechaVencimiento }))),
    ];
    // Los totales de «saldo» mezclarían cobrar y pagar: se informan por separado
    const totales: Record<string, number> = {
      porCobrar: round2(filas.filter((f) => f["tipo"] === "Por cobrar").reduce((a, f) => a + (f["saldo"] as number), 0)),
      porCobrarVencido: round2(filas.filter((f) => f["tipo"] === "Por cobrar").reduce((a, f) => a + (f["vencido"] as number), 0)),
      porPagar: round2(filas.filter((f) => f["tipo"] === "Por pagar").reduce((a, f) => a + (f["saldo"] as number), 0)),
      porPagarVencido: round2(filas.filter((f) => f["tipo"] === "Por pagar").reduce((a, f) => a + (f["vencido"] as number), 0)),
    };
    return { tipo: "cartera", titulo: "Cartera (por cobrar y por pagar)", desde: null, hasta: null, columnas, filas, totales };
  }
}

// ── CSV ──────────────────────────────────────────────────────

/** Evita que Excel interprete una celda de texto como fórmula (`=`, `+`, `-`, `@`). */
function celdaCsv(v: CeldaReporte): string {
  let t = typeof v === "number" ? String(v) : v;
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return /[",\n\r;]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

/** CSV UTF-8 con BOM (Excel lo abre con acentos), separado por comas, con una fila final de totales. */
export function reporteACsv(r: Reporte): string {
  const lineas = [r.columnas.map((c) => celdaCsv(c.titulo)).join(",")];
  for (const f of r.filas) lineas.push(r.columnas.map((c) => celdaCsv(f[c.clave] ?? "")).join(","));
  const totales = r.columnas.map((c, i) => (i === 0 ? "TOTAL" : r.totales[c.clave] !== undefined ? String(r.totales[c.clave]) : ""));
  if (r.tipo !== "cartera" && r.filas.length > 0) lineas.push(totales.map(celdaCsv).join(","));
  return `﻿${lineas.join("\r\n")}\r\n`;
}

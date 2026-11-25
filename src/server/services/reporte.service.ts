// ============================================================
// src/server/services/reporte.service.ts — Reportes gerenciales (ventas, utilidad, stock valorado y cartera)
//
// Todos devuelven la misma forma (`Reporte`): columnas, filas y totales; sirve para la tabla de la pantalla y para el CSV.
// Las fechas son días civiles de Ecuador. Solo cuentan las ventas COMPLETADAS (las anuladas no suman).
// ============================================================
import type { PrismaClient } from "@prisma/client";
import { ReporteQuerySchema, type TipoReporte } from "../../shared/schemas/gestion.schema";
import { AppError } from "./appError.util";
import { rangoFechas } from "./consulta.service";
import { aFechaCivilEcuador } from "./sri/fechaEcuador.util";
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

const dos = (n: number): string => String(n).padStart(2, "0");
const dia = (f: Date): string => {
  const c = aFechaCivilEcuador(f);
  return `${c.anio}-${dos(c.mes)}-${dos(c.dia)}`;
};

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

export class ReporteService {
  constructor(private readonly prisma: PrismaClient) {}

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
    const base = { sucursal: { empresaId: actor.empresaId }, estado: "COMPLETADA", ...(rango.gte !== undefined || rango.lt !== undefined ? { createdAt: rango } : {}) };
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

    if (agrupar === "producto") {
      titulo = "Ventas por producto";
      primera = T("grupo", "Producto");
      const lineas = await this.prisma.lineaVenta.findMany({ where: { venta: base }, select: { cantidad: true, subtotal: true, descuento: true, iva: true, total: true, producto: { select: { codigo: true, nombre: true } } } });
      for (const l of lineas) sumar(l.producto.codigo, `${l.producto.codigo} · ${l.producto.nombre}`, l.cantidad, l.subtotal, l.descuento, l.iva, l.total);
    } else if (agrupar === "formaPago") {
      titulo = "Ventas por forma de pago";
      primera = T("grupo", "Forma de pago");
      const pagos = await this.prisma.pagoVenta.findMany({ where: { venta: base }, select: { formaPago: true, monto: true, cambio: true } });
      for (const p of pagos) {
        const neto = p.monto - p.cambio;
        sumar(p.formaPago, p.formaPago, 1, neto, 0, 0, neto);
      }
    } else {
      const ventas = await this.prisma.venta.findMany({ where: base, select: { createdAt: true, subtotal: true, descuento: true, iva: true, total: true, cajero: { select: { nombre: true, apellido: true } } } });
      titulo = agrupar === "dia" ? "Ventas por día" : "Ventas por cajero";
      primera = T("grupo", agrupar === "dia" ? "Día" : "Cajero");
      for (const v of ventas) {
        const clave = agrupar === "dia" ? dia(v.createdAt) : `${v.cajero.nombre} ${v.cajero.apellido}`.trim();
        sumar(clave, clave, 1, v.subtotal, v.descuento, v.iva, v.total);
      }
    }

    const columnas: ColumnaReporte[] = [primera, N("cantidad", agrupar === "producto" ? "Cantidad" : agrupar === "formaPago" ? "Pagos" : "Ventas"), D("subtotal", agrupar === "formaPago" ? "Valor" : "Subtotal"), D("descuento", "Descuento"), D("iva", "IVA"), D("total", "Total")];
    const filas = [...grupos.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, g]) => ({ grupo: g.etiqueta, cantidad: round2(g.cantidad), subtotal: round2(g.subtotal), descuento: round2(g.descuento), iva: round2(g.iva), total: round2(g.total) }));
    return { tipo: "ventas", titulo, desde: desde ?? null, hasta: hasta ?? null, columnas, filas, totales: totalizar(columnas, filas) };
  }

  /** Utilidad = ventas sin IVA − costo promedio de lo vendido (al momento de cada venta). */
  private async utilidad(actor: ActorCaja, desde: string | undefined, hasta: string | undefined): Promise<Reporte> {
    const rango = rangoFechas(desde, hasta);
    const lineas = await this.prisma.lineaVenta.findMany({
      where: { venta: { sucursal: { empresaId: actor.empresaId }, estado: "COMPLETADA", ...(rango.gte !== undefined || rango.lt !== undefined ? { createdAt: rango } : {}) } },
      select: { cantidadBase: true, subtotal: true, costoUnitario: true, producto: { select: { codigo: true, nombre: true } } },
    });
    const grupos = new Map<string, { nombre: string; cantidad: number; ingresos: number; costo: number }>();
    for (const l of lineas) {
      const g = grupos.get(l.producto.codigo) ?? { nombre: `${l.producto.codigo} · ${l.producto.nombre}`, cantidad: 0, ingresos: 0, costo: 0 };
      g.cantidad += l.cantidadBase;
      g.ingresos += l.subtotal;
      g.costo += l.cantidadBase * l.costoUnitario;
      grupos.set(l.producto.codigo, g);
    }
    const columnas = [T("producto", "Producto"), N("cantidad", "Cantidad (unidades base)"), D("ingresos", "Ventas sin IVA"), D("costo", "Costo"), D("utilidad", "Utilidad"), N("margen", "Margen %")];
    const filas = [...grupos.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
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
      return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([nombre, g]) => ({ tipo, tercero: nombre, cuentas: g.cuentas, saldo: round2(g.saldo), vencido: round2(g.vencido) }));
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

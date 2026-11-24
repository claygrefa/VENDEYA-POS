// ============================================================
// src/server/services/sri/comprobanteXml.builder.ts
// Constructores de XML del SRI: Factura 2.1.0 y Nota de Crédito 1.1.0.
// Son funciones puras. El orden de los nodos y los formatos siguen los XSD oficiales
// (src/server/services/sri/xsd) y se verifican contra ellos en las pruebas.
// ============================================================
import { create } from "xmlbuilder2";
import type { XMLBuilder } from "xmlbuilder2/lib/interfaces";
import { CODIGO_IMPUESTO_IVA, VERSION_XML_COMPROBANTE } from "../../../shared/constants/sri.constants";
import { AppError } from "../appError.util";
import { round2 } from "../ventaCalculo.util";
import type {
  CampoAdicional,
  DatosEmisor,
  DatosFactura,
  DatosNotaCredito,
  LineaComprobante,
  TotalImpuestoAgrupado,
} from "./comprobante.types";
import { fechaParaXml } from "./fechaEcuador.util";
import { formatoDinero, formatoUnitario, limpiarTexto, limpiarTextoOpcional } from "./xmlTexto.util";

export const VERSION_FACTURA = VERSION_XML_COMPROBANTE["01"];
export const VERSION_NOTA_CREDITO = VERSION_XML_COMPROBANTE["04"];
export const COD_DOC_FACTURA = "01";
export const COD_DOC_NOTA_CREDITO = "04";

/** Leyenda obligatoria para contribuyentes RIMPE (el XSD solo admite este texto). */
const LEYENDA_RIMPE = "CONTRIBUYENTE RÉGIMEN RIMPE";
const MAX_CAMPOS_ADICIONALES = 15; // Ficha Técnica, 9.11

const sinTexto = (v: string | undefined): v is string => v !== undefined && v !== "";

/** Suma de los totales por (código de tarifa) — base imponible e impuesto. */
export function agruparImpuestos(lineas: ReadonlyArray<LineaComprobante>): TotalImpuestoAgrupado[] {
  const grupos = new Map<string, TotalImpuestoAgrupado>();
  for (const l of lineas) {
    const g = grupos.get(l.impuesto.codigoPorcentaje);
    if (g === undefined) {
      grupos.set(l.impuesto.codigoPorcentaje, { ...l.impuesto });
    } else {
      g.baseImponible = round2(g.baseImponible + l.impuesto.baseImponible);
      g.valor = round2(g.valor + l.impuesto.valor);
    }
  }
  return [...grupos.values()].sort((a, b) => a.codigoPorcentaje.localeCompare(b.codigoPorcentaje, "es", { numeric: true }));
}

export interface TotalesComprobante {
  totalSinImpuestos: number;
  totalDescuento: number;
  totalImpuestos: number;
  impuestos: TotalImpuestoAgrupado[];
}

export function calcularTotalesComprobante(lineas: ReadonlyArray<LineaComprobante>): TotalesComprobante {
  if (lineas.length === 0) throw new AppError("VALIDACION", "El comprobante debe tener al menos una línea");
  const impuestos = agruparImpuestos(lineas);
  return {
    totalSinImpuestos: round2(lineas.reduce((a, l) => a + l.precioTotalSinImpuesto, 0)),
    totalDescuento: round2(lineas.reduce((a, l) => a + l.descuento, 0)),
    totalImpuestos: round2(impuestos.reduce((a, i) => a + i.valor, 0)),
    impuestos,
  };
}

// ── Bloques comunes ──────────────────────────────────────────

export function infoTributaria(raiz: XMLBuilder, e: DatosEmisor, claveAcceso: string, codDoc: string, secuencial: string): void {
  const n = raiz.ele("infoTributaria");
  n.ele("ambiente").txt(e.ambiente);
  n.ele("tipoEmision").txt("1");
  n.ele("razonSocial").txt(limpiarTexto(e.razonSocial, 300));
  n.ele("nombreComercial").txt(limpiarTexto(e.nombreComercial, 300, limpiarTexto(e.razonSocial, 300)));
  n.ele("ruc").txt(e.ruc);
  n.ele("claveAcceso").txt(claveAcceso);
  n.ele("codDoc").txt(codDoc);
  n.ele("estab").txt(e.estab);
  n.ele("ptoEmi").txt(e.ptoEmi);
  n.ele("secuencial").txt(secuencial);
  n.ele("dirMatriz").txt(limpiarTexto(e.dirMatriz, 300));
  if (sinTexto(e.agenteRetencion)) n.ele("agenteRetencion").txt(e.agenteRetencion);
  if (e.contribuyenteRimpe) n.ele("contribuyenteRimpe").txt(LEYENDA_RIMPE);
}

export function detalles(raiz: XMLBuilder, lineas: ReadonlyArray<LineaComprobante>, tipo: "factura" | "notaCredito"): void {
  const nodo = raiz.ele("detalles");
  for (const l of lineas) {
    const d = nodo.ele("detalle");
    d.ele(tipo === "factura" ? "codigoPrincipal" : "codigoInterno").txt(limpiarTexto(l.codigoPrincipal, 25));
    d.ele("descripcion").txt(limpiarTexto(l.descripcion, 300));
    const unidad = limpiarTextoOpcional(l.unidadMedida, 50);
    if (tipo === "factura" && unidad !== undefined) d.ele("unidadMedida").txt(unidad);
    d.ele("cantidad").txt(formatoUnitario(l.cantidad));
    d.ele("precioUnitario").txt(formatoUnitario(l.precioUnitario));
    d.ele("descuento").txt(formatoDinero(l.descuento));
    d.ele("precioTotalSinImpuesto").txt(formatoDinero(l.precioTotalSinImpuesto));
    const imp = d.ele("impuestos").ele("impuesto");
    imp.ele("codigo").txt(CODIGO_IMPUESTO_IVA);
    imp.ele("codigoPorcentaje").txt(l.impuesto.codigoPorcentaje);
    imp.ele("tarifa").txt(formatoDinero(l.impuesto.tarifa));
    imp.ele("baseImponible").txt(formatoDinero(l.impuesto.baseImponible));
    imp.ele("valor").txt(formatoDinero(l.impuesto.valor));
  }
}

export function infoAdicional(raiz: XMLBuilder, campos: ReadonlyArray<CampoAdicional>): void {
  const validos = campos
    .map((c) => ({ nombre: limpiarTextoOpcional(c.nombre, 300), valor: limpiarTextoOpcional(c.valor, 300) }))
    .filter((c): c is { nombre: string; valor: string } => c.nombre !== undefined && c.valor !== undefined)
    .slice(0, MAX_CAMPOS_ADICIONALES);
  if (validos.length === 0) return;
  const nodo = raiz.ele("infoAdicional");
  for (const c of validos) nodo.ele("campoAdicional", { nombre: c.nombre }).txt(c.valor);
}

export function validarComun(d: { claveAcceso: string; secuencial: string }): void {
  if (!/^\d{49}$/.test(d.claveAcceso)) throw new AppError("VALIDACION", "La clave de acceso debe tener 49 dígitos");
  if (!/^\d{9}$/.test(d.secuencial)) throw new AppError("VALIDACION", "El secuencial debe tener 9 dígitos");
}

// ── Factura ──────────────────────────────────────────────────

/** Construye el XML sin firmar de una factura (versión 2.1.0). */
export function construirFacturaXml(d: DatosFactura): string {
  validarComun(d);
  const t = calcularTotalesComprobante(d.lineas);
  const importeTotal = round2(t.totalSinImpuestos + t.totalImpuestos + d.propina);

  const sumaPagos = round2(d.pagos.reduce((a, p) => a + p.total, 0));
  if (d.pagos.length === 0) throw new AppError("VALIDACION", "La factura debe tener al menos una forma de pago");
  if (Math.abs(sumaPagos - importeTotal) > 0.005) {
    throw new AppError("VALIDACION", `Los pagos (${formatoDinero(sumaPagos)}) no cubren el importe total (${formatoDinero(importeTotal)})`);
  }

  const raiz = create({ version: "1.0", encoding: "UTF-8" }).ele("factura", { id: "comprobante", version: VERSION_FACTURA });
  infoTributaria(raiz, d.emisor, d.claveAcceso, COD_DOC_FACTURA, d.secuencial);

  const f = raiz.ele("infoFactura");
  f.ele("fechaEmision").txt(fechaParaXml(d.fechaEmision));
  f.ele("dirEstablecimiento").txt(limpiarTexto(d.emisor.dirEstablecimiento, 300));
  if (sinTexto(d.emisor.contribuyenteEspecial)) f.ele("contribuyenteEspecial").txt(d.emisor.contribuyenteEspecial);
  f.ele("obligadoContabilidad").txt(d.emisor.obligadoContabilidad ? "SI" : "NO");
  f.ele("tipoIdentificacionComprador").txt(d.comprador.tipoIdentificacion);
  f.ele("razonSocialComprador").txt(limpiarTexto(d.comprador.razonSocial, 300));
  f.ele("identificacionComprador").txt(limpiarTexto(d.comprador.identificacion, 20));
  const direccion = limpiarTextoOpcional(d.comprador.direccion, 300);
  if (direccion !== undefined) f.ele("direccionComprador").txt(direccion);
  f.ele("totalSinImpuestos").txt(formatoDinero(t.totalSinImpuestos));
  f.ele("totalDescuento").txt(formatoDinero(t.totalDescuento));
  const totales = f.ele("totalConImpuestos");
  for (const i of t.impuestos) {
    const ti = totales.ele("totalImpuesto");
    ti.ele("codigo").txt(CODIGO_IMPUESTO_IVA);
    ti.ele("codigoPorcentaje").txt(i.codigoPorcentaje);
    ti.ele("baseImponible").txt(formatoDinero(i.baseImponible));
    ti.ele("tarifa").txt(formatoDinero(i.tarifa));
    ti.ele("valor").txt(formatoDinero(i.valor));
  }
  f.ele("propina").txt(formatoDinero(d.propina));
  f.ele("importeTotal").txt(formatoDinero(importeTotal));
  f.ele("moneda").txt("DOLAR");
  const pagos = f.ele("pagos");
  for (const p of agruparPagos(d.pagos)) {
    const pg = pagos.ele("pago");
    pg.ele("formaPago").txt(p.formaPago);
    pg.ele("total").txt(formatoDinero(p.total));
    if (p.plazo !== undefined) {
      pg.ele("plazo").txt(formatoDinero(p.plazo));
      pg.ele("unidadTiempo").txt(p.unidadTiempo ?? "dias");
    }
  }

  detalles(raiz, d.lineas, "factura");
  infoAdicional(raiz, d.infoAdicional);
  return raiz.doc().end({ prettyPrint: false });
}

/** Une los pagos de la misma forma (el SRI no necesita el detalle por transacción). */
function agruparPagos(pagos: ReadonlyArray<DatosFactura["pagos"][number]>): DatosFactura["pagos"] {
  const grupos = new Map<string, DatosFactura["pagos"][number]>();
  for (const p of pagos) {
    const clave = `${p.formaPago}|${p.plazo ?? ""}|${p.unidadTiempo ?? ""}`;
    const g = grupos.get(clave);
    if (g === undefined) grupos.set(clave, { ...p });
    else g.total = round2(g.total + p.total);
  }
  return [...grupos.values()];
}

// ── Nota de crédito ──────────────────────────────────────────

/** Construye el XML sin firmar de una nota de crédito (versión 1.1.0). */
export function construirNotaCreditoXml(d: DatosNotaCredito): string {
  validarComun(d);
  if (d.comprador.tipoIdentificacion === "07") {
    // Ficha Técnica 5.7: en notas de crédito se debe identificar al receptor (no admite Consumidor Final)
    throw new AppError("VALIDACION", "La nota de crédito exige identificar al comprador: no admite Consumidor Final");
  }
  if (!/^\d{3}-\d{3}-\d{9}$/.test(d.docModificado.numero)) {
    throw new AppError("VALIDACION", `Número de documento modificado inválido: ${d.docModificado.numero}`);
  }
  const t = calcularTotalesComprobante(d.lineas);
  const valorModificacion = round2(t.totalSinImpuestos + t.totalImpuestos);

  const raiz = create({ version: "1.0", encoding: "UTF-8" }).ele("notaCredito", { id: "comprobante", version: VERSION_NOTA_CREDITO });
  infoTributaria(raiz, d.emisor, d.claveAcceso, COD_DOC_NOTA_CREDITO, d.secuencial);

  const n = raiz.ele("infoNotaCredito");
  n.ele("fechaEmision").txt(fechaParaXml(d.fechaEmision));
  n.ele("dirEstablecimiento").txt(limpiarTexto(d.emisor.dirEstablecimiento, 300));
  n.ele("tipoIdentificacionComprador").txt(d.comprador.tipoIdentificacion);
  n.ele("razonSocialComprador").txt(limpiarTexto(d.comprador.razonSocial, 300));
  n.ele("identificacionComprador").txt(limpiarTexto(d.comprador.identificacion, 20));
  if (sinTexto(d.emisor.contribuyenteEspecial)) n.ele("contribuyenteEspecial").txt(d.emisor.contribuyenteEspecial);
  n.ele("obligadoContabilidad").txt(d.emisor.obligadoContabilidad ? "SI" : "NO");
  n.ele("codDocModificado").txt(d.docModificado.codDoc);
  n.ele("numDocModificado").txt(d.docModificado.numero);
  n.ele("fechaEmisionDocSustento").txt(fechaParaXml(d.docModificado.fechaEmision));
  n.ele("totalSinImpuestos").txt(formatoDinero(t.totalSinImpuestos));
  n.ele("valorModificacion").txt(formatoDinero(valorModificacion));
  n.ele("moneda").txt("DOLAR");
  const totales = n.ele("totalConImpuestos");
  for (const i of t.impuestos) {
    const ti = totales.ele("totalImpuesto");
    ti.ele("codigo").txt(CODIGO_IMPUESTO_IVA);
    ti.ele("codigoPorcentaje").txt(i.codigoPorcentaje);
    ti.ele("baseImponible").txt(formatoDinero(i.baseImponible));
    ti.ele("valor").txt(formatoDinero(i.valor));
  }
  n.ele("motivo").txt(limpiarTexto(d.motivo, 300));

  detalles(raiz, d.lineas, "notaCredito");
  infoAdicional(raiz, d.infoAdicional);
  return raiz.doc().end({ prettyPrint: false });
}

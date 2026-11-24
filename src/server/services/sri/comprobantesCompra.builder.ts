// ============================================================
// src/server/services/sri/comprobantesCompra.builder.ts
// Constructores de XML del SRI para: Comprobante de Retención 2.0.0 (07), Liquidación de Compra 1.1.0 (03) y
// Guía de Remisión 1.1.0 (06). Funciones puras; el orden de los nodos y los formatos siguen los XSD oficiales
// (src/server/services/sri/xsd) y se verifican contra ellos en las pruebas.
// ============================================================
import { create } from "xmlbuilder2";
import { CODIGO_IMPUESTO_IVA } from "../../../shared/constants/sri.constants";
import { AppError } from "../appError.util";
import { round2 } from "../ventaCalculo.util";
import type { CampoAdicional, DatosEmisor, LineaComprobante, PagoComprobante } from "./comprobante.types";
import { calcularTotalesComprobante, infoAdicional, infoTributaria, detalles, validarComun } from "./comprobanteXml.builder";
import { fechaParaXml } from "./fechaEcuador.util";
import { formatoDinero, formatoUnitario, limpiarTexto, limpiarTextoOpcional } from "./xmlTexto.util";

export const COD_DOC_LIQUIDACION = "03";
export const COD_DOC_GUIA_REMISION = "06";
export const COD_DOC_RETENCION = "07";
export const VERSION_RETENCION = "2.0.0";
export const VERSION_LIQUIDACION = "1.1.0";
export const VERSION_GUIA_REMISION = "1.1.0";

const sinTexto = (v: string | undefined): v is string => v !== undefined && v !== "";

function datosContribuyente(n: ReturnType<ReturnType<typeof create>["ele"]>, e: DatosEmisor): void {
  if (sinTexto(e.contribuyenteEspecial)) n.ele("contribuyenteEspecial").txt(e.contribuyenteEspecial);
  n.ele("obligadoContabilidad").txt(e.obligadoContabilidad ? "SI" : "NO");
}

// ── Comprobante de Retención (07) ────────────────────────────

export type CodigoImpuestoRetencion = "1" | "2" | "6";

export interface LineaRetencion {
  /** 1 = Renta · 2 = IVA · 6 = ISD */
  codigo: CodigoImpuestoRetencion;
  /** Código de retención del SRI (máx. 5 caracteres) */
  codigoRetencion: string;
  baseImponible: number;
  /** Porcentaje a retener */
  porcentaje: number;
  valor: number;
}

export interface DatosRetencion {
  emisor: DatosEmisor;
  claveAcceso: string;
  secuencial: string;
  fechaEmision: Date;
  sujeto: {
    /** 04 RUC · 05 cédula · 06 pasaporte · 07 consumidor final · 08 identificación del exterior */
    tipoIdentificacion: "04" | "05" | "06" | "08";
    identificacion: string;
    razonSocial: string;
    /** 01 persona natural · 02 sociedad */
    tipoSujeto: "01" | "02";
    parteRelacionada: boolean;
  };
  /** MM/AAAA */
  periodoFiscal: string;
  docSustento: {
    /** Sustento tributario (2 dígitos) */
    codSustento: string;
    /** Tipo del documento que sustenta (01 factura, 03 liquidación…) */
    codDocSustento: string;
    /** 15 dígitos: establecimiento + punto + secuencial */
    numDocSustento: string;
    fechaEmision: Date;
    fechaRegistroContable: Date;
    numAutorizacion?: string | undefined;
    totalSinImpuestos: number;
    importeTotal: number;
    impuestos: Array<{ codigoPorcentaje: string; baseImponible: number; tarifa: number; valor: number }>;
    pagos: PagoComprobante[];
  };
  retenciones: LineaRetencion[];
  infoAdicional: CampoAdicional[];
}

export function construirRetencionXml(d: DatosRetencion): string {
  validarComun(d);
  if (d.retenciones.length === 0) throw new AppError("VALIDACION", "El comprobante de retención necesita al menos una retención");
  if (!/^(0[1-9]|1[012])\/20\d\d$/.test(d.periodoFiscal)) throw new AppError("VALIDACION", `Periodo fiscal inválido: ${d.periodoFiscal}`);
  if (!/^\d{15}$/.test(d.docSustento.numDocSustento)) throw new AppError("VALIDACION", "El documento sustento debe tener 15 dígitos (establecimiento, punto y secuencial)");
  if (d.docSustento.pagos.length === 0) throw new AppError("VALIDACION", "El documento sustento necesita al menos una forma de pago");
  for (const r of d.retenciones) {
    const esperado = round2((r.baseImponible * r.porcentaje) / 100);
    if (Math.abs(esperado - r.valor) > 0.011) {
      throw new AppError("VALIDACION", `Retención ${r.codigoRetencion}: el valor ${formatoDinero(r.valor)} no corresponde a ${formatoDinero(r.baseImponible)} × ${r.porcentaje} %`);
    }
  }

  const raiz = create({ version: "1.0", encoding: "UTF-8" }).ele("comprobanteRetencion", { id: "comprobante", version: VERSION_RETENCION });
  infoTributaria(raiz, d.emisor, d.claveAcceso, COD_DOC_RETENCION, d.secuencial);

  const i = raiz.ele("infoCompRetencion");
  i.ele("fechaEmision").txt(fechaParaXml(d.fechaEmision));
  i.ele("dirEstablecimiento").txt(limpiarTexto(d.emisor.dirEstablecimiento, 300));
  datosContribuyente(i, d.emisor);
  i.ele("tipoIdentificacionSujetoRetenido").txt(d.sujeto.tipoIdentificacion);
  i.ele("tipoSujetoRetenido").txt(d.sujeto.tipoSujeto);
  i.ele("parteRel").txt(d.sujeto.parteRelacionada ? "SI" : "NO");
  i.ele("razonSocialSujetoRetenido").txt(limpiarTexto(d.sujeto.razonSocial, 300));
  i.ele("identificacionSujetoRetenido").txt(limpiarTexto(d.sujeto.identificacion, 20));
  i.ele("periodoFiscal").txt(d.periodoFiscal);

  const s = d.docSustento;
  const ds = raiz.ele("docsSustento").ele("docSustento");
  ds.ele("codSustento").txt(s.codSustento);
  ds.ele("codDocSustento").txt(s.codDocSustento);
  ds.ele("numDocSustento").txt(s.numDocSustento);
  ds.ele("fechaEmisionDocSustento").txt(fechaParaXml(s.fechaEmision));
  ds.ele("fechaRegistroContable").txt(fechaParaXml(s.fechaRegistroContable));
  if (sinTexto(s.numAutorizacion)) ds.ele("numAutDocSustento").txt(s.numAutorizacion);
  ds.ele("pagoLocExt").txt("01");
  ds.ele("totalSinImpuestos").txt(formatoDinero(s.totalSinImpuestos));
  ds.ele("importeTotal").txt(formatoDinero(s.importeTotal));
  const imps = ds.ele("impuestosDocSustento");
  for (const t of s.impuestos) {
    const n = imps.ele("impuestoDocSustento");
    n.ele("codImpuestoDocSustento").txt(CODIGO_IMPUESTO_IVA);
    n.ele("codigoPorcentaje").txt(t.codigoPorcentaje);
    n.ele("baseImponible").txt(formatoDinero(t.baseImponible));
    n.ele("tarifa").txt(formatoDinero(t.tarifa));
    n.ele("valorImpuesto").txt(formatoDinero(t.valor));
  }
  const rets = ds.ele("retenciones");
  for (const r of d.retenciones) {
    const n = rets.ele("retencion");
    n.ele("codigo").txt(r.codigo);
    n.ele("codigoRetencion").txt(limpiarTexto(r.codigoRetencion, 5));
    n.ele("baseImponible").txt(formatoDinero(r.baseImponible));
    n.ele("porcentajeRetener").txt(formatoDinero(r.porcentaje));
    n.ele("valorRetenido").txt(formatoDinero(r.valor));
  }
  const pagos = ds.ele("pagos");
  for (const p of s.pagos) {
    const n = pagos.ele("pago");
    n.ele("formaPago").txt(p.formaPago);
    n.ele("total").txt(formatoDinero(p.total));
  }

  infoAdicional(raiz, d.infoAdicional);
  return raiz.doc().end({ prettyPrint: false });
}

// ── Liquidación de Compra (03) ───────────────────────────────

export interface DatosLiquidacion {
  emisor: DatosEmisor;
  claveAcceso: string;
  secuencial: string;
  fechaEmision: Date;
  proveedor: {
    /** 04 RUC · 05 cédula · 06 pasaporte · 08 identificación del exterior */
    tipoIdentificacion: "04" | "05" | "06" | "08";
    identificacion: string;
    razonSocial: string;
    direccion?: string | undefined;
  };
  lineas: LineaComprobante[];
  pagos: PagoComprobante[];
  infoAdicional: CampoAdicional[];
}

export function construirLiquidacionXml(d: DatosLiquidacion): string {
  validarComun(d);
  if (d.lineas.length === 0) throw new AppError("VALIDACION", "La liquidación de compra necesita al menos una línea");
  const t = calcularTotalesComprobante(d.lineas);
  const importeTotal = round2(t.totalSinImpuestos + t.totalImpuestos);
  const sumaPagos = round2(d.pagos.reduce((a, p) => a + p.total, 0));
  if (d.pagos.length === 0) throw new AppError("VALIDACION", "La liquidación de compra debe tener al menos una forma de pago");
  if (Math.abs(sumaPagos - importeTotal) > 0.005) {
    throw new AppError("VALIDACION", `Los pagos (${formatoDinero(sumaPagos)}) no cubren el importe total (${formatoDinero(importeTotal)})`);
  }

  const raiz = create({ version: "1.0", encoding: "UTF-8" }).ele("liquidacionCompra", { id: "comprobante", version: VERSION_LIQUIDACION });
  infoTributaria(raiz, d.emisor, d.claveAcceso, COD_DOC_LIQUIDACION, d.secuencial);

  const n = raiz.ele("infoLiquidacionCompra");
  n.ele("fechaEmision").txt(fechaParaXml(d.fechaEmision));
  n.ele("dirEstablecimiento").txt(limpiarTexto(d.emisor.dirEstablecimiento, 300));
  datosContribuyente(n, d.emisor);
  n.ele("tipoIdentificacionProveedor").txt(d.proveedor.tipoIdentificacion);
  n.ele("razonSocialProveedor").txt(limpiarTexto(d.proveedor.razonSocial, 300));
  n.ele("identificacionProveedor").txt(limpiarTexto(d.proveedor.identificacion, 20));
  const direccion = limpiarTextoOpcional(d.proveedor.direccion, 300);
  if (direccion !== undefined) n.ele("direccionProveedor").txt(direccion);
  n.ele("totalSinImpuestos").txt(formatoDinero(t.totalSinImpuestos));
  n.ele("totalDescuento").txt(formatoDinero(t.totalDescuento));
  const totales = n.ele("totalConImpuestos");
  for (const i of t.impuestos) {
    const ti = totales.ele("totalImpuesto");
    ti.ele("codigo").txt(CODIGO_IMPUESTO_IVA);
    ti.ele("codigoPorcentaje").txt(i.codigoPorcentaje);
    ti.ele("baseImponible").txt(formatoDinero(i.baseImponible));
    ti.ele("tarifa").txt(formatoDinero(i.tarifa));
    ti.ele("valor").txt(formatoDinero(i.valor));
  }
  n.ele("importeTotal").txt(formatoDinero(importeTotal));
  n.ele("moneda").txt("DOLAR");
  const pagos = n.ele("pagos");
  for (const p of d.pagos) {
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

// ── Guía de Remisión (06) ────────────────────────────────────

export interface DetalleGuia {
  codigoInterno: string;
  descripcion: string;
  cantidad: number;
}

export interface DestinatarioGuia {
  identificacion: string;
  razonSocial: string;
  direccion: string;
  motivoTraslado: string;
  /** Establecimiento de destino (3 dígitos) */
  codEstabDestino?: string | undefined;
  ruta?: string | undefined;
  /** Documento que sustenta el traslado (p. ej. la factura) */
  sustento?: { codDoc: string; numero: string; numAutorizacion?: string | undefined; fechaEmision: Date } | undefined;
  detalles: DetalleGuia[];
}

export interface DatosGuiaRemision {
  emisor: DatosEmisor;
  claveAcceso: string;
  secuencial: string;
  dirPartida: string;
  transportista: {
    /** 04 RUC · 05 cédula · 06 pasaporte · 08 identificación del exterior */
    tipoIdentificacion: "04" | "05" | "06" | "08";
    identificacion: string;
    razonSocial: string;
  };
  fechaInicioTransporte: Date;
  fechaFinTransporte: Date;
  placa: string;
  destinatarios: DestinatarioGuia[];
  infoAdicional: CampoAdicional[];
}

export function construirGuiaRemisionXml(d: DatosGuiaRemision): string {
  validarComun(d);
  if (d.destinatarios.length === 0) throw new AppError("VALIDACION", "La guía de remisión necesita al menos un destinatario");
  if (d.fechaFinTransporte.getTime() < d.fechaInicioTransporte.getTime()) {
    throw new AppError("VALIDACION", "La fecha de fin del transporte no puede ser anterior a la de inicio");
  }

  const raiz = create({ version: "1.0", encoding: "UTF-8" }).ele("guiaRemision", { id: "comprobante", version: VERSION_GUIA_REMISION });
  infoTributaria(raiz, d.emisor, d.claveAcceso, COD_DOC_GUIA_REMISION, d.secuencial);

  const g = raiz.ele("infoGuiaRemision");
  g.ele("dirEstablecimiento").txt(limpiarTexto(d.emisor.dirEstablecimiento, 300));
  g.ele("dirPartida").txt(limpiarTexto(d.dirPartida, 300));
  g.ele("razonSocialTransportista").txt(limpiarTexto(d.transportista.razonSocial, 300));
  g.ele("tipoIdentificacionTransportista").txt(d.transportista.tipoIdentificacion);
  g.ele("rucTransportista").txt(limpiarTexto(d.transportista.identificacion, 20));
  datosContribuyente(g, d.emisor);
  g.ele("fechaIniTransporte").txt(fechaParaXml(d.fechaInicioTransporte));
  g.ele("fechaFinTransporte").txt(fechaParaXml(d.fechaFinTransporte));
  g.ele("placa").txt(limpiarTexto(d.placa, 20));

  const dests = raiz.ele("destinatarios");
  for (const x of d.destinatarios) {
    if (x.detalles.length === 0) throw new AppError("VALIDACION", `El destinatario ${x.razonSocial} no tiene productos`);
    const n = dests.ele("destinatario");
    n.ele("identificacionDestinatario").txt(limpiarTexto(x.identificacion, 20));
    n.ele("razonSocialDestinatario").txt(limpiarTexto(x.razonSocial, 300));
    n.ele("dirDestinatario").txt(limpiarTexto(x.direccion, 300));
    n.ele("motivoTraslado").txt(limpiarTexto(x.motivoTraslado, 300));
    if (sinTexto(x.codEstabDestino)) n.ele("codEstabDestino").txt(x.codEstabDestino);
    const ruta = limpiarTextoOpcional(x.ruta, 300);
    if (ruta !== undefined) n.ele("ruta").txt(ruta);
    if (x.sustento !== undefined) {
      n.ele("codDocSustento").txt(x.sustento.codDoc);
      n.ele("numDocSustento").txt(x.sustento.numero);
      if (sinTexto(x.sustento.numAutorizacion)) n.ele("numAutDocSustento").txt(x.sustento.numAutorizacion);
      n.ele("fechaEmisionDocSustento").txt(fechaParaXml(x.sustento.fechaEmision));
    }
    const ds = n.ele("detalles");
    for (const l of x.detalles) {
      const dn = ds.ele("detalle");
      dn.ele("codigoInterno").txt(limpiarTexto(l.codigoInterno, 25));
      dn.ele("descripcion").txt(limpiarTexto(l.descripcion, 300));
      dn.ele("cantidad").txt(formatoUnitario(l.cantidad));
    }
  }

  infoAdicional(raiz, d.infoAdicional);
  return raiz.doc().end({ prettyPrint: false });
}

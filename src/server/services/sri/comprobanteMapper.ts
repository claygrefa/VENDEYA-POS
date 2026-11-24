// ============================================================
// src/server/services/sri/comprobanteMapper.ts
// Convierte una venta (con sus líneas, pagos, cliente y emisor) en los datos de un comprobante SRI.
// Funciones puras: no tocan la base de datos.
// ============================================================
import {
  CONSUMIDOR_FINAL,
  FORMAS_PAGO_SRI,
  MONTO_MAXIMO_CONSUMIDOR_FINAL,
  PROPINA_MAXIMA_PORCENTAJE,
} from "../../../shared/constants/sri.constants";
import type { VentaParaEmision } from "../../repositories/comprobante.repository";
import { AppError } from "../appError.util";
import { round2 } from "../ventaCalculo.util";
import type { AmbienteSri } from "./claveAcceso.util";
import type {
  CampoAdicional,
  DatosComprador,
  DatosEmisor,
  DatosFactura,
  DatosNotaCredito,
  LineaComprobante,
  PagoComprobante,
  TipoIdentificacionComprador,
} from "./comprobante.types";

// ── Formas de pago ───────────────────────────────────────────

/**
 * Forma de pago interna → código de la Tabla 24 del SRI.
 * Efectivo y venta a crédito: "sin utilización del sistema financiero" (el crédito lleva plazo);
 * tarjetas: 19 (crédito) y 16 (débito); transferencias, cheques y otros: "otros con utilización del sistema financiero".
 */
export function codigoFormaPagoSri(formaPago: string): string {
  switch (formaPago) {
    case "EFECTIVO":
    case "CREDITO":
      return FORMAS_PAGO_SRI.SIN_SISTEMA_FINANCIERO;
    case "TARJETA_CREDITO":
      return FORMAS_PAGO_SRI.TARJETA_CREDITO;
    case "TARJETA_DEBITO":
      return FORMAS_PAGO_SRI.TARJETA_DEBITO;
    default:
      return FORMAS_PAGO_SRI.OTROS_SISTEMA_FINANCIERO;
  }
}

/** Para líneas anteriores al registro del código SRI: se deduce del porcentaje (el 0 % sin más datos es el código "0"). */
export function codigoIvaDesdePorcentaje(porcentaje: number): string {
  const tabla: Record<number, string> = { 0: "0", 12: "2", 14: "3", 15: "4", 5: "5", 13: "10" };
  const codigo = tabla[porcentaje];
  if (codigo === undefined) throw new AppError("VALIDACION", `No se puede determinar el código SRI del IVA ${porcentaje} %`);
  return codigo;
}

// ── Emisor ───────────────────────────────────────────────────

export function construirEmisor(venta: VentaParaEmision, ambienteForzado?: AmbienteSri): DatosEmisor {
  const empresa = venta.sucursal.empresa;
  const resolucion = (empresa.resolucionAgente ?? "").replace(/\D/g, "").slice(0, 8);
  return {
    ambiente: ambienteForzado ?? (empresa.ambienteSRI === "PRODUCCION" ? "2" : "1"),
    razonSocial: empresa.razonSocial,
    nombreComercial: empresa.nombreComercial,
    ruc: empresa.ruc,
    dirMatriz: empresa.direccionMatriz,
    agenteRetencion: empresa.agenteRetencion && resolucion !== "" ? resolucion : undefined,
    contribuyenteRimpe: empresa.regimenTributario === "RIMPE_EMPRENDEDOR" || empresa.regimenTributario === "RIMPE_NEGOCIO_POPULAR",
    contribuyenteEspecial: empresa.contribuyenteEspecial ?? undefined,
    obligadoContabilidad: empresa.obligadoContabilidad,
    estab: venta.sucursal.codigo,
    ptoEmi: venta.puntoEmision.codigo,
    dirEstablecimiento: venta.sucursal.direccion,
  };
}

// ── Comprador ────────────────────────────────────────────────

function inferirTipoIdentificacion(identificacion: string): TipoIdentificacionComprador {
  if (identificacion === CONSUMIDOR_FINAL.identificacion) return "07";
  if (/^\d{13}$/.test(identificacion)) return "04";
  if (/^\d{10}$/.test(identificacion)) return "05";
  return "06";
}

/** Cliente registrado → sus datos; si no, se interpreta la identificación guardada en la venta; sin nada → Consumidor Final. */
export function determinarComprador(venta: VentaParaEmision): DatosComprador {
  if (venta.cliente !== null) {
    const c = venta.cliente;
    const tipo = (["04", "05", "06", "07", "08"] as const).find((t) => t === c.tipoIdentificacion);
    if (tipo === undefined) throw new AppError("VALIDACION", `Tipo de identificación del cliente inválido: ${c.tipoIdentificacion}`);
    return { tipoIdentificacion: tipo, identificacion: c.identificacion, razonSocial: c.razonSocial, direccion: c.direccion ?? undefined };
  }
  const identificacion = venta.clienteRuc ?? CONSUMIDOR_FINAL.identificacion;
  const tipo = inferirTipoIdentificacion(identificacion);
  return {
    tipoIdentificacion: tipo,
    identificacion,
    razonSocial: tipo === "07" ? CONSUMIDOR_FINAL.razonSocial : (venta.clienteNombre ?? CONSUMIDOR_FINAL.razonSocial),
  };
}

// ── Líneas y pagos ───────────────────────────────────────────

export function lineasDeVenta(venta: VentaParaEmision): LineaComprobante[] {
  return venta.lineas.map((l) => {
    const codigoPorcentaje = l.codigoIvaSRI !== "" ? l.codigoIvaSRI : codigoIvaDesdePorcentaje(l.porcentajeIva);
    return {
      codigoPrincipal: l.producto.codigo,
      descripcion: l.descripcion,
      unidadMedida: l.producto.unidadMedida.nombre,
      cantidad: l.cantidad,
      precioUnitario: l.precioUnitario,
      descuento: l.descuento,
      precioTotalSinImpuesto: l.subtotal,
      impuesto: { codigoPorcentaje, tarifa: l.porcentajeIva, baseImponible: l.subtotal, valor: l.iva },
    };
  });
}

/** Pagos netos (lo recibido menos el cambio), de modo que su suma sea el importe total de la factura. */
export function pagosDeVenta(venta: VentaParaEmision): PagoComprobante[] {
  const plazoDias =
    venta.cuentaPorCobrar === null
      ? 0
      : Math.max(0, Math.round((venta.cuentaPorCobrar.fechaVencimiento.getTime() - venta.cuentaPorCobrar.fechaEmision.getTime()) / 86_400_000));
  return venta.pagos
    .map<PagoComprobante>((p) => {
      const base: PagoComprobante = { formaPago: codigoFormaPagoSri(p.formaPago), total: round2(p.monto - p.cambio) };
      return p.formaPago === "CREDITO" ? { ...base, plazo: plazoDias, unidadTiempo: "dias" } : base;
    })
    .filter((p) => p.total > 0);
}

function infoAdicionalDeVenta(venta: VentaParaEmision): CampoAdicional[] {
  const campos: CampoAdicional[] = [{ nombre: "Venta", valor: venta.numero }];
  if (venta.cliente?.email) campos.push({ nombre: "Email", valor: venta.cliente.email });
  if (venta.cliente?.telefono) campos.push({ nombre: "Telefono", valor: venta.cliente.telefono });
  if (venta.observaciones) campos.push({ nombre: "Observaciones", valor: venta.observaciones });
  return campos;
}

// ── Reglas de la Ficha Técnica ───────────────────────────────

/** Consumidor Final hasta USD 50 (9.10) y propina hasta el 10 % del subtotal (9.16). */
export function validarReglasFactura(venta: VentaParaEmision, comprador: DatosComprador): void {
  const importeTotal = round2(venta.total + venta.propina);
  if (comprador.tipoIdentificacion === "07" && importeTotal > MONTO_MAXIMO_CONSUMIDOR_FINAL) {
    throw new AppError(
      "VALIDACION",
      `Una factura a Consumidor Final no puede superar USD ${MONTO_MAXIMO_CONSUMIDOR_FINAL} (esta es de ${importeTotal.toFixed(2)}): identifique al comprador`
    );
  }
  if (venta.propina > 0 && venta.propina > round2((venta.subtotal * PROPINA_MAXIMA_PORCENTAJE) / 100) + 0.005) {
    throw new AppError(
      "VALIDACION",
      `La propina (${venta.propina.toFixed(2)}) no puede superar el ${PROPINA_MAXIMA_PORCENTAJE} % del subtotal (${venta.subtotal.toFixed(2)})`
    );
  }
}

// ── Comprobantes completos ───────────────────────────────────

export interface EntradaEmision {
  claveAcceso: string;
  /** 9 dígitos */
  secuencial: string;
  fechaEmision: Date;
}

export function datosFacturaDeVenta(venta: VentaParaEmision, e: EntradaEmision): DatosFactura {
  const comprador = determinarComprador(venta);
  validarReglasFactura(venta, comprador);
  return {
    emisor: construirEmisor(venta),
    claveAcceso: e.claveAcceso,
    secuencial: e.secuencial,
    fechaEmision: e.fechaEmision,
    comprador,
    lineas: lineasDeVenta(venta),
    propina: venta.propina,
    pagos: pagosDeVenta(venta),
    infoAdicional: infoAdicionalDeVenta(venta),
  };
}

export interface FacturaModificada {
  /** serie + secuencial de la factura: 001-001-000000001 */
  numero: string;
  fechaEmision: Date;
  ambiente: AmbienteSri;
}

/** Nota de crédito por el total de la venta (anulación). */
export function datosNotaCreditoDeVenta(venta: VentaParaEmision, factura: FacturaModificada, e: EntradaEmision, motivo: string): DatosNotaCredito {
  const comprador = determinarComprador(venta);
  if (comprador.tipoIdentificacion === "07") {
    throw new AppError(
      "ESTADO_INVALIDO",
      "La factura se emitió a Consumidor Final y la nota de crédito exige identificar al comprador: no puede anularse automáticamente"
    );
  }
  return {
    emisor: construirEmisor(venta, factura.ambiente),
    claveAcceso: e.claveAcceso,
    secuencial: e.secuencial,
    fechaEmision: e.fechaEmision,
    comprador,
    docModificado: { codDoc: "01", numero: factura.numero, fechaEmision: factura.fechaEmision },
    motivo,
    lineas: lineasDeVenta(venta),
    infoAdicional: [{ nombre: "Venta", valor: venta.numero }],
  };
}

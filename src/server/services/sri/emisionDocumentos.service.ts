// ============================================================
// src/server/services/sri/emisionDocumentos.service.ts
// Emisión de comprobantes electrónicos que no nacen de una venta:
//   · Comprobante de Retención (07): sobre una compra registrada; solo agentes de retención.
//   · Liquidación de Compra (03): sobre una compra cuyo documento es LIQUIDACION (la emite el comprador).
//   · Guía de Remisión (06): traslado de mercadería, con los datos que indica el usuario.
//
// Igual que la factura: todo lo que puede fallar (reglas, clave de acceso, XML y validación XSD) se resuelve ANTES de
// escribir; después queda PENDIENTE en la cola (las retenciones con prioridad 1) y el worker la firma y la envía.
// ============================================================
import type { ComprobanteElectronico, PrismaClient } from "@prisma/client";
import { EmitirGuiaRemisionSchema, EmitirLiquidacionSchema, EmitirRetencionSchema } from "../../../shared/schemas/documentosSri.schema";
import type { ComprobanteRepository, CompraParaDocumento, PuntoEmisionConEmpresa } from "../../repositories/comprobante.repository";
import type { Db } from "../../repositories/kardex.repository";
import { AppError } from "../appError.util";
import type { GiroService } from "../giro.service";
import type { ActorCaja } from "../turno.service";
import { parsear } from "../validation.util";
import { round2 } from "../ventaCalculo.util";
import { generarClaveAcceso, type AmbienteSri } from "./claveAcceso.util";
import type { DatosEmisor, LineaComprobante, PagoComprobante } from "./comprobante.types";
import {
  COD_DOC_GUIA_REMISION,
  COD_DOC_LIQUIDACION,
  COD_DOC_RETENCION,
  construirGuiaRemisionXml,
  construirLiquidacionXml,
  construirRetencionXml,
  type LineaRetencion,
} from "./comprobantesCompra.builder";
import { codigoIvaDesdePorcentaje } from "./comprobanteMapper";
import { fechaParaXml } from "./fechaEcuador.util";
import type { TipoXsd, XsdValidatorService } from "./xsdValidator.service";

const TX_OPCIONES = { maxWait: 30_000, timeout: 60_000 } as const;
/** Las retenciones van primero en la cola (ColaSRI.prioridad: 1 = alta). */
const PRIORIDAD_RETENCION = 1;
const PRIORIDAD_NORMAL = 5;

export interface ResultadoDocumento {
  comprobante: ComprobanteElectronico;
  /** false si la compra ya tenía ese documento (la emisión es idempotente) */
  creado: boolean;
}

// ── Utilidades de datos ──────────────────────────────────────

/** 04 RUC · 05 cédula · 06 pasaporte/otro (se deduce de la longitud: el proveedor guarda un solo campo). */
export function tipoIdentificacionDe(identificacion: string): "04" | "05" | "06" {
  if (/^\d{13}$/.test(identificacion)) return "04";
  if (/^\d{10}$/.test(identificacion)) return "05";
  return "06";
}

/** 02 sociedad (RUC con tercer dígito 6 o 9) · 01 persona natural. */
export function tipoSujetoDe(identificacion: string): "01" | "02" {
  return /^\d{2}[69]\d{10}$/.test(identificacion) ? "02" : "01";
}

/** "001-002-123" → "001002000000123" (15 dígitos: establecimiento + punto + secuencial de 9). */
export function numeroSustentoDe(numero: string): string | null {
  const m = /^(\d{3})-(\d{3})-(\d{1,9})$/.exec(numero.trim());
  return m === null ? null : `${m[1]}${m[2]}${(m[3] as string).padStart(9, "0")}`;
}

function emisorDe(pe: PuntoEmisionConEmpresa): DatosEmisor {
  const empresa = pe.sucursal.empresa;
  const resolucion = (empresa.resolucionAgente ?? "").replace(/\D/g, "").slice(0, 8);
  return {
    ambiente: empresa.ambienteSRI === "PRODUCCION" ? "2" : "1",
    razonSocial: empresa.razonSocial,
    nombreComercial: empresa.nombreComercial,
    ruc: empresa.ruc,
    dirMatriz: empresa.direccionMatriz,
    agenteRetencion: empresa.agenteRetencion && resolucion !== "" ? resolucion : undefined,
    contribuyenteRimpe: empresa.regimenTributario === "RIMPE_EMPRENDEDOR" || empresa.regimenTributario === "RIMPE_NEGOCIO_POPULAR",
    contribuyenteEspecial: empresa.contribuyenteEspecial ?? undefined,
    obligadoContabilidad: empresa.obligadoContabilidad,
    estab: pe.sucursal.codigo,
    ptoEmi: pe.codigo,
    dirEstablecimiento: pe.sucursal.direccion,
  };
}

interface Generado {
  emisor: DatosEmisor;
  claveAcceso: string;
  secuencial: string;
  fechaEmision: Date;
}

interface Solicitud {
  pe: PuntoEmisionConEmpresa;
  tipo: string;
  xsd: TipoXsd;
  compraId: string | null;
  prioridad: number;
  construir: (g: Generado) => string;
  retenciones?: LineaRetencion[];
}

export class EmisionDocumentosService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly repo: ComprobanteRepository,
    private readonly giro: GiroService,
    private readonly xsd: XsdValidatorService
  ) {}

  // ── Retención ──────────────────────────────────────────────

  async emitirRetencion(compraId: string, entrada: unknown, actor: ActorCaja): Promise<ResultadoDocumento> {
    const datos = parsear(EmitirRetencionSchema, entrada);
    return this.prisma.$transaction(async (tx) => {
      await this.giro.exigir(tx, actor.empresaId, "emitirRetenciones");
      const pe = await this.puntoEmision(tx, datos.puntoEmisionId, actor.empresaId);
      if (!pe.sucursal.empresa.agenteRetencion) {
        throw new AppError("VALIDACION", "Solo los agentes de retención pueden emitir comprobantes de retención (configúrelo en la empresa)");
      }
      const compra = await this.compra(tx, compraId, actor.empresaId);
      const existente = compra.comprobantes.find((c) => c.tipoComprobante === COD_DOC_RETENCION && c.estado !== "ANULADO");
      if (existente !== undefined) {
        return { comprobante: await tx.comprobanteElectronico.findUniqueOrThrow({ where: { id: existente.id } }), creado: false };
      }
      if (compra.estado !== "REGISTRADA") throw new AppError("ESTADO_INVALIDO", "La compra está anulada: no se emite retención");

      // Valores de las retenciones (el valor se calcula aquí) y coherencia con la compra
      const vistas = new Set<string>();
      const lineas: LineaRetencion[] = datos.retenciones.map((r) => {
        const clave = `${r.codigo}-${r.codigoRetencion}`;
        if (vistas.has(clave)) throw new AppError("VALIDACION", `La retención ${r.codigoRetencion} está repetida`);
        vistas.add(clave);
        const tope = r.codigo === "2" ? compra.iva : compra.subtotal;
        if (r.codigo !== "6" && r.baseImponible > tope + 0.005) {
          throw new AppError("VALIDACION", `La base de la retención ${r.codigoRetencion} (${r.baseImponible}) supera la ${r.codigo === "2" ? "del IVA" : "del subtotal"} de la compra (${tope})`);
        }
        return { ...r, valor: round2((r.baseImponible * r.porcentaje) / 100) };
      });

      const sustento = this.sustentoDe(compra);
      const impuestos = agruparIva(compra);
      const pagos: PagoComprobante[] = [{ formaPago: "01", total: round2(compra.total) }];
      const ahora = new Date();
      return this.emitir(tx, actor, {
        pe,
        tipo: COD_DOC_RETENCION,
        xsd: "retencion",
        compraId: compra.id,
        prioridad: PRIORIDAD_RETENCION,
        retenciones: lineas,
        construir: (g) =>
          construirRetencionXml({
            ...g,
            sujeto: {
              tipoIdentificacion: tipoIdentificacionDe(compra.proveedor.ruc),
              identificacion: compra.proveedor.ruc,
              razonSocial: compra.proveedor.razonSocial,
              tipoSujeto: tipoSujetoDe(compra.proveedor.ruc),
              parteRelacionada: datos.parteRelacionada,
            },
            periodoFiscal: fechaParaXml(ahora).slice(3),
            docSustento: {
              codSustento: compra.codSustento,
              codDocSustento: sustento.codDoc,
              numDocSustento: sustento.numero,
              fechaEmision: compra.fecha,
              fechaRegistroContable: compra.fecha,
              numAutorizacion: sustento.autorizacion,
              totalSinImpuestos: round2(compra.subtotal),
              importeTotal: round2(compra.total),
              impuestos,
              pagos,
            },
            retenciones: lineas,
            infoAdicional: [{ nombre: "Compra", valor: compra.numeroFactura }],
          }),
      });
    }, TX_OPCIONES);
  }

  // ── Liquidación de compra ──────────────────────────────────

  async emitirLiquidacion(compraId: string, entrada: unknown, actor: ActorCaja): Promise<ResultadoDocumento> {
    const datos = parsear(EmitirLiquidacionSchema, entrada);
    return this.prisma.$transaction(async (tx) => {
      await this.giro.exigir(tx, actor.empresaId, "emitirLiquidaciones");
      const pe = await this.puntoEmision(tx, datos.puntoEmisionId, actor.empresaId);
      const compra = await this.compra(tx, compraId, actor.empresaId);
      const existente = compra.comprobantes.find((c) => c.tipoComprobante === COD_DOC_LIQUIDACION && c.estado !== "ANULADO");
      if (existente !== undefined) {
        return { comprobante: await tx.comprobanteElectronico.findUniqueOrThrow({ where: { id: existente.id } }), creado: false };
      }
      if (compra.estado !== "REGISTRADA") throw new AppError("ESTADO_INVALIDO", "La compra está anulada: no se emite liquidación");
      if (compra.tipoDocumento !== "LIQUIDACION") {
        throw new AppError("VALIDACION", "Solo las compras registradas como LIQUIDACION (proveedor que no emite comprobantes) generan liquidación de compra");
      }

      const lineas: LineaComprobante[] = compra.lineas.map((l) => ({
        codigoPrincipal: l.producto.codigo,
        descripcion: l.producto.nombre,
        cantidad: l.cantidad,
        precioUnitario: l.costoUnitario,
        descuento: 0,
        precioTotalSinImpuesto: round2(l.subtotal),
        impuesto: { codigoPorcentaje: codigoIvaDesdePorcentaje(l.porcentajeIva), tarifa: l.porcentajeIva, baseImponible: round2(l.subtotal), valor: round2(l.iva) },
      }));
      const plazo =
        compra.cuentaPorPagar === null
          ? undefined
          : Math.max(0, Math.round((compra.cuentaPorPagar.fechaVencimiento.getTime() - compra.cuentaPorPagar.fechaEmision.getTime()) / 86_400_000));
      const pagos: PagoComprobante[] = [{ formaPago: "01", total: round2(compra.total), ...(plazo !== undefined ? { plazo, unidadTiempo: "dias" } : {}) }];

      return this.emitir(tx, actor, {
        pe,
        tipo: COD_DOC_LIQUIDACION,
        xsd: "liquidacionCompra",
        compraId: compra.id,
        prioridad: PRIORIDAD_NORMAL,
        construir: (g) =>
          construirLiquidacionXml({
            ...g,
            proveedor: {
              tipoIdentificacion: tipoIdentificacionDe(compra.proveedor.ruc),
              identificacion: compra.proveedor.ruc,
              razonSocial: compra.proveedor.razonSocial,
              direccion: compra.proveedor.direccion ?? undefined,
            },
            lineas,
            pagos,
            infoAdicional: [{ nombre: "Compra", valor: compra.numeroFactura }],
          }),
      });
    }, TX_OPCIONES);
  }

  // ── Guía de remisión ───────────────────────────────────────

  async emitirGuiaRemision(entrada: unknown, actor: ActorCaja): Promise<ResultadoDocumento> {
    const datos = parsear(EmitirGuiaRemisionSchema, entrada);
    return this.prisma.$transaction(async (tx) => {
      await this.giro.exigir(tx, actor.empresaId, "emitirGuiasRemision");
      const pe = await this.puntoEmision(tx, datos.puntoEmisionId, actor.empresaId);
      return this.emitir(tx, actor, {
        pe,
        tipo: COD_DOC_GUIA_REMISION,
        xsd: "guiaRemision",
        compraId: null,
        prioridad: PRIORIDAD_NORMAL,
        construir: (g) =>
          construirGuiaRemisionXml({
            ...g,
            dirPartida: datos.dirPartida,
            transportista: datos.transportista,
            fechaInicioTransporte: datos.fechaInicioTransporte,
            fechaFinTransporte: datos.fechaFinTransporte,
            placa: datos.placa,
            destinatarios: datos.destinatarios.map((d) => ({
              identificacion: d.identificacion,
              razonSocial: d.razonSocial,
              direccion: d.direccion,
              motivoTraslado: d.motivoTraslado,
              codEstabDestino: d.codEstabDestino,
              ruta: d.ruta,
              sustento: d.sustento === undefined ? undefined : { codDoc: d.sustento.codDoc, numero: d.sustento.numero, numAutorizacion: d.sustento.numAutorizacion, fechaEmision: d.sustento.fechaEmision },
              detalles: d.detalles,
            })),
            infoAdicional: datos.infoAdicional ?? [],
          }),
      });
    }, TX_OPCIONES);
  }

  // ── Internos ───────────────────────────────────────────────

  private async puntoEmision(db: Db, id: string, empresaId: string): Promise<PuntoEmisionConEmpresa> {
    const pe = await this.repo.puntoEmision(db, id, empresaId);
    if (pe === null) throw new AppError("NO_ENCONTRADO", "Punto de emisión no encontrado");
    if (pe.status !== "ACTIVO" || pe.sucursal.status !== "ACTIVO") throw new AppError("VALIDACION", "El punto de emisión o su sucursal están inactivos");
    return pe;
  }

  private async compra(db: Db, id: string, empresaId: string): Promise<CompraParaDocumento> {
    const c = await this.repo.compraParaDocumento(db, id, empresaId);
    if (c === null) throw new AppError("NO_ENCONTRADO", "Compra no encontrada");
    return c;
  }

  /** Documento que sustenta la compra: la factura/nota de venta del proveedor, o nuestra propia liquidación. */
  private sustentoDe(compra: CompraParaDocumento): { codDoc: string; numero: string; autorizacion: string | undefined } {
    if (compra.tipoDocumento === "LIQUIDACION") {
      const liq = compra.comprobantes.find((c) => c.tipoComprobante === COD_DOC_LIQUIDACION && c.estado !== "ANULADO");
      if (liq === undefined) throw new AppError("ESTADO_INVALIDO", "Emita primero la liquidación de compra: es el documento que sustenta la retención");
      return { codDoc: COD_DOC_LIQUIDACION, numero: `${liq.serie.replace("-", "")}${liq.secuencial}`, autorizacion: liq.claveAcceso };
    }
    const numero = numeroSustentoDe(compra.numeroFactura);
    if (numero === null) {
      throw new AppError("VALIDACION", `El número del documento de la compra ("${compra.numeroFactura}") debe tener el formato 001-001-000000123 para sustentar la retención`);
    }
    return {
      codDoc: compra.tipoDocumento === "NOTA_VENTA" ? "02" : "01",
      numero,
      autorizacion: compra.autorizacion !== null && /^\d{10,49}$/.test(compra.autorizacion) ? compra.autorizacion : undefined,
    };
  }

  /** Genera clave, secuencial y XML (validado contra el XSD) y solo entonces escribe. */
  private async emitir(db: Db, actor: ActorCaja, s: Solicitud): Promise<ResultadoDocumento> {
    const emisor = emisorDe(s.pe);
    const ambiente: AmbienteSri = emisor.ambiente;
    const fechaEmision = new Date();
    const secuencial = await this.repo.siguienteSecuencial(db, s.pe.id, s.tipo);
    const claveAcceso = generarClaveAcceso({
      fechaEmision,
      tipoComprobante: s.tipo,
      ruc: emisor.ruc,
      ambiente,
      establecimiento: s.pe.sucursal.codigo,
      puntoEmision: s.pe.codigo,
      secuencial,
    });
    const secuencialTexto = String(secuencial).padStart(9, "0");
    const xml = s.construir({ emisor, claveAcceso, secuencial: secuencialTexto, fechaEmision });
    const r = await this.xsd.validar(s.xsd, xml);
    if (!r.valido) {
      throw new AppError("VALIDACION", `El comprobante no cumple el esquema XSD del SRI: ${r.errores.slice(0, 5).map((e) => e.mensaje).join(" | ")}`);
    }

    // ── A partir de aquí solo se escribe ──
    const reservado = await this.repo.reservarSecuencial(db, s.pe.id, s.tipo);
    if (reservado !== secuencial) throw new Error(`Secuencial ${reservado} distinto del usado en el XML (${secuencial})`);
    const comprobante = await this.repo.crear(db, {
      ventaId: null,
      compraId: s.compraId,
      empresaId: actor.empresaId,
      sucursalId: s.pe.sucursalId,
      puntoEmisionId: s.pe.id,
      claveAcceso,
      tipoComprobante: s.tipo,
      ambiente,
      serie: `${s.pe.sucursal.codigo}-${s.pe.codigo}`,
      secuencial: secuencialTexto,
      fechaEmision,
      xmlGenerado: xml,
      motivo: null,
      comprobanteOrigenId: null,
    });
    if (s.retenciones !== undefined) {
      await this.repo.crearRetenciones(
        db,
        comprobante.id,
        s.retenciones.map((l) => ({ codigoImpuesto: l.codigo, codigoRetencion: l.codigoRetencion, baseImponible: l.baseImponible, porcentaje: l.porcentaje, valor: l.valor }))
      );
    }
    await this.repo.crearCola(db, comprobante.id, s.prioridad);
    return { comprobante, creado: true };
  }
}

/** IVA de la compra agrupado por tarifa (código de la Tabla 17). */
function agruparIva(compra: CompraParaDocumento): Array<{ codigoPorcentaje: string; baseImponible: number; tarifa: number; valor: number }> {
  const grupos = new Map<number, { baseImponible: number; valor: number }>();
  for (const l of compra.lineas) {
    const g = grupos.get(l.porcentajeIva) ?? { baseImponible: 0, valor: 0 };
    g.baseImponible += l.subtotal;
    g.valor += l.iva;
    grupos.set(l.porcentajeIva, g);
  }
  return [...grupos.entries()]
    .sort(([a], [b]) => a - b)
    .map(([tarifa, g]) => ({ codigoPorcentaje: codigoIvaDesdePorcentaje(tarifa), tarifa, baseImponible: round2(g.baseImponible), valor: round2(g.valor) }));
}

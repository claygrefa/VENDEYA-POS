// ============================================================
// src/server/services/sri/ats.service.ts — Anexo Transaccional Simplificado (ATS), XML mensual
//
// Secciones: compras (con sus retenciones), ventas por cliente y tipo de comprobante, ventas por establecimiento y anulados.
//
// ⚠️ El SRI no publica el `ats.xsd` en el portal de comprobantes electrónicos (el anexo se carga con DIMM Formularios) y
// no pudo obtenerse de una fuente oficial: este XML sigue la estructura publicada del anexo pero NO se valida contra un XSD.
// Se verifica con las reglas propias de este servicio y debe revisarse en DIMM antes de presentarse.
// ============================================================
import type { PrismaClient } from "@prisma/client";
import { create } from "xmlbuilder2";
import { CONSUMIDOR_FINAL } from "../../../shared/constants/sri.constants";
import { PeriodoAtsSchema } from "../../../shared/schemas/documentosSri.schema";
import type { AtsRepository, ComprobanteVentaAts, CompraAts, DocumentoCompraAts } from "../../repositories/ats.repository";
import { AppError } from "../appError.util";
import type { ActorCaja } from "../turno.service";
import { parsear } from "../validation.util";
import { round2 } from "../ventaCalculo.util";
import { codigoFormaPagoSri } from "./comprobanteMapper";
import { fechaParaXml } from "./fechaEcuador.util";
import { numeroSustentoDe, tipoIdentificacionDe } from "./emisionDocumentos.service";
import { formatoDinero, limpiarTexto } from "./xmlTexto.util";

const OFFSET_ECUADOR_HORAS = 5;

/** Código de tipo de comprobante del ATS para los documentos que emite este sistema. */
const TIPO_ATS_FACTURA = "18";
const TIPO_ATS_NOTA_CREDITO = "04";

/** % de retención de IVA → elemento del ATS. */
const ELEMENTO_RET_IVA: Record<number, "valRetBien10" | "valRetServ20" | "valorRetBienes" | "valRetServ50" | "valorRetServicios" | "valRetServ100"> = {
  10: "valRetBien10",
  20: "valRetServ20",
  30: "valorRetBienes",
  50: "valRetServ50",
  70: "valorRetServicios",
  100: "valRetServ100",
};

export interface ResumenAts {
  anio: number;
  mes: number;
  totalVentas: number;
  comprobantesVenta: number;
  compras: number;
  retenciones: number;
  /** Comprobantes de venta del periodo aún sin autorización: no están en el anexo */
  ventasPendientesAutorizacion: number;
}

export interface ResultadoAts {
  xml: string;
  resumen: ResumenAts;
}

/** Rango [desde, hasta) del mes en hora de Ecuador (UTC−5), en UTC. */
export function rangoMesEcuador(anio: number, mes: number): { desde: Date; hasta: Date } {
  return { desde: new Date(Date.UTC(anio, mes - 1, 1, OFFSET_ECUADOR_HORAS)), hasta: new Date(Date.UTC(anio, mes, 1, OFFSET_ECUADOR_HORAS)) };
}

function tipoClienteAts(identificacion: string): "04" | "05" | "06" | "07" {
  if (identificacion === CONSUMIDOR_FINAL.identificacion) return "07";
  return tipoIdentificacionDe(identificacion);
}

interface BasesVenta {
  noObjeto: number;
  cero: number;
  gravada: number;
  iva: number;
}

function basesDeVenta(c: ComprobanteVentaAts): { bases: BasesVenta; ventaId: string | null; identificacion: string; formas: string[] } {
  const venta = c.venta ?? c.origen?.venta ?? null;
  const bases: BasesVenta = { noObjeto: 0, cero: 0, gravada: 0, iva: 0 };
  if (venta === null) return { bases, ventaId: null, identificacion: CONSUMIDOR_FINAL.identificacion, formas: [] };
  for (const l of venta.lineas) {
    if (l.porcentajeIva > 0) bases.gravada += l.subtotal;
    else if (l.codigoIvaSRI === "6") bases.noObjeto += l.subtotal;
    else bases.cero += l.subtotal;
    bases.iva += l.iva;
  }
  const formas = [...new Set(venta.pagos.map((p) => codigoFormaPagoSri(p.formaPago)))];
  return { bases, ventaId: venta.id, identificacion: venta.clienteRuc ?? CONSUMIDOR_FINAL.identificacion, formas };
}

export class AtsService {
  constructor(private readonly prisma: PrismaClient, private readonly repo: AtsRepository) {}

  async generar(entrada: unknown, actor: ActorCaja): Promise<ResultadoAts> {
    const { anio, mes } = parsear(PeriodoAtsSchema, entrada);
    const { desde, hasta } = rangoMesEcuador(anio, mes);
    const db = this.prisma;

    const empresa = await this.repo.empresa(db, actor.empresaId);
    if (empresa === null) throw new AppError("NO_ENCONTRADO", "Empresa no encontrada");
    const establecimientos = await this.repo.codigosEstablecimientos(db, actor.empresaId);
    const ventas = await this.repo.ventasDelPeriodo(db, actor.empresaId, desde, hasta, ["AUTORIZADO"]);
    const pendientes = await this.repo.pendientesDelPeriodo(db, actor.empresaId, desde, hasta);
    const compras = await this.repo.comprasDelPeriodo(db, actor.empresaId, desde, hasta);
    const documentos = compras.length === 0 ? [] : await this.repo.documentosDeCompras(db, compras.map((c) => c.id));
    const anulados = await this.repo.anuladosDelPeriodo(db, actor.empresaId, desde, hasta);

    // ── Ventas por cliente y tipo de comprobante ──
    interface Grupo { tp: string; id: string; tipo: string; n: number; bases: BasesVenta; formas: Set<string> }
    const grupos = new Map<string, Grupo>();
    let totalVentas = 0;
    const porEstablecimiento = new Map<string, number>();
    for (const c of ventas) {
      const { bases, identificacion, formas } = basesDeVenta(c);
      const esNc = c.tipoComprobante === "04";
      const tipo = esNc ? TIPO_ATS_NOTA_CREDITO : TIPO_ATS_FACTURA;
      const clave = `${identificacion}|${tipo}`;
      const g = grupos.get(clave) ?? { tp: tipoClienteAts(identificacion), id: identificacion, tipo, n: 0, bases: { noObjeto: 0, cero: 0, gravada: 0, iva: 0 }, formas: new Set<string>() };
      g.n += 1;
      g.bases.noObjeto += bases.noObjeto;
      g.bases.cero += bases.cero;
      g.bases.gravada += bases.gravada;
      g.bases.iva += bases.iva;
      for (const f of formas) g.formas.add(f);
      grupos.set(clave, g);
      const neto = bases.noObjeto + bases.cero + bases.gravada;
      const signo = esNc ? -1 : 1;
      totalVentas += signo * neto;
      const estab = c.serie.split("-")[0] ?? "001";
      porEstablecimiento.set(estab, (porEstablecimiento.get(estab) ?? 0) + signo * neto);
    }

    // ── Compras y sus documentos ──
    const documentosPorCompra = new Map<string, DocumentoCompraAts[]>();
    for (const d of documentos) {
      if (d.compraId === null) continue;
      documentosPorCompra.set(d.compraId, [...(documentosPorCompra.get(d.compraId) ?? []), d]);
    }
    const problemas: string[] = [];
    const detalleCompras = compras.map((c) => this.detalleCompra(c, documentosPorCompra.get(c.id) ?? [], problemas));
    if (problemas.length > 0) {
      throw new AppError("VALIDACION", `No se puede generar el ATS: ${problemas.slice(0, 10).join("; ")}${problemas.length > 10 ? `; y ${problemas.length - 10} más` : ""}`);
    }

    // ── XML ──
    const raiz = create({ version: "1.0", encoding: "UTF-8", standalone: false }).ele("iva");
    raiz.ele("TipoIDInformante").txt("R");
    raiz.ele("IdInformante").txt(empresa.ruc);
    raiz.ele("razonSocial").txt(limpiarTexto(empresa.razonSocial, 500));
    raiz.ele("Anio").txt(String(anio));
    raiz.ele("Mes").txt(String(mes).padStart(2, "0"));
    raiz.ele("numEstabRuc").txt(String(Math.max(establecimientos.length, 1)).padStart(3, "0"));
    raiz.ele("totalVentas").txt(formatoDinero(round2(totalVentas)));
    raiz.ele("codigoOperativo").txt("IVA");

    if (detalleCompras.length > 0) {
      const nodo = raiz.ele("compras");
      for (const d of detalleCompras) d(nodo);
    }
    if (grupos.size > 0) {
      const nodo = raiz.ele("ventas");
      for (const g of [...grupos.values()].sort((a, b) => (a.tipo + a.id).localeCompare(b.tipo + b.id))) {
        const v = nodo.ele("detalleVentas");
        v.ele("tpIdCliente").txt(g.tp);
        v.ele("idCliente").txt(g.id);
        if (g.tp === "06") {
          v.ele("tipoCliente").txt("01");
          v.ele("DenoCli").txt("N/A");
        }
        v.ele("parteRelVtas").txt("NO");
        v.ele("tipoComprobante").txt(g.tipo);
        v.ele("tipoEm").txt("E");
        v.ele("numeroComprobantes").txt(String(g.n));
        v.ele("baseNoGraIva").txt(formatoDinero(round2(g.bases.noObjeto)));
        v.ele("baseImponible").txt(formatoDinero(round2(g.bases.cero)));
        v.ele("baseImpGrav").txt(formatoDinero(round2(g.bases.gravada)));
        v.ele("montoIva").txt(formatoDinero(round2(g.bases.iva)));
        v.ele("montoIce").txt(formatoDinero(0));
        v.ele("valorRetIva").txt(formatoDinero(0)); // las retenciones que nos practican los clientes no se registran en este sistema
        v.ele("valorRetRenta").txt(formatoDinero(0));
        if (g.tipo === TIPO_ATS_FACTURA && g.formas.size > 0) {
          const f = v.ele("formasDePago");
          for (const forma of [...g.formas].sort()) f.ele("formaPago").txt(forma);
        }
      }
    }
    const estabs = establecimientos.length > 0 ? establecimientos : [...porEstablecimiento.keys()];
    if (estabs.length > 0) {
      const nodo = raiz.ele("ventasEstablecimiento");
      for (const e of estabs) {
        const v = nodo.ele("ventaEst");
        v.ele("codEstab").txt(e);
        v.ele("ventasEstab").txt(formatoDinero(round2(porEstablecimiento.get(e) ?? 0)));
        v.ele("ivaComp").txt(formatoDinero(0));
      }
    }
    if (anulados.length > 0) {
      const nodo = raiz.ele("anulados");
      for (const a of anulados) {
        const [estab = "001", pto = "001"] = a.serie.split("-");
        const d = nodo.ele("detalleAnulados");
        d.ele("tipoComprobante").txt(a.tipoComprobante === "01" ? TIPO_ATS_FACTURA : a.tipoComprobante);
        d.ele("establecimiento").txt(estab);
        d.ele("puntoEmision").txt(pto);
        d.ele("secuencialInicio").txt(String(Number(a.secuencial)));
        d.ele("secuencialFin").txt(String(Number(a.secuencial)));
        d.ele("autorizacion").txt(a.numeroAutorizacion ?? "");
      }
    }

    return {
      xml: raiz.doc().end({ prettyPrint: true }),
      resumen: {
        anio,
        mes,
        totalVentas: round2(totalVentas),
        comprobantesVenta: ventas.length,
        compras: compras.length,
        retenciones: documentos.filter((d) => d.tipoComprobante === "07").length,
        ventasPendientesAutorizacion: pendientes,
      },
    };
  }

  /** Devuelve una función que escribe `detalleCompras` (así los problemas se detectan antes de armar el XML). */
  private detalleCompra(c: CompraAts, docs: DocumentoCompraAts[], problemas: string[]): (padre: ReturnType<ReturnType<typeof create>["ele"]>) => void {
    const etiqueta = `compra ${c.numeroFactura} de ${c.proveedor.razonSocial}`;
    const liquidacion = docs.find((d) => d.tipoComprobante === "03");
    const retencion = docs.find((d) => d.tipoComprobante === "07");

    let tipoComprobante: string;
    let establecimiento: string;
    let puntoEmision: string;
    let secuencial: string;
    let autorizacion: string;
    if (c.tipoDocumento === "LIQUIDACION") {
      tipoComprobante = "03";
      if (liquidacion === undefined) problemas.push(`${etiqueta}: falta emitir la liquidación de compra`);
      [establecimiento = "001", puntoEmision = "001"] = (liquidacion?.serie ?? "001-001").split("-");
      secuencial = liquidacion?.secuencial ?? "000000001";
      autorizacion = liquidacion?.claveAcceso ?? "";
    } else {
      tipoComprobante = c.tipoDocumento === "NOTA_VENTA" ? "02" : "01";
      const numero = numeroSustentoDe(c.numeroFactura);
      if (numero === null) problemas.push(`${etiqueta}: el número del documento debe tener el formato 001-001-000000123`);
      establecimiento = numero?.slice(0, 3) ?? "001";
      puntoEmision = numero?.slice(3, 6) ?? "001";
      secuencial = numero?.slice(6) ?? "000000001";
      autorizacion = c.autorizacion ?? "";
      if (!/^(\d{10}|\d{37}|\d{49})$/.test(autorizacion)) problemas.push(`${etiqueta}: falta el número de autorización del proveedor (10, 37 o 49 dígitos)`);
    }

    const noObjeto = 0; // las compras no registran el código SRI de IVA: lo no gravado entra en la base 0 %
    let cero = 0;
    let gravada = 0;
    for (const l of c.lineas) {
      if (l.porcentajeIva > 0) gravada += l.subtotal;
      else cero += l.subtotal;
    }
    const retenciones = retencion?.retenciones ?? [];
    const retIva: Record<string, number> = {};
    for (const r of retenciones.filter((x) => x.codigoImpuesto === "2")) {
      const elemento = ELEMENTO_RET_IVA[Math.round(r.porcentaje)];
      if (elemento === undefined) problemas.push(`${etiqueta}: el porcentaje de retención de IVA ${r.porcentaje} % no existe en el ATS (10, 20, 30, 50, 70 o 100)`);
      else retIva[elemento] = (retIva[elemento] ?? 0) + r.valor;
    }
    const air = retenciones.filter((x) => x.codigoImpuesto === "1");

    return (padre) => {
      const d = padre.ele("detalleCompras");
      d.ele("codSustento").txt(c.codSustento);
      d.ele("tpIdProv").txt(({ "04": "01", "05": "02", "06": "03" } as const)[tipoIdentificacionDe(c.proveedor.ruc)]);
      d.ele("idProv").txt(c.proveedor.ruc);
      d.ele("tipoComprobante").txt(tipoComprobante);
      d.ele("parteRel").txt("NO");
      d.ele("fechaRegistro").txt(fechaParaXml(c.fecha));
      d.ele("establecimiento").txt(establecimiento);
      d.ele("puntoEmision").txt(puntoEmision);
      d.ele("secuencial").txt(String(Number(secuencial)));
      d.ele("fechaEmision").txt(fechaParaXml(c.fecha));
      d.ele("autorizacion").txt(autorizacion);
      d.ele("baseNoGraIva").txt(formatoDinero(round2(noObjeto)));
      d.ele("baseImponible").txt(formatoDinero(round2(cero)));
      d.ele("baseImpGrav").txt(formatoDinero(round2(gravada)));
      d.ele("baseImpExe").txt(formatoDinero(0));
      d.ele("montoIce").txt(formatoDinero(0));
      d.ele("montoIva").txt(formatoDinero(round2(c.iva)));
      for (const e of ["valRetBien10", "valRetServ20", "valorRetBienes", "valRetServ50", "valorRetServicios", "valRetServ100"] as const) {
        d.ele(e).txt(formatoDinero(round2(retIva[e] ?? 0)));
      }
      d.ele("totbasesImpReemb").txt(formatoDinero(0));
      const pe = d.ele("pagoExterior");
      pe.ele("pagoLocExt").txt("01");
      pe.ele("paisEfecPago").txt("NA");
      pe.ele("aplicConvDobTrib").txt("NA");
      pe.ele("pagExtSujRetNorLeg").txt("NA");
      d.ele("formasDePago").ele("formaPago").txt("01");
      if (air.length > 0) {
        const a = d.ele("air");
        for (const r of air) {
          const da = a.ele("detalleAir");
          da.ele("codRetAir").txt(r.codigoRetencion);
          da.ele("baseImpAir").txt(formatoDinero(round2(r.baseImponible)));
          da.ele("porcentajeAir").txt(formatoDinero(r.porcentaje));
          da.ele("valRetAir").txt(formatoDinero(round2(r.valor)));
        }
      }
      if (retencion !== undefined) {
        const [estab = "001", pto = "001"] = retencion.serie.split("-");
        d.ele("estabRetencion1").txt(estab);
        d.ele("ptoEmiRetencion1").txt(pto);
        d.ele("secRetencion1").txt(String(Number(retencion.secuencial)));
        d.ele("autRetencion1").txt(retencion.claveAcceso);
        d.ele("fechaEmiRet1").txt(fechaParaXml(retencion.fechaEmision));
      }
    };
  }
}

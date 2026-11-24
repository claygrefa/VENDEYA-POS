// ============================================================
// src/server/services/sri/ride/ride.datos.ts — XML del comprobante → datos de su RIDE
//
// El RIDE (Representación Impresa del Documento Electrónico) se arma SIEMPRE desde el XML (autorizado, firmado o generado):
// así lo que se imprime es exactamente lo que se envió al SRI. Soporta factura (01), liquidación (03), nota de crédito (04),
// guía de remisión (06) y retención (07).
// ============================================================
import { DOMParser } from "@xmldom/xmldom";
import { AppError } from "../../appError.util";

export interface ColumnaRide {
  titulo: string;
  /** Proporción del ancho de la tabla */
  ancho: number;
  alineacion: "izquierda" | "derecha" | "centro";
}

export interface TablaRide {
  titulo?: string;
  columnas: ColumnaRide[];
  filas: string[][];
}

export interface DatosRide {
  titulo: string;
  /** false si el XML aún no tiene autorización del SRI: el RIDE se marca «sin valor tributario» */
  autorizado: boolean;
  numero: string;
  claveAcceso: string;
  numeroAutorizacion: string | null;
  fechaAutorizacion: string | null;
  ambiente: "PRUEBAS" | "PRODUCCION";
  emisor: {
    razonSocial: string;
    nombreComercial: string;
    ruc: string;
    dirMatriz: string;
    dirEstablecimiento: string;
    contribuyenteEspecial: string | null;
    obligadoContabilidad: string;
    agenteRetencion: string | null;
    rimpe: string | null;
  };
  /** Cliente, proveedor, sujeto retenido o transportista */
  receptor: { etiqueta: string; razonSocial: string; identificacion: string; direccion: string | null };
  fechaEmision: string;
  /** Datos propios del tipo (documento modificado, periodo fiscal, placa…) */
  extras: Array<[string, string]>;
  tablas: TablaRide[];
  totales: Array<[string, string]>;
  pagos: Array<[string, string]>;
  infoAdicional: Array<[string, string]>;
}

const TITULOS: Record<string, string> = {
  "01": "FACTURA",
  "03": "LIQUIDACIÓN DE COMPRA DE BIENES Y PRESTACIÓN DE SERVICIOS",
  "04": "NOTA DE CRÉDITO",
  "06": "GUÍA DE REMISIÓN",
  "07": "COMPROBANTE DE RETENCIÓN",
};

const FORMAS_PAGO: Record<string, string> = {
  "01": "SIN UTILIZACIÓN DEL SISTEMA FINANCIERO",
  "15": "COMPENSACIÓN DE DEUDAS",
  "16": "TARJETA DE DÉBITO",
  "17": "DINERO ELECTRÓNICO",
  "18": "TARJETA PREPAGO",
  "19": "TARJETA DE CRÉDITO",
  "20": "OTROS CON UTILIZACIÓN DEL SISTEMA FINANCIERO",
  "21": "ENDOSO DE TÍTULOS",
};

const TARIFAS: Record<string, string> = { "0": "IVA 0%", "2": "IVA 12%", "3": "IVA 14%", "4": "IVA 15%", "5": "IVA 5%", "6": "No objeto de IVA", "7": "Exento de IVA", "10": "IVA 13%" };
const IMPUESTOS_RETENCION: Record<string, string> = { "1": "RENTA", "2": "IVA", "6": "ISD" };

// ── Utilidades de XML ────────────────────────────────────────

type Nodo = Element | Document;

function parsear(xml: string): Document {
  const errores: string[] = [];
  const doc = new DOMParser({ errorHandler: { warning: () => undefined, error: (m) => errores.push(m), fatalError: (m) => errores.push(m) } }).parseFromString(xml, "text/xml") as unknown as Document;
  if (errores.length > 0 || doc.documentElement === null) throw new AppError("ESTADO_INVALIDO", "El XML del comprobante no está bien formado");
  return doc;
}

function hijo(n: Nodo, nombre: string): Element | null {
  const raiz = n.nodeType === 9 ? (n as Document).documentElement : (n as Element);
  for (let c = raiz.firstChild; c !== null; c = c.nextSibling) if (c.nodeType === 1 && (c as Element).nodeName === nombre) return c as Element;
  return null;
}

function hijos(n: Element | null, nombre: string): Element[] {
  const salida: Element[] = [];
  if (n === null) return salida;
  for (let c = n.firstChild; c !== null; c = c.nextSibling) if (c.nodeType === 1 && (c as Element).nodeName === nombre) salida.push(c as Element);
  return salida;
}

const t = (n: Element | null, nombre: string): string => {
  if (n === null) return "";
  const h = hijo(n, nombre);
  return h === null ? "" : (h.textContent ?? "").trim();
};

const dinero = (v: string): string => (v === "" || Number.isNaN(Number(v)) ? v : Number(v).toFixed(2));
const cantidad = (v: string): string => (v === "" || Number.isNaN(Number(v)) ? v : String(Number(v)));

// ── Extracción del comprobante ───────────────────────────────

/** Si el XML es la respuesta de autorización (`<autorizacion>` con el comprobante en CDATA), separa ambas partes. */
export function separarAutorizacion(xml: string): { comprobante: string; autorizacion: { numero: string; fecha: string; ambiente: string } | null } {
  if (!/^\s*(<\?xml[^>]*\?>\s*)?<autorizacion[\s>]/.test(xml)) return { comprobante: xml, autorizacion: null };
  const doc = parsear(xml);
  const a = doc.documentElement;
  const comprobante = t(a, "comprobante");
  if (comprobante === "") throw new AppError("ESTADO_INVALIDO", "La autorización no contiene el comprobante");
  return { comprobante, autorizacion: { numero: t(a, "numeroAutorizacion"), fecha: t(a, "fechaAutorizacion"), ambiente: t(a, "ambiente") } };
}

/** `2024-05-10T15:30:00.000Z` / `…-05:00` → `10/05/2024 10:30:00` en hora de Ecuador. */
export function fechaHoraAutorizacion(iso: string): string {
  const f = new Date(iso);
  if (Number.isNaN(f.getTime())) return iso;
  const l = new Date(f.getTime() - 5 * 3_600_000);
  const d = (n: number): string => String(n).padStart(2, "0");
  return `${d(l.getUTCDate())}/${d(l.getUTCMonth() + 1)}/${l.getUTCFullYear()} ${d(l.getUTCHours())}:${d(l.getUTCMinutes())}:${d(l.getUTCSeconds())}`;
}

function infoAdicional(raiz: Element): Array<[string, string]> {
  return hijos(hijo(raiz, "infoAdicional"), "campoAdicional").map((c) => [c.getAttribute("nombre") ?? "", (c.textContent ?? "").trim()] as [string, string]);
}

function pagos(info: Element): Array<[string, string]> {
  return hijos(hijo(info, "pagos"), "pago").map((p) => [FORMAS_PAGO[t(p, "formaPago")] ?? t(p, "formaPago"), dinero(t(p, "total"))] as [string, string]);
}

function totalesIva(info: Element): Array<[string, string]> {
  const filas: Array<[string, string]> = [];
  const impuestos = hijos(hijo(info, "totalConImpuestos"), "totalImpuesto");
  for (const i of impuestos) filas.push([`SUBTOTAL ${(TARIFAS[t(i, "codigoPorcentaje")] ?? t(i, "codigoPorcentaje")).replace("IVA ", "")}`, dinero(t(i, "baseImponible"))]);
  filas.push(["SUBTOTAL SIN IMPUESTOS", dinero(t(info, "totalSinImpuestos"))]);
  const descuento = t(info, "totalDescuento");
  if (descuento !== "") filas.push(["TOTAL DESCUENTO", dinero(descuento)]);
  for (const i of impuestos) {
    const codigo = t(i, "codigoPorcentaje");
    if (!["6", "7"].includes(codigo)) filas.push([TARIFAS[codigo] ?? `IVA (${codigo})`, dinero(t(i, "valor"))]);
  }
  return filas;
}

const COLUMNAS_DETALLE: ColumnaRide[] = [
  { titulo: "Cód.", ancho: 1.3, alineacion: "izquierda" },
  { titulo: "Descripción", ancho: 4, alineacion: "izquierda" },
  { titulo: "Cant.", ancho: 1, alineacion: "derecha" },
  { titulo: "P. Unitario", ancho: 1.3, alineacion: "derecha" },
  { titulo: "Descuento", ancho: 1.2, alineacion: "derecha" },
  { titulo: "Total", ancho: 1.3, alineacion: "derecha" },
];

function detalleItems(raiz: Element, claveCodigo: string): TablaRide {
  const filas = hijos(hijo(raiz, "detalles"), "detalle").map((d) => [t(d, claveCodigo), t(d, "descripcion"), cantidad(t(d, "cantidad")), dinero(t(d, "precioUnitario")), dinero(t(d, "descuento")), dinero(t(d, "precioTotalSinImpuesto"))]);
  return { columnas: COLUMNAS_DETALLE, filas };
}

/** Construye los datos del RIDE a partir del XML del comprobante (autorizado o no). */
export function datosRideDesdeXml(xmlEntrada: string): DatosRide {
  const { comprobante, autorizacion } = separarAutorizacion(xmlEntrada);
  const doc = parsear(comprobante);
  const raiz = doc.documentElement;
  const tributaria = hijo(raiz, "infoTributaria");
  if (tributaria === null) throw new AppError("ESTADO_INVALIDO", "El XML no es un comprobante electrónico del SRI");
  const codDoc = t(tributaria, "codDoc");
  const titulo = TITULOS[codDoc];
  if (titulo === undefined) throw new AppError("ESTADO_INVALIDO", `No hay RIDE para el tipo de comprobante ${codDoc}`);

  const claveAcceso = t(tributaria, "claveAcceso");
  const base: Omit<DatosRide, "receptor" | "fechaEmision" | "extras" | "tablas" | "totales" | "pagos" | "infoAdicional" | "emisor"> = {
    titulo,
    autorizado: autorizacion !== null,
    numero: `${t(tributaria, "estab")}-${t(tributaria, "ptoEmi")}-${t(tributaria, "secuencial")}`,
    claveAcceso,
    // en el esquema offline el número de autorización coincide con la clave de acceso
    numeroAutorizacion: autorizacion === null ? null : autorizacion.numero !== "" ? autorizacion.numero : claveAcceso,
    fechaAutorizacion: autorizacion === null || autorizacion.fecha === "" ? null : fechaHoraAutorizacion(autorizacion.fecha),
    ambiente: t(tributaria, "ambiente") === "2" ? "PRODUCCION" : "PRUEBAS",
  };
  const emisor = (info: Element): DatosRide["emisor"] => ({
    razonSocial: t(tributaria, "razonSocial"),
    nombreComercial: t(tributaria, "nombreComercial"),
    ruc: t(tributaria, "ruc"),
    dirMatriz: t(tributaria, "dirMatriz"),
    dirEstablecimiento: t(info, "dirEstablecimiento"),
    contribuyenteEspecial: t(info, "contribuyenteEspecial") || null,
    obligadoContabilidad: t(info, "obligadoContabilidad") || "NO",
    agenteRetencion: t(tributaria, "agenteRetencion") || null,
    rimpe: t(tributaria, "contribuyenteRimpe") || null,
  });

  switch (codDoc) {
    case "01":
    case "03": {
      const info = hijo(raiz, codDoc === "01" ? "infoFactura" : "infoLiquidacionCompra");
      if (info === null) throw new AppError("ESTADO_INVALIDO", "El XML no tiene la información del comprobante");
      const esFactura = codDoc === "01";
      const totales = totalesIva(info);
      const propina = t(info, "propina");
      if (propina !== "") totales.push(["PROPINA", dinero(propina)]);
      totales.push(["VALOR TOTAL", dinero(t(info, "importeTotal"))]);
      return {
        ...base,
        emisor: emisor(info),
        receptor: {
          etiqueta: esFactura ? "Cliente" : "Proveedor",
          razonSocial: t(info, esFactura ? "razonSocialComprador" : "razonSocialProveedor"),
          identificacion: t(info, esFactura ? "identificacionComprador" : "identificacionProveedor"),
          direccion: t(info, esFactura ? "direccionComprador" : "direccionProveedor") || null,
        },
        fechaEmision: t(info, "fechaEmision"),
        extras: [],
        tablas: [detalleItems(raiz, "codigoPrincipal")],
        totales,
        pagos: pagos(info),
        infoAdicional: infoAdicional(raiz),
      };
    }
    case "04": {
      const info = hijo(raiz, "infoNotaCredito");
      if (info === null) throw new AppError("ESTADO_INVALIDO", "El XML no tiene la información del comprobante");
      const totales = totalesIva(info);
      totales.push(["VALOR TOTAL", dinero(t(info, "valorModificacion"))]);
      return {
        ...base,
        emisor: emisor(info),
        receptor: { etiqueta: "Cliente", razonSocial: t(info, "razonSocialComprador"), identificacion: t(info, "identificacionComprador"), direccion: null },
        fechaEmision: t(info, "fechaEmision"),
        extras: [
          ["Comprobante que se modifica", `FACTURA ${t(info, "numDocModificado")}`],
          ["Fecha emisión (comprobante a modificar)", t(info, "fechaEmisionDocSustento")],
          ["Razón de modificación", t(info, "motivo")],
        ],
        tablas: [detalleItems(raiz, "codigoInterno")],
        totales,
        pagos: [],
        infoAdicional: infoAdicional(raiz),
      };
    }
    case "07": {
      const info = hijo(raiz, "infoCompRetencion");
      if (info === null) throw new AppError("ESTADO_INVALIDO", "El XML no tiene la información del comprobante");
      const sustentos = hijos(hijo(raiz, "docsSustento"), "docSustento");
      const filas: string[][] = [];
      let total = 0;
      for (const s of sustentos) {
        const doc = t(s, "numDocSustento");
        const numero = doc.length === 15 ? `${doc.slice(0, 3)}-${doc.slice(3, 6)}-${doc.slice(6)}` : doc;
        for (const r of hijos(hijo(s, "retenciones"), "retencion")) {
          total += Number(t(r, "valorRetenido")) || 0;
          filas.push([
            `${t(s, "codDocSustento") === "01" ? "FACTURA" : `DOC. ${t(s, "codDocSustento")}`} ${numero}`,
            t(s, "fechaEmisionDocSustento"),
            IMPUESTOS_RETENCION[t(r, "codigo")] ?? t(r, "codigo"),
            t(r, "codigoRetencion"),
            dinero(t(r, "baseImponible")),
            dinero(t(r, "porcentajeRetener")),
            dinero(t(r, "valorRetenido")),
          ]);
        }
      }
      return {
        ...base,
        emisor: emisor(info),
        receptor: { etiqueta: "Sujeto retenido", razonSocial: t(info, "razonSocialSujetoRetenido"), identificacion: t(info, "identificacionSujetoRetenido"), direccion: null },
        fechaEmision: t(info, "fechaEmision"),
        extras: [["Ejercicio fiscal", t(info, "periodoFiscal")]],
        tablas: [
          {
            columnas: [
              { titulo: "Comprobante", ancho: 2.6, alineacion: "izquierda" },
              { titulo: "Fecha", ancho: 1.3, alineacion: "centro" },
              { titulo: "Impuesto", ancho: 1.1, alineacion: "izquierda" },
              { titulo: "Cód.", ancho: 0.8, alineacion: "izquierda" },
              { titulo: "Base", ancho: 1.2, alineacion: "derecha" },
              { titulo: "% Ret.", ancho: 0.9, alineacion: "derecha" },
              { titulo: "Valor ret.", ancho: 1.2, alineacion: "derecha" },
            ],
            filas,
          },
        ],
        totales: [["TOTAL RETENIDO", total.toFixed(2)]],
        pagos: [],
        infoAdicional: infoAdicional(raiz),
      };
    }
    default: {
      // 06 guía de remisión
      const info = hijo(raiz, "infoGuiaRemision");
      if (info === null) throw new AppError("ESTADO_INVALIDO", "El XML no tiene la información del comprobante");
      const tablas: TablaRide[] = [];
      for (const d of hijos(hijo(raiz, "destinatarios"), "destinatario")) {
        tablas.push({
          titulo: `Destinatario: ${t(d, "razonSocialDestinatario")} (${t(d, "identificacionDestinatario")}) · ${t(d, "dirDestinatario")} · Motivo: ${t(d, "motivoTraslado")}`,
          columnas: [
            { titulo: "Cód.", ancho: 1.5, alineacion: "izquierda" },
            { titulo: "Descripción", ancho: 5, alineacion: "izquierda" },
            { titulo: "Cantidad", ancho: 1.3, alineacion: "derecha" },
          ],
          filas: hijos(hijo(d, "detalles"), "detalle").map((x) => [t(x, "codigoInterno"), t(x, "descripcion"), cantidad(t(x, "cantidad"))]),
        });
      }
      return {
        ...base,
        emisor: emisor(info),
        receptor: { etiqueta: "Transportista", razonSocial: t(info, "razonSocialTransportista"), identificacion: t(info, "rucTransportista"), direccion: null },
        fechaEmision: t(info, "fechaIniTransporte"),
        extras: [
          ["Punto de partida", t(info, "dirPartida")],
          ["Fecha inicio transporte", t(info, "fechaIniTransporte")],
          ["Fecha fin transporte", t(info, "fechaFinTransporte")],
          ["Placa", t(info, "placa")],
        ],
        tablas,
        totales: [],
        pagos: [],
        infoAdicional: infoAdicional(raiz),
      };
    }
  }
}

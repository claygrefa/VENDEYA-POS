// ============================================================
// src/server/services/sri/xsdValidator.service.ts
// Validación de comprobantes contra los esquemas XSD OFICIALES del SRI (carpeta ./xsd).
// Usa xmllint compilado a WebAssembly: no requiere compilar nada nativo.
// ============================================================
import { existsSync, readFileSync } from "fs";
import path from "path";
import { validateXML } from "xmllint-wasm";

export type TipoXsd = "factura" | "notaCredito" | "retencion" | "liquidacionCompra" | "guiaRemision";

export interface ErrorXsd {
  /** Mensaje del validador sin el prefijo de archivo/línea */
  mensaje: string;
  /** Elemento del XML al que se refiere el error, si se pudo identificar */
  elemento: string | null;
}

export interface ResultadoXsd {
  valido: boolean;
  errores: ErrorXsd[];
}

const ARCHIVO_XSD: Record<TipoXsd, string> = {
  factura: "factura_V2.1.0.xsd",
  notaCredito: "NotaCredito_V1.1.0.xsd",
  retencion: "ComprobanteRetencion_V2.0.0.xsd",
  liquidacionCompra: "LiquidacionCompra_V1.1.0.xsd",
  guiaRemision: "GuiaRemision_V1.1.0.xsd",
};
const ARCHIVO_DSIG = "xmldsig-core-schema.xsd";

/** Carpeta con los XSD: variable de entorno, junto a este archivo (dev/build) o en el árbol de fuentes. */
export function resolverCarpetaXsd(): string {
  const candidatas = [
    process.env["VENDEYA_XSD_DIR"],
    path.join(__dirname, "xsd"),
    path.resolve(process.cwd(), "src", "server", "services", "sri", "xsd"),
  ];
  for (const c of candidatas) {
    if (c !== undefined && c !== "" && existsSync(path.join(c, ARCHIVO_DSIG))) return c;
  }
  throw new Error(`No se encontraron los esquemas XSD del SRI (se buscó en: ${candidatas.filter(Boolean).join(", ")})`);
}

export class XsdValidatorService {
  private readonly cache = new Map<string, string>();
  private carpeta: string | undefined;

  /** La carpeta se resuelve al primer uso: si faltaran los XSD fallaría la emisión, no el arranque del backend. */
  constructor(carpeta?: string) {
    this.carpeta = carpeta;
  }

  private leer(archivo: string): string {
    let contenido = this.cache.get(archivo);
    if (contenido === undefined) {
      this.carpeta ??= resolverCarpetaXsd();
      contenido = readFileSync(path.join(this.carpeta, archivo), "utf8");
      this.cache.set(archivo, contenido);
    }
    return contenido;
  }

  /** Valida el XML (sin firmar o firmado) contra el XSD del tipo de comprobante. */
  async validar(tipo: TipoXsd, xml: string): Promise<ResultadoXsd> {
    const archivo = ARCHIVO_XSD[tipo];
    const resultado = await validateXML({
      xml: [{ fileName: "comprobante.xml", contents: xml }],
      schema: [{ fileName: archivo, contents: this.leer(archivo) }],
      preload: [{ fileName: ARCHIVO_DSIG, contents: this.leer(ARCHIVO_DSIG) }],
    });
    if (resultado.valid) return { valido: true, errores: [] };

    // libxml2 también emite ruido que no son errores del comprobante: advertencias del propio XSD (el de la nota de
    // crédito declara XML 1.1) y las líneas de contexto que las acompañan (el fragmento y el indicador "^").
    // Se descarta ese ruido; si por algún motivo no quedara nada, se devuelven todos para no ocultar la causa.
    const esRuido = (m: string): boolean => /warning/i.test(m) || /^\s*\^\s*$/.test(m) || m.trim().startsWith("<?xml");
    const reales = resultado.errors.filter((e) => !esRuido(e.rawMessage ?? e.message));
    const errores = (reales.length > 0 ? reales : resultado.errors).map<ErrorXsd>((e) => {
      const crudo = e.rawMessage ?? e.message;
      const mensaje = crudo.replace(/^comprobante\.xml:\d+:\s*/, "").replace(/^Schemas validity error\s*:\s*/, "");
      return { mensaje, elemento: /Element '([^']+)'/.exec(mensaje)?.[1] ?? null };
    });
    return { valido: false, errores };
  }
}

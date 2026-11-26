// ============================================================
// src/server/services/sri/ws/sriSoap.client.ts — Cliente SOAP de los Web Services del SRI
//
//   · RecepcionComprobantesOffline      → validarComprobante { xml (base64 del XML firmado) }
//   · AutorizacionComprobantesOffline   → autorizacionComprobante { claveAccesoComprobante }
//
// Se arma el sobre SOAP 1.1 a mano (en vez de leer el WSDL en cada arranque): no depende de descargar el WSDL con Internet
// inestable, y toda condición anómala se convierte en SriTransporteError (reintentable).
// ============================================================
import http from "http";
import https from "https";
import { DOMParser } from "@xmldom/xmldom";
import { SRI_WS } from "../../../../shared/constants/sri.constants";
import type { AmbienteSri } from "../claveAcceso.util";
import {
  SriTransporteError,
  type AutorizacionSri,
  type ClienteSri,
  type MensajeSri,
  type RespuestaAutorizacion,
  type RespuestaRecepcion,
} from "./sriSoap.types";

const NS_SOAP = "http://schemas.xmlsoap.org/soap/envelope/";
const NS_RECEPCION = "http://ec.gob.sri.ws.recepcion";
const NS_AUTORIZACION = "http://ec.gob.sri.ws.autorizacion";
const MAX_RESPUESTA_BYTES = 8 * 1024 * 1024;

export interface EndpointsSri {
  recepcion: string;
  autorizacion: string;
}

export interface OpcionesClienteSri {
  /** Tiempo máximo de cada llamada (default 30 s) */
  timeoutMs?: number;
  /** Sustituye las URL oficiales (pruebas con un servidor local) */
  endpoints?: Partial<Record<AmbienteSri, EndpointsSri>>;
}

const sinWsdl = (url: string): string => url.replace(/\?wsdl$/i, "");

function endpointsOficiales(ambiente: AmbienteSri): EndpointsSri {
  const ws = ambiente === "2" ? SRI_WS.PRODUCCION : SRI_WS.PRUEBAS;
  return { recepcion: sinWsdl(ws.RECEPCION), autorizacion: sinWsdl(ws.AUTORIZACION) };
}

/** El ambiente de pruebas acepta las URL de celcer, con o sin el sufijo del WSDL. */
export function endpointsSriPruebas(env: NodeJS.ProcessEnv = process.env): EndpointsSri {
  const oficiales = endpointsOficiales("1");
  const resolver = (variable: string, oficial: string): string => {
    const configurado = env[variable]?.trim();
    if (!configurado) return oficial;
    const url = new URL(sinWsdl(configurado));
    if (url.href !== oficial || url.username || url.password) {
      throw new Error(`${variable} debe apuntar al servicio oficial de pruebas (${oficial})`);
    }
    return url.href;
  };
  return {
    recepcion: resolver("SRI_TEST_RECEPCION_URL", oficiales.recepcion),
    autorizacion: resolver("SRI_TEST_AUTORIZACION_URL", oficiales.autorizacion),
  };
}

// ── XML ──────────────────────────────────────────────────────

const escapar = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function sobre(namespace: string, operacion: string, cuerpo: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="${NS_SOAP}" xmlns:ec="${namespace}">` +
    `<soapenv:Header/><soapenv:Body><ec:${operacion}>${cuerpo}</ec:${operacion}></soapenv:Body></soapenv:Envelope>`
  );
}

function analizar(xml: string): Document {
  const errores: string[] = [];
  const doc = new DOMParser({
    errorHandler: { warning: () => undefined, error: (m) => errores.push(m), fatalError: (m) => errores.push(m) },
  }).parseFromString(xml, "text/xml") as unknown as Document;
  if (errores.length > 0 || doc.documentElement === null) throw new SriTransporteError("La respuesta del SRI no es un XML válido");
  return doc;
}

function descendientes(raiz: Element | Document, nombre: string): Element[] {
  const lista = raiz.getElementsByTagNameNS("*", nombre);
  return Array.from({ length: lista.length }, (_, i) => lista.item(i) as Element);
}

const hijoTexto = (el: Element, nombre: string): string | null => {
  for (let n = el.firstChild; n !== null; n = n.nextSibling) {
    if (n.nodeType === 1 && (n as Element).localName === nombre) return (n.textContent ?? "").trim();
  }
  return null;
};

function hijoElemento(el: Element, nombre: string): Element | null {
  for (let n = el.firstChild; n !== null; n = n.nextSibling) {
    if (n.nodeType === 1 && (n as Element).localName === nombre) return n as Element;
  }
  return null;
}

/** Los `<mensaje>` de un elemento `<mensajes>` (los mensajes del SRI se anidan: mensaje/mensaje). */
function leerMensajes(contenedor: Element): MensajeSri[] {
  const bloque = hijoElemento(contenedor, "mensajes");
  if (bloque === null) return [];
  const salida: MensajeSri[] = [];
  for (let n = bloque.firstChild; n !== null; n = n.nextSibling) {
    if (n.nodeType !== 1 || (n as Element).localName !== "mensaje") continue;
    const m = n as Element;
    salida.push({
      identificador: hijoTexto(m, "identificador") ?? "",
      mensaje: hijoTexto(m, "mensaje") ?? "",
      informacionAdicional: hijoTexto(m, "informacionAdicional"),
      tipo: hijoTexto(m, "tipo") ?? "ERROR",
    });
  }
  return salida;
}

/** Interpreta la respuesta de `validarComprobante`. */
export function leerRespuestaRecepcion(xml: string): RespuestaRecepcion {
  const doc = analizar(xml);
  if (descendientes(doc, "Fault").length > 0) throw new SriTransporteError(`El SRI respondió con un SOAP Fault: ${faultTexto(doc)}`);
  const respuesta = descendientes(doc, "RespuestaRecepcionComprobante")[0];
  const estado = respuesta === undefined ? null : hijoTexto(respuesta, "estado");
  if (respuesta === undefined || (estado !== "RECIBIDA" && estado !== "DEVUELTA")) {
    throw new SriTransporteError("Respuesta de recepción inesperada del SRI");
  }
  const mensajes: MensajeSri[] = [];
  for (const c of descendientes(respuesta, "comprobante")) mensajes.push(...leerMensajes(c));
  return { estado, mensajes };
}

/** Interpreta la respuesta de `autorizacionComprobante`. */
export function leerRespuestaAutorizacion(xml: string): RespuestaAutorizacion {
  const doc = analizar(xml);
  if (descendientes(doc, "Fault").length > 0) throw new SriTransporteError(`El SRI respondió con un SOAP Fault: ${faultTexto(doc)}`);
  const respuesta = descendientes(doc, "RespuestaAutorizacionComprobante")[0];
  if (respuesta === undefined) throw new SriTransporteError("Respuesta de autorización inesperada del SRI");
  const autorizaciones: AutorizacionSri[] = descendientes(respuesta, "autorizacion").map((a) => {
    const fecha = hijoTexto(a, "fechaAutorizacion");
    const fechaParseada = fecha === null || fecha === "" ? null : new Date(fecha);
    return {
      estado: (hijoTexto(a, "estado") ?? "").toUpperCase(),
      numeroAutorizacion: hijoTexto(a, "numeroAutorizacion") || null,
      fechaAutorizacion: fechaParseada !== null && !Number.isNaN(fechaParseada.getTime()) ? fechaParseada : null,
      ambiente: hijoTexto(a, "ambiente") || null,
      comprobante: hijoTexto(a, "comprobante") || null,
      mensajes: leerMensajes(a),
    };
  });
  return { claveAcceso: hijoTexto(respuesta, "claveAccesoConsultada") ?? "", autorizaciones };
}

function faultTexto(doc: Document): string {
  const f = descendientes(doc, "faultstring")[0];
  return (f?.textContent ?? "sin detalle").trim().slice(0, 200);
}

// ── HTTP ─────────────────────────────────────────────────────

function post(url: string, cuerpo: string, timeoutMs: number): Promise<{ status: number; cuerpo: string }> {
  return new Promise((resolve, reject) => {
    let destino: URL;
    try {
      destino = new URL(url);
    } catch (e) {
      reject(new SriTransporteError(`URL del servicio del SRI inválida: ${url}`, e));
      return;
    }
    const cliente = destino.protocol === "https:" ? https : http;
    const datos = Buffer.from(cuerpo, "utf8");
    const req = cliente.request(
      destino,
      {
        method: "POST",
        headers: { "Content-Type": "text/xml; charset=utf-8", "Content-Length": datos.length, SOAPAction: '""' },
        timeout: timeoutMs,
      },
      (res) => {
        const trozos: Buffer[] = [];
        let total = 0;
        res.on("data", (t: Buffer) => {
          total += t.length;
          if (total > MAX_RESPUESTA_BYTES) {
            req.destroy(new Error("La respuesta del SRI es demasiado grande"));
            return;
          }
          trozos.push(t);
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, cuerpo: Buffer.concat(trozos).toString("utf8") }));
        res.on("error", (e) => reject(new SriTransporteError(`Se interrumpió la respuesta del SRI: ${e.message}`, e)));
      }
    );
    req.on("timeout", () => req.destroy(new Error(`tiempo de espera agotado (${timeoutMs} ms)`)));
    req.on("error", (e) => reject(new SriTransporteError(`No se pudo comunicar con el SRI: ${e.message}`, e)));
    req.end(datos);
  });
}

export class SriSoapClient implements ClienteSri {
  private readonly timeoutMs: number;
  private readonly endpoints: Partial<Record<AmbienteSri, EndpointsSri>>;

  constructor(opciones: OpcionesClienteSri = {}) {
    this.timeoutMs = opciones.timeoutMs ?? 30_000;
    this.endpoints = opciones.endpoints ?? {};
  }

  private urls(ambiente: AmbienteSri): EndpointsSri {
    return this.endpoints[ambiente] ?? (ambiente === "1" ? endpointsSriPruebas() : endpointsOficiales(ambiente));
  }

  async enviarComprobante(ambiente: AmbienteSri, xmlFirmado: string): Promise<RespuestaRecepcion> {
    const base64 = Buffer.from(xmlFirmado, "utf8").toString("base64");
    const r = await post(this.urls(ambiente).recepcion, sobre(NS_RECEPCION, "validarComprobante", `<xml>${base64}</xml>`), this.timeoutMs);
    return this.interpretar(r, leerRespuestaRecepcion);
  }

  async consultarAutorizacion(ambiente: AmbienteSri, claveAcceso: string): Promise<RespuestaAutorizacion> {
    const cuerpo = `<claveAccesoComprobante>${escapar(claveAcceso)}</claveAccesoComprobante>`;
    const r = await post(this.urls(ambiente).autorizacion, sobre(NS_AUTORIZACION, "autorizacionComprobante", cuerpo), this.timeoutMs);
    return this.interpretar(r, leerRespuestaAutorizacion);
  }

  /** Un SOAP Fault llega con HTTP 500: se intenta leer igual para dar un mensaje útil, y siempre es reintentable. */
  private interpretar<T>(r: { status: number; cuerpo: string }, leer: (xml: string) => T): T {
    if (r.status < 200 || r.status >= 300) {
      try {
        leer(r.cuerpo);
      } catch (e) {
        if (e instanceof SriTransporteError && r.cuerpo.includes("Fault")) throw e;
      }
      throw new SriTransporteError(`El SRI respondió HTTP ${r.status}`);
    }
    return leer(r.cuerpo);
  }
}

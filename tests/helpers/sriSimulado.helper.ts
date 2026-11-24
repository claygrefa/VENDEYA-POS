// ============================================================
// tests/helpers/sriSimulado.helper.ts
// Servidor SOAP local que imita los Web Services del SRI (recepción y autorización). Las pruebas NUNCA llaman al SRI real.
// ============================================================
import http from "http";
import type { AddressInfo } from "net";
import type { EndpointsSri } from "../../src/server/services/sri/ws/sriSoap.client";

export type Comportamiento =
  | { tipo: "xml"; cuerpo: string; status?: number }
  | { tipo: "colgar" } // no responde nunca (tiempo agotado)
  | { tipo: "cortar" }; // cierra la conexión sin responder

export interface MensajeSimulado {
  identificador: string;
  mensaje: string;
  informacionAdicional?: string;
  tipo?: string;
}

export interface AutorizacionSimulada {
  estado: string;
  numeroAutorizacion?: string;
  fechaAutorizacion?: string;
  ambiente?: string;
  comprobante?: string;
  mensajes?: MensajeSimulado[];
}

const NS_SOAP = "http://schemas.xmlsoap.org/soap/envelope/";
const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const sobre = (cuerpo: string): string => `<?xml version="1.0" encoding="UTF-8"?><soap:Envelope xmlns:soap="${NS_SOAP}"><soap:Body>${cuerpo}</soap:Body></soap:Envelope>`;

const mensajes = (ms: MensajeSimulado[]): string =>
  `<mensajes>${ms
    .map((m) => `<mensaje><identificador>${m.identificador}</identificador><mensaje>${esc(m.mensaje)}</mensaje>${m.informacionAdicional !== undefined ? `<informacionAdicional>${esc(m.informacionAdicional)}</informacionAdicional>` : ""}<tipo>${m.tipo ?? "ERROR"}</tipo></mensaje>`)
    .join("")}</mensajes>`;

export function respuestaRecepcion(estado: "RECIBIDA" | "DEVUELTA", ms: MensajeSimulado[] = []): Comportamiento {
  const comprobantes = ms.length > 0 ? `<comprobantes><comprobante><claveAcceso>X</claveAcceso>${mensajes(ms)}</comprobante></comprobantes>` : "";
  return {
    tipo: "xml",
    cuerpo: sobre(`<ns2:validarComprobanteResponse xmlns:ns2="http://ec.gob.sri.ws.recepcion"><RespuestaRecepcionComprobante><estado>${estado}</estado>${comprobantes}</RespuestaRecepcionComprobante></ns2:validarComprobanteResponse>`),
  };
}

export function respuestaAutorizacion(clave: string, autorizaciones: AutorizacionSimulada[]): Comportamiento {
  const items = autorizaciones
    .map(
      (a) =>
        `<autorizacion><estado>${a.estado}</estado>${a.numeroAutorizacion !== undefined ? `<numeroAutorizacion>${a.numeroAutorizacion}</numeroAutorizacion>` : ""}` +
        `${a.fechaAutorizacion !== undefined ? `<fechaAutorizacion>${a.fechaAutorizacion}</fechaAutorizacion>` : ""}<ambiente>${a.ambiente ?? "PRUEBAS"}</ambiente>` +
        `${a.comprobante !== undefined ? `<comprobante>${esc(a.comprobante)}</comprobante>` : ""}${mensajes(a.mensajes ?? [])}</autorizacion>`
    )
    .join("");
  return {
    tipo: "xml",
    cuerpo: sobre(
      `<ns2:autorizacionComprobanteResponse xmlns:ns2="http://ec.gob.sri.ws.autorizacion"><RespuestaAutorizacionComprobante><claveAccesoConsultada>${clave}</claveAccesoConsultada>` +
        `<numeroComprobantes>${autorizaciones.length}</numeroComprobantes><autorizaciones>${items}</autorizaciones></RespuestaAutorizacionComprobante></ns2:autorizacionComprobanteResponse>`
    ),
  };
}

export const soapFault = (texto = "Internal error"): Comportamiento => ({
  tipo: "xml",
  status: 500,
  cuerpo: sobre(`<soap:Fault><faultcode>soap:Server</faultcode><faultstring>${esc(texto)}</faultstring></soap:Fault>`),
});

export interface SriSimulado {
  endpoints: EndpointsSri;
  /** XML firmado de cada llamada a recepción (ya decodificado de base64) */
  recepciones: string[];
  /** Claves consultadas en autorización */
  consultas: string[];
  /** Respuestas en cola, en orden; cuando se agotan se usa la de `porDefecto` */
  colaRecepcion: Comportamiento[];
  colaAutorizacion: Comportamiento[];
  porDefectoRecepcion: Comportamiento | ((xml: string) => Comportamiento);
  porDefectoAutorizacion: Comportamiento | ((clave: string) => Comportamiento);
  reiniciar: () => void;
  cerrar: () => Promise<void>;
}

/** Arranca el SRI simulado en un puerto libre. Por defecto: todo se recibe y se autoriza. */
export async function iniciarSriSimulado(): Promise<SriSimulado> {
  const sockets = new Set<import("net").Socket>();
  const sri: SriSimulado = {
    endpoints: { recepcion: "", autorizacion: "" },
    recepciones: [],
    consultas: [],
    colaRecepcion: [],
    colaAutorizacion: [],
    porDefectoRecepcion: respuestaRecepcion("RECIBIDA"),
    porDefectoAutorizacion: (clave) => respuestaAutorizacion(clave, [{ estado: "AUTORIZADO", numeroAutorizacion: clave, fechaAutorizacion: "2024-05-10T15:30:00-05:00" }]),
    reiniciar: () => {
      sri.recepciones.length = 0;
      sri.consultas.length = 0;
      sri.colaRecepcion.length = 0;
      sri.colaAutorizacion.length = 0;
      sri.porDefectoRecepcion = respuestaRecepcion("RECIBIDA");
      sri.porDefectoAutorizacion = (clave) => respuestaAutorizacion(clave, [{ estado: "AUTORIZADO", numeroAutorizacion: clave, fechaAutorizacion: "2024-05-10T15:30:00-05:00" }]);
    },
    cerrar: () =>
      new Promise((resolve) => {
        for (const s of sockets) s.destroy();
        servidor.close(() => resolve());
      }),
  };

  const servidor = http.createServer((req, res) => {
    const trozos: Buffer[] = [];
    req.on("data", (t: Buffer) => trozos.push(t));
    req.on("end", () => {
      const cuerpo = Buffer.concat(trozos).toString("utf8");
      let comportamiento: Comportamiento;
      if (req.url === "/recepcion") {
        const base64 = /<xml>([^<]*)<\/xml>/.exec(cuerpo)?.[1] ?? "";
        const xml = Buffer.from(base64, "base64").toString("utf8");
        sri.recepciones.push(xml);
        const d = sri.porDefectoRecepcion;
        comportamiento = sri.colaRecepcion.shift() ?? (typeof d === "function" ? d(xml) : d);
      } else {
        const clave = /<claveAccesoComprobante>([^<]*)<\/claveAccesoComprobante>/.exec(cuerpo)?.[1] ?? "";
        sri.consultas.push(clave);
        const d = sri.porDefectoAutorizacion;
        comportamiento = sri.colaAutorizacion.shift() ?? (typeof d === "function" ? d(clave) : d);
      }
      if (comportamiento.tipo === "colgar") return;
      if (comportamiento.tipo === "cortar") {
        req.socket.destroy();
        return;
      }
      res.writeHead(comportamiento.status ?? 200, { "Content-Type": "text/xml; charset=utf-8" });
      res.end(comportamiento.cuerpo);
    });
  });
  servidor.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  await new Promise<void>((resolve) => servidor.listen(0, "127.0.0.1", resolve));
  const { port } = servidor.address() as AddressInfo;
  sri.endpoints = { recepcion: `http://127.0.0.1:${port}/recepcion`, autorizacion: `http://127.0.0.1:${port}/autorizacion` };
  return sri;
}

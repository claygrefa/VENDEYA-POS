// ============================================================
// tests/unit/server/sri/ws/sriSoap.client.test.ts — Cliente SOAP contra un SRI simulado local
// ============================================================
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SriSoapClient, leerRespuestaAutorizacion, leerRespuestaRecepcion } from "../../../../../src/server/services/sri/ws/sriSoap.client";
import { SriTransporteError } from "../../../../../src/server/services/sri/ws/sriSoap.types";
import { esperaReintentoMs, construirXmlAutorizado, ESPERA_MAXIMA_MS } from "../../../../../src/server/services/sri/envioSri.service";
import { iniciarSriSimulado, respuestaAutorizacion, respuestaRecepcion, soapFault, type SriSimulado } from "../../../../helpers/sriSimulado.helper";

const CLAVE = "1005202401179001234500110010010000000011234567813";
let sri: SriSimulado;
let cliente: SriSoapClient;

beforeAll(async () => {
  sri = await iniciarSriSimulado();
  cliente = new SriSoapClient({ timeoutMs: 400, endpoints: { "1": sri.endpoints, "2": sri.endpoints } });
});
afterAll(async () => {
  await sri.cerrar();
});
beforeEach(() => sri.reiniciar());

describe("Recepción (validarComprobante)", () => {
  it("envía el XML firmado en base64 y entiende RECIBIDA", async () => {
    const r = await cliente.enviarComprobante("1", '<factura id="comprobante">ñ&amp;</factura>');
    expect(r).toEqual({ estado: "RECIBIDA", mensajes: [] });
    expect(sri.recepciones).toEqual(['<factura id="comprobante">ñ&amp;</factura>']); // llegó íntegro, con acentos
  });

  it("DEVUELTA con sus mensajes (identificador, texto, información adicional y tipo)", async () => {
    sri.colaRecepcion.push(respuestaRecepcion("DEVUELTA", [{ identificador: "35", mensaje: "ARCHIVO NO CUMPLE ESTRUCTURA XML", informacionAdicional: "cvc-complex-type: <x>", tipo: "ERROR" }]));
    const r = await cliente.enviarComprobante("1", "<a/>");
    expect(r.estado).toBe("DEVUELTA");
    expect(r.mensajes).toEqual([{ identificador: "35", mensaje: "ARCHIVO NO CUMPLE ESTRUCTURA XML", informacionAdicional: "cvc-complex-type: <x>", tipo: "ERROR" }]);
  });
});

describe("Autorización (autorizacionComprobante)", () => {
  it("AUTORIZADO con número, fecha, ambiente y el comprobante", async () => {
    sri.colaAutorizacion.push(respuestaAutorizacion(CLAVE, [{ estado: "AUTORIZADO", numeroAutorizacion: CLAVE, fechaAutorizacion: "2024-05-10T15:30:00-05:00", ambiente: "PRUEBAS", comprobante: "<factura>ñ</factura>" }]));
    const r = await cliente.consultarAutorizacion("1", CLAVE);
    expect(sri.consultas).toEqual([CLAVE]);
    expect(r.claveAcceso).toBe(CLAVE);
    expect(r.autorizaciones).toHaveLength(1);
    expect(r.autorizaciones[0]).toMatchObject({ estado: "AUTORIZADO", numeroAutorizacion: CLAVE, ambiente: "PRUEBAS", comprobante: "<factura>ñ</factura>", mensajes: [] });
    expect(r.autorizaciones[0]?.fechaAutorizacion?.toISOString()).toBe("2024-05-10T20:30:00.000Z");
  });

  it("NO AUTORIZADO con mensajes, y sin autorizaciones (aún no procesado)", async () => {
    sri.colaAutorizacion.push(respuestaAutorizacion(CLAVE, [{ estado: "NO AUTORIZADO", mensajes: [{ identificador: "39", mensaje: "FIRMA INVALIDA", tipo: "ERROR" }] }]));
    const no = await cliente.consultarAutorizacion("1", CLAVE);
    expect(no.autorizaciones[0]).toMatchObject({ estado: "NO AUTORIZADO", mensajes: [{ identificador: "39", mensaje: "FIRMA INVALIDA" }] });
    sri.colaAutorizacion.push(respuestaAutorizacion(CLAVE, []));
    expect((await cliente.consultarAutorizacion("1", CLAVE)).autorizaciones).toEqual([]);
  });
});

describe("Fallos de comunicación: siempre reintentables (SriTransporteError)", () => {
  it("tiempo agotado, conexión cortada, servidor caído, HTTP 500, SOAP Fault y respuestas ininteligibles", async () => {
    sri.colaRecepcion.push({ tipo: "colgar" });
    await expect(cliente.enviarComprobante("1", "<a/>")).rejects.toThrow(/tiempo de espera agotado/);
    sri.colaRecepcion.push({ tipo: "cortar" });
    await expect(cliente.enviarComprobante("1", "<a/>")).rejects.toBeInstanceOf(SriTransporteError);
    sri.colaRecepcion.push(soapFault("Error en la base"));
    await expect(cliente.enviarComprobante("1", "<a/>")).rejects.toThrow(/SOAP Fault: Error en la base/);
    sri.colaRecepcion.push({ tipo: "xml", status: 503, cuerpo: "<html>Service Unavailable</html>" });
    await expect(cliente.enviarComprobante("1", "<a/>")).rejects.toThrow(/HTTP 503/);
    sri.colaRecepcion.push({ tipo: "xml", cuerpo: "esto no es xml <<<" });
    await expect(cliente.enviarComprobante("1", "<a/>")).rejects.toBeInstanceOf(SriTransporteError);
    sri.colaRecepcion.push({ tipo: "xml", cuerpo: "<a><b>inesperado</b></a>" });
    await expect(cliente.enviarComprobante("1", "<a/>")).rejects.toThrow(/inesperada/);
    sri.colaAutorizacion.push({ tipo: "xml", cuerpo: "<a/>" });
    await expect(cliente.consultarAutorizacion("1", CLAVE)).rejects.toThrow(/inesperada/);

    const caido = new SriSoapClient({ timeoutMs: 400, endpoints: { "1": { recepcion: "http://127.0.0.1:1/x", autorizacion: "http://127.0.0.1:1/y" } } });
    await expect(caido.enviarComprobante("1", "<a/>")).rejects.toThrow(/No se pudo comunicar con el SRI/);
    const mala = new SriSoapClient({ endpoints: { "1": { recepcion: "no es una url", autorizacion: "x" } } });
    await expect(mala.enviarComprobante("1", "<a/>")).rejects.toBeInstanceOf(SriTransporteError);
  });

  it("los intérpretes rechazan estados de recepción desconocidos", () => {
    expect(() => leerRespuestaRecepcion("<r><RespuestaRecepcionComprobante><estado>QUIZAS</estado></RespuestaRecepcionComprobante></r>")).toThrow(/inesperada/);
    expect(() => leerRespuestaAutorizacion("")).toThrow(SriTransporteError);
  });
});

describe("Utilidades de reintento y XML autorizado", () => {
  it("la espera crece de forma exponencial desde 30 s y se detiene en 30 min", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 50].map(esperaReintentoMs)).toEqual([30_000, 60_000, 120_000, 240_000, 480_000, 960_000, 1_800_000, 1_800_000, ESPERA_MAXIMA_MS]);
    expect(esperaReintentoMs(0)).toBe(30_000);
  });

  it("el XML autorizado envuelve el comprobante en CDATA (también si trae ']]>')", () => {
    const xml = construirXmlAutorizado({ estado: "AUTORIZADO", numeroAutorizacion: CLAVE, fechaAutorizacion: new Date("2024-05-10T20:30:00Z"), ambiente: "PRUEBAS", comprobante: null, mensajes: [] }, "<f>a]]>b</f>");
    expect(xml).toBe(`<autorizacion><estado>AUTORIZADO</estado><numeroAutorizacion>${CLAVE}</numeroAutorizacion><fechaAutorizacion>2024-05-10T20:30:00.000Z</fechaAutorizacion><ambiente>PRUEBAS</ambiente><comprobante><![CDATA[<f>a]]]]><![CDATA[>b</f>]]></comprobante></autorizacion>`);
  });
});

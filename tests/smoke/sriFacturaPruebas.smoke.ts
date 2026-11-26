import { readFile, stat } from "node:fs/promises";
import { setTimeout as esperar } from "node:timers/promises";
import { DOMParser } from "@xmldom/xmldom";
import { parsearClaveAcceso, validarClaveAcceso } from "../../src/server/services/sri/claveAcceso.util";
import { leerPkcs12, validarCertificadoParaEmisor } from "../../src/server/services/sri/firma/pkcs12.util";
import { firmarXmlXades, verificarFirmaXades } from "../../src/server/services/sri/firma/xades.firma";
import { endpointsSriPruebas, SriSoapClient } from "../../src/server/services/sri/ws/sriSoap.client";
import type { ClienteSri } from "../../src/server/services/sri/ws/sriSoap.types";
import { XsdValidatorService } from "../../src/server/services/sri/xsdValidator.service";

const AMBIENTE = "1";
const LIMITE_ARCHIVO = 5 * 1024 * 1024;

export async function leerArchivo(ruta: string): Promise<Buffer> {
  const info = await stat(ruta);
  if (!info.isFile() || info.size > LIMITE_ARCHIVO) throw new Error("Se requiere un archivo regular de hasta 5 MiB");
  return readFile(ruta);
}

export async function validarXsd(xml: string): Promise<void> {
  const resultado = await new XsdValidatorService().validar("factura", xml);
  if (!resultado.valido) throw new Error(resultado.errores.map(({ mensaje }) => mensaje).join("\n"));
}

export function validarClavePruebas(clave: string) {
  if (!validarClaveAcceso(clave)) throw new Error("La clave de acceso no pasa Módulo 11");
  const partes = parsearClaveAcceso(clave);
  if (partes.ambiente !== AMBIENTE || partes.tipoComprobante !== "01") throw new Error("Se requiere una clave de factura del ambiente 1 (pruebas)");
  return partes;
}

export async function leerFacturaPruebas(xml: string): Promise<{ clave: string; ruc: string }> {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("El XML de la factura contiene una declaración DTD");
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const trib = doc.documentElement?.getElementsByTagName("infoTributaria").item(0);
  if (doc.documentElement?.tagName !== "factura" || doc.getElementsByTagNameNS("*", "Signature").length !== 0 ||
      trib?.getElementsByTagName("ambiente").item(0)?.textContent?.trim() !== AMBIENTE) {
    throw new Error("Se requiere una factura XML sin firma del ambiente 1 (pruebas)");
  }
  await validarXsd(xml);
  const clave = trib.getElementsByTagName("claveAcceso").item(0)?.textContent?.trim() ?? "";
  const ruc = trib.getElementsByTagName("ruc").item(0)?.textContent?.trim() ?? "";
  if (validarClavePruebas(clave).ruc !== ruc) throw new Error("El RUC de la factura no coincide con su clave de acceso");
  return { clave, ruc };
}

async function consultar(cliente: ClienteSri, clave: string, intentos: number): Promise<void> {
  for (let i = 0; i < intentos; i++) {
    if (i > 0) await esperar(3000);
    const resultado = await cliente.consultarAutorizacion(AMBIENTE, clave);
    if (resultado.autorizaciones.length > 0 && resultado.claveAcceso !== clave) throw new Error("El SRI devolvió una clave distinta");
    const autorizada = resultado.autorizaciones.find((a) => a.estado === "AUTORIZADO" && a.ambiente === "PRUEBAS");
    if (autorizada) {
      console.log(`AUTORIZADO en PRUEBAS: ${autorizada.numeroAutorizacion ?? clave}`);
      return;
    }
    const final = resultado.autorizaciones.find((a) => a.estado === "NO AUTORIZADO" || a.estado === "AUTORIZADO");
    if (final) throw new Error(`Autorización de pruebas fallida: ${final.estado} (${final.ambiente ?? "sin ambiente"}) ${JSON.stringify(final.mensajes)}`);
  }
  throw new Error(`Autorización pendiente para ${clave}. Usa --consultar con la misma clave más tarde.`);
}

async function ejecutar(args: string[]): Promise<void> {
  if (args.length === 1 && args[0] === "--help") {
    console.log("Uso: npm run sri:smoke -- <factura.xml> <firma.p12> [--enviar] [--confirmar-titular]");
    console.log("     npm run sri:smoke -- --consultar <clave-acceso-pruebas>");
    return;
  }
  const cliente = new SriSoapClient({ timeoutMs: 15_000, endpoints: { "1": endpointsSriPruebas() } });
  const [primero, segundo, ...opciones] = args;
  if (primero === "--consultar" && segundo && opciones.length === 0) {
    validarClavePruebas(segundo);
    await consultar(cliente, segundo, 1);
    return;
  }
  if (!primero || !segundo || opciones.some((o) => o !== "--enviar" && o !== "--confirmar-titular")) {
    throw new Error("Indica el XML y el .p12. Usa --help para ver la sintaxis completa.");
  }
  const xml = (await leerArchivo(primero)).toString("utf8");
  const { clave, ruc } = await leerFacturaPruebas(xml);
  const password = process.env["SRI_P12_PASSWORD"];
  if (password === undefined) throw new Error("Configura SRI_P12_PASSWORD en el proceso antes de firmar");
  const material = leerPkcs12(await leerArchivo(segundo), password);
  const advertencias = validarCertificadoParaEmisor(material.info, { ruc, confirmarTitular: opciones.includes("--confirmar-titular") });
  for (const advertencia of advertencias) console.warn(advertencia);
  const firmado = firmarXmlXades(xml, material);
  if (!verificarFirmaXades(firmado).valida) throw new Error("La firma no pasó la verificación local");
  await validarXsd(firmado);
  console.log(`XSD y firma válidos para factura de pruebas ${clave}`);

  if (opciones.includes("--enviar")) {
    const recepcion = await cliente.enviarComprobante(AMBIENTE, firmado);
    if (recepcion.estado !== "RECIBIDA") throw new Error(`Recepción ${recepcion.estado}: ${JSON.stringify(recepcion.mensajes)}`);
    console.log("RECIBIDA en PRUEBAS");
    await consultar(cliente, clave, 5);
  }
}

if (require.main === module) void ejecutar(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Falló la prueba del SRI");
  process.exitCode = 1;
});

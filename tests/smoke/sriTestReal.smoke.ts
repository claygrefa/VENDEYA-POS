import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { setTimeout as esperar } from "node:timers/promises";
import { leerPkcs12, validarCertificadoParaEmisor } from "../../src/server/services/sri/firma/pkcs12.util";
import { firmarXmlXades, verificarFirmaXades } from "../../src/server/services/sri/firma/xades.firma";
import { SriSoapClient } from "../../src/server/services/sri/ws/sriSoap.client";
import { SriTransporteError } from "../../src/server/services/sri/ws/sriSoap.types";
import { leerArchivo, leerFacturaPruebas, validarClavePruebas, validarXsd } from "./sriFacturaPruebas.smoke";
import { pedirSecreto } from "./promptSecret.util";

async function ejecutar(args: string[]): Promise<void> {
  if (args[0] === "--help") {
    console.log("npm run sri:test-real [-- --consultar <clave-de-acceso>]");
    return;
  }
  const cliente = new SriSoapClient({ timeoutMs: 15_000 });
  let clave: string;
  if (args[0] === "--consultar" && args[1] && args.length === 2) {
    clave = args[1];
    validarClavePruebas(clave);
  } else {
    if (args.length !== 0 || !process.stdin.isTTY) throw new Error("Usa una terminal interactiva o --consultar <clave>");
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    let xml: string;
    let p12: string;
    let datos: Awaited<ReturnType<typeof leerFacturaPruebas>>;
    try {
      const ruc = (await rl.question("RUC del emisor habilitado en celcer: ")).trim();
      p12 = (await rl.question("Ruta del certificado .p12: ")).trim().replace(/^"(.*)"$/, "$1");
      const factura = (await rl.question("Ruta de la factura 2.1.0 sin firma, ambiente 1: ")).trim().replace(/^"(.*)"$/, "$1");
      xml = (await leerArchivo(factura)).toString("utf8");
      datos = await leerFacturaPruebas(xml);
      if (ruc !== datos.ruc) throw new Error("El RUC ingresado difiere del XML");
      const confirmacion = await rl.question(`Escribe ENVIAR para transmitir la factura ${datos.clave} a celcer: `);
      if (confirmacion !== "ENVIAR") throw new Error("Envío cancelado");
    } finally {
      rl.close();
    }
    clave = datos.clave;
    const material = leerPkcs12(await leerArchivo(p12), await pedirSecreto("Contraseña del .p12: "));
    validarCertificadoParaEmisor(material.info, { ruc: datos.ruc });
    const firmado = firmarXmlXades(xml, material);
    if (!verificarFirmaXades(firmado).valida) throw new Error("La firma XAdES no pasó la verificación local");
    await validarXsd(firmado);
    try {
      const r = await cliente.enviarComprobante("1", firmado);
      if (r.estado !== "RECIBIDA" && !r.mensajes.some((m) => ["43", "70"].includes(m.identificador))) {
        throw new Error(`Recepción ${r.estado}: ${JSON.stringify(r.mensajes)}`);
      }
    } catch (error) {
      if (!(error instanceof SriTransporteError)) throw error;
      console.warn("Recepción indeterminada. Se consultará la clave sin reenviarla.");
    }
  }

  for (let i = 0; i < 18; i++) {
    if (i > 0) await esperar(5_000);
    const r = await cliente.consultarAutorizacionConXml("1", clave).catch((error: unknown) => {
      if (!(error instanceof SriTransporteError)) throw error;
      return null;
    });
    if (!r || r.resultado.autorizaciones.length === 0) continue;
    if (r.resultado.claveAcceso !== clave) throw new Error("El SRI devolvió otra clave");
    const a = r.resultado.autorizaciones.find((x) => x.estado === "AUTORIZADO" && x.ambiente === "PRUEBAS" && x.comprobante);
    if (a?.numeroAutorizacion && a.fechaAutorizacion && a.comprobante && verificarFirmaXades(a.comprobante).valida) {
      const archivo = `sri-${clave}.xml`;
      await mkdir("evidence", { recursive: true });
      await writeFile(`evidence/${archivo}`, r.xml, { mode: 0o600 });
      await writeFile("evidence/sri.json", JSON.stringify({
        status: "AUTORIZADO", environment: "PRUEBAS", accessKey: clave, file: archivo,
        sha256: createHash("sha256").update(r.xml).digest("hex"), checkedAt: new Date().toISOString(),
      }, null, 2), { mode: 0o600 });
      console.log(`AUTORIZADO en celcer. Evidencia: evidence/${archivo}`);
      return;
    }
    const final = r.resultado.autorizaciones.find((x) => ["NO AUTORIZADO", "RECHAZADO", "AUTORIZADO"].includes(x.estado));
    if (final) throw new Error(`Respuesta final sin una autorización de pruebas válida: ${final.estado} ${JSON.stringify(final.mensajes)}`);
  }
  throw new Error(`Autorización pendiente. Ejecuta npm run sri:test-real -- --consultar ${clave}`);
}

void ejecutar(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Falló la prueba del SRI");
  process.exitCode = 1;
});

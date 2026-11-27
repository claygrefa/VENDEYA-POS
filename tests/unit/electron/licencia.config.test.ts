// ============================================================
// tests/unit/electron/licencia.config.test.ts — Configuración del servidor de licencias de la compilación
// ============================================================
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, expect, it } from "vitest";
import { cargarConfigLicencia, cargarDestinoTelemetria } from "../../../electron/licencia.config";
import { generarClavesLicencia } from "../../helpers/licencias.helper";

const { publica } = generarClavesLicencia();
const dir = mkdtempSync(path.join(os.tmpdir(), "vendeya-licfg-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function archivo(nombre: string, contenido: unknown): string {
  const ruta = path.join(dir, nombre);
  writeFileSync(ruta, typeof contenido === "string" ? contenido : JSON.stringify(contenido));
  return ruta;
}

describe("Configuración del licenciamiento", () => {
  it("sin variables ni archivo no hay configuración (el licenciamiento queda desactivado)", () => {
    expect(cargarConfigLicencia({ rutas: [path.join(dir, "no-existe.json")], env: {} })).toBeNull();
  });

  it("lee el archivo de la compilación (la primera ruta que exista)", () => {
    const ruta = archivo("a.json", { servidorUrl: "https://licencias.ejemplo.test/api/", clavePublica: publica });
    expect(cargarConfigLicencia({ rutas: [path.join(dir, "no-existe.json"), ruta], env: {} })).toEqual({ servidorUrl: "https://licencias.ejemplo.test/api", clavePublica: publica.trim() });
  });

  it("las variables de entorno mandan sobre el archivo, y aceptan la clave con «\\n» escapados", () => {
    const ruta = archivo("b.json", { servidorUrl: "https://del-archivo.test", clavePublica: publica });
    const r = cargarConfigLicencia({ rutas: [ruta], env: { VENDEYA_LICENCIAS_URL: "https://de-la-variable.test", VENDEYA_LICENCIAS_CLAVE_PUBLICA: publica.trim().replace(/\n/g, "\\n") } });
    expect(r).toEqual({ servidorUrl: "https://de-la-variable.test", clavePublica: publica.trim() });
  });

  it("completa con el archivo lo que falte en las variables", () => {
    const ruta = archivo("c.json", { servidorUrl: "https://del-archivo.test", clavePublica: publica });
    expect(cargarConfigLicencia({ rutas: [ruta], env: { VENDEYA_LICENCIAS_URL: "https://de-la-variable.test" } })).toMatchObject({ servidorUrl: "https://de-la-variable.test" });
  });

  it("rechaza (y lo avisa) una URL que no es https, salvo contra el propio equipo", () => {
    const avisos: string[] = [];
    const base = { rutas: [], registrar: (m: string) => avisos.push(m) };
    expect(cargarConfigLicencia({ ...base, env: { VENDEYA_LICENCIAS_URL: "http://licencias.ejemplo.test", VENDEYA_LICENCIAS_CLAVE_PUBLICA: publica } })).toBeNull();
    expect(cargarConfigLicencia({ ...base, env: { VENDEYA_LICENCIAS_URL: "ftp://x", VENDEYA_LICENCIAS_CLAVE_PUBLICA: publica } })).toBeNull();
    expect(cargarConfigLicencia({ ...base, env: { VENDEYA_LICENCIAS_URL: "no es url", VENDEYA_LICENCIAS_CLAVE_PUBLICA: publica } })).toBeNull();
    expect(avisos).toHaveLength(3);
    expect(cargarConfigLicencia({ ...base, env: { VENDEYA_LICENCIAS_URL: "http://localhost:4000", VENDEYA_LICENCIAS_CLAVE_PUBLICA: publica } })).toMatchObject({ servidorUrl: "http://localhost:4000" });
    expect(cargarConfigLicencia({ ...base, env: { VENDEYA_LICENCIAS_URL: "http://127.0.0.1:4000/", VENDEYA_LICENCIAS_CLAVE_PUBLICA: publica } })).toMatchObject({ servidorUrl: "http://127.0.0.1:4000" });
  });

  it("rechaza una clave que no es un PEM de clave pública y un archivo con JSON inválido", () => {
    const avisos: string[] = [];
    const registrar = (m: string): number => avisos.push(m);
    expect(cargarConfigLicencia({ rutas: [], registrar, env: { VENDEYA_LICENCIAS_URL: "https://x.test", VENDEYA_LICENCIAS_CLAVE_PUBLICA: "no es una clave" } })).toBeNull();
    expect(cargarConfigLicencia({ rutas: [], registrar, env: { VENDEYA_LICENCIAS_URL: "https://x.test", VENDEYA_LICENCIAS_CLAVE_PUBLICA: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----" } })).toBeNull();
    expect(cargarConfigLicencia({ rutas: [archivo("roto.json", "{ no es json")], registrar, env: {} })).toBeNull();
    expect(avisos).toHaveLength(3);
    expect(avisos[2]).toContain("el JSON es inválido");
  });

  describe("aplicación instalada: el entorno no manda", () => {
    const { publica: ajena } = generarClavesLicencia();

    it("ignora las variables de entorno (otra URL y otra clave) y usa solo la configuración incrustada", () => {
      const ruta = archivo("instalada.json", { servidorUrl: "https://del-instalador.test", clavePublica: publica, telemetriaUrl: "https://del-instalador.test/v1/telemetria" });
      const env = { LICENSE_SERVER_URL: "https://del-atacante.test", LICENSE_PUBLIC_KEY: ajena, VENDEYA_LICENCIAS_URL: "https://otro.test", TELEMETRY_URL: "https://del-atacante.test/t" };
      expect(cargarConfigLicencia({ rutas: [ruta], env, empaquetada: true })).toEqual({ servidorUrl: "https://del-instalador.test", clavePublica: publica.trim() });
      expect(cargarDestinoTelemetria({ rutas: [ruta], env, empaquetada: true })).toBe("https://del-instalador.test/v1/telemetria");
      // en desarrollo (no instalada) las variables siguen mandando
      expect(cargarConfigLicencia({ rutas: [ruta], env: { LICENSE_SERVER_URL: "https://de-desarrollo.test", LICENSE_PUBLIC_KEY: ajena }, empaquetada: false })).toMatchObject({ servidorUrl: "https://de-desarrollo.test" });
    });

    it("sin configuración incrustada no hay licenciamiento configurado aunque el entorno la traiga", () => {
      const env = { LICENSE_SERVER_URL: "https://del-atacante.test", LICENSE_PUBLIC_KEY: ajena };
      expect(cargarConfigLicencia({ rutas: [path.join(dir, "no-existe.json")], env, empaquetada: true })).toBeNull();
      expect(cargarDestinoTelemetria({ rutas: [], env: { TELEMETRY_URL: "https://del-atacante.test/t" }, empaquetada: true })).toBeUndefined();
    });
  });
});

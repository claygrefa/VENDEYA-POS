// ============================================================
// tests/unit/server/sri/firma/cifrado.test.ts — AES-256-GCM y proveedor de la clave maestra
// ============================================================
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { randomBytes } from "crypto";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cifrarSecreto, derivarClaveCifrado, descifrarSecreto } from "../../../../../src/server/services/sri/firma/cifrado.util";
import { ProveedorClaveMaestra, type ProteccionClave } from "../../../../../src/server/services/sri/firma/claveMaestra.provider";

const clave = randomBytes(32);
const AAD = "empresa:abc";

const mutar = (b64: string): string => {
  const b = Buffer.from(b64, "base64");
  b[0] = (b[0] as number) ^ 0x01;
  return b.toString("base64");
};

describe("AES-256-GCM", () => {
  it("ida y vuelta, con IV distinto en cada cifrado", () => {
    const a = cifrarSecreto("mi-contraseña-ñ-€", clave, AAD);
    const b = cifrarSecreto("mi-contraseña-ñ-€", clave, AAD);
    expect(descifrarSecreto(a, clave, AAD)).toBe("mi-contraseña-ñ-€");
    expect(a.iv).not.toBe(b.iv);
    expect(a.cifrado).not.toBe(b.cifrado);
    expect(Buffer.from(a.iv, "base64")).toHaveLength(12);
    expect(Buffer.from(a.tag, "base64")).toHaveLength(16);
    expect(a.cifrado).not.toContain("contraseña");
  });

  it("alterar el texto cifrado, el IV o la etiqueta falla con el mismo error genérico", () => {
    const s = cifrarSecreto("secreto", clave, AAD);
    const errores = [
      { ...s, cifrado: mutar(s.cifrado) },
      { ...s, iv: mutar(s.iv) },
      { ...s, tag: mutar(s.tag) },
      { ...s, tag: s.tag.slice(0, 8) }, // etiqueta truncada
      { ...s, iv: Buffer.alloc(8).toString("base64") }, // IV de longitud inválida
    ].map((x) => {
      try {
        descifrarSecreto(x, clave, AAD);
        return "NO FALLÓ";
      } catch (e) {
        return (e as Error).message;
      }
    });
    expect(new Set(errores).size).toBe(1);
    expect(errores[0]).toMatch(/No se pudo descifrar/);
  });

  it("falla con otra clave maestra o con otro dueño (AAD)", () => {
    const s = cifrarSecreto("secreto", clave, AAD);
    expect(() => descifrarSecreto(s, randomBytes(32), AAD)).toThrow(/No se pudo descifrar/);
    expect(() => descifrarSecreto(s, clave, "empresa:otra")).toThrow(/No se pudo descifrar/);
  });

  it("la clave maestra debe medir 32 bytes y la derivada es distinta de la maestra", () => {
    expect(() => derivarClaveCifrado(Buffer.alloc(16))).toThrow(/32 bytes/);
    expect(derivarClaveCifrado(clave).equals(clave)).toBe(false);
    expect(derivarClaveCifrado(clave).equals(derivarClaveCifrado(clave))).toBe(true);
  });
});

describe("ProveedorClaveMaestra", () => {
  let dir: string;
  const VARIABLE = "VENDEYA_TEST_CLAVE";
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "vendeya-clave-"));
    delete process.env[VARIABLE];
  });
  afterEach(() => {
    delete process.env[VARIABLE];
    rmSync(dir, { recursive: true, force: true });
  });
  const proveedor = (proteccion?: ProteccionClave): ProveedorClaveMaestra =>
    new ProveedorClaveMaestra({ directorio: dir, variableEntorno: VARIABLE, ...(proteccion !== undefined ? { proteccion } : {}) });

  it("genera la clave en el primer uso, la persiste y devuelve siempre la misma", () => {
    const p = proveedor();
    expect(existsSync(path.join(dir, "master.key"))).toBe(false);
    const k1 = p.obtener();
    expect(k1).toHaveLength(32);
    expect(proveedor().obtener().equals(k1)).toBe(true);
    expect(existsSync(path.join(dir, "master.key.tmp"))).toBe(false); // sin temporales residuales
  });

  it("la variable de entorno tiene prioridad, no escribe archivos y no se puede rotar", () => {
    const k = randomBytes(32);
    process.env[VARIABLE] = k.toString("base64");
    const p = proveedor();
    expect(p.desdeEntorno).toBe(true);
    expect(p.obtener().equals(k)).toBe(true);
    expect(existsSync(path.join(dir, "master.key"))).toBe(false);
    expect(() => p.prepararRotacion()).toThrow(/entorno/);
  });

  it("rechaza una clave de entorno que no mide 32 bytes", () => {
    process.env[VARIABLE] = Buffer.alloc(10).toString("base64");
    expect(() => proveedor().obtener()).toThrow(/32 bytes/);
  });

  it("con protección del sistema la clave no queda en claro en el archivo", () => {
    const proteccion: ProteccionClave = {
      proteger: (b64) => `PROTEGIDO:${Buffer.from(b64).toString("hex")}`,
      desproteger: (p) => Buffer.from(p.replace("PROTEGIDO:", ""), "hex").toString(),
    };
    const p = proveedor(proteccion);
    const k = p.obtener();
    const contenido = readFileSync(path.join(dir, "master.key"), "utf8");
    expect(contenido).not.toContain(k.toString("base64"));
    expect(JSON.parse(contenido)).toMatchObject({ proteccion: "so" });
    expect(proveedor(proteccion).obtener().equals(k)).toBe(true);
    // sin la protección no se puede leer
    expect(() => proveedor().obtener()).toThrow(/protegida por el sistema operativo/);
  });

  it("archivo de clave dañado", () => {
    writeFileSync(path.join(dir, "master.key"), "esto no es json");
    expect(() => proveedor().obtener()).toThrow(/dañado/);
  });

  it("rotación en dos fases: preparar no cambia la vigente; confirmar la reemplaza; cancelar descarta", () => {
    const p = proveedor();
    const vieja = p.obtener();
    const nueva = p.prepararRotacion();
    expect(p.hayRotacionPendiente).toBe(true);
    expect(p.obtener().equals(vieja)).toBe(true);
    // con una rotación a medias se puede descifrar con cualquiera de las dos
    const candidatas = p.candidatas();
    expect(candidatas).toHaveLength(2);
    expect(candidatas[1]?.equals(nueva)).toBe(true);

    p.confirmarRotacion();
    expect(p.hayRotacionPendiente).toBe(false);
    expect(p.obtener().equals(nueva)).toBe(true);
    expect(p.candidatas()).toHaveLength(1);

    p.prepararRotacion();
    p.cancelarRotacion();
    expect(p.hayRotacionPendiente).toBe(false);
    expect(p.obtener().equals(nueva)).toBe(true);
    expect(() => p.confirmarRotacion()).toThrow(/No hay una rotación/);
  });
});

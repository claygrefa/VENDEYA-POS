// ============================================================
// tests/unit/server/sri/claveAcceso.test.ts — Clave de Acceso (Ficha Técnica SRI, sección 5.2)
// ============================================================
import { describe, expect, it } from "vitest";
import { AppError } from "../../../../src/server/services/appError.util";
import {
  calcularDigitoVerificador,
  generarClaveAcceso,
  generarCodigoNumerico,
  parsearClaveAcceso,
  validarClaveAcceso,
  type EntradaClaveAcceso,
} from "../../../../src/server/services/sri/claveAcceso.util";
import { aFechaCivilEcuador, fechaParaClave, fechaParaXml } from "../../../../src/server/services/sri/fechaEcuador.util";

/** Implementación independiente (otra forma de recorrer la cadena) para contrastar con la del sistema. */
function modulo11Referencia(cadena: string): number {
  const ponderadores = [2, 3, 4, 5, 6, 7];
  const suma = [...cadena].reverse().reduce((acc, d, i) => acc + Number(d) * (ponderadores[i % 6] as number), 0);
  const r = 11 - (suma % 11);
  return r === 11 ? 0 : r === 10 ? 1 : r;
}

const base: EntradaClaveAcceso = {
  fechaEmision: new Date("2023-12-01T15:00:00Z"),
  tipoComprobante: "01",
  ruc: "1790012345001",
  ambiente: "1",
  establecimiento: "001",
  puntoEmision: "002",
  secuencial: 123,
  codigoNumerico: "12345678",
};

describe("Módulo 11", () => {
  it("reproduce el ejemplo oficial de la Ficha Técnica: 41261533 → 6", () => {
    // 3·4 + 2·1 + 7·2 + 6·6 + 5·1 + 4·5 + 3·3 + 2·3 = 104; 104 mod 11 = 5; 11 − 5 = 6
    expect(calcularDigitoVerificador("41261533")).toBe(6);
  });

  it("resultado 11 → dígito 0", () => {
    expect(calcularDigitoVerificador("00")).toBe(0); // suma 0 → 11 − 0 = 11
    expect(calcularDigitoVerificador("0000000000")).toBe(0);
  });

  it("resultado 10 → dígito 1", () => {
    // 5·2 + 8·3 = 34; 34 mod 11 = 1; 11 − 1 = 10 → 1
    expect(calcularDigitoVerificador("85")).toBe(1);
  });

  it("los ponderadores se repiten cada 6 posiciones (2,3,4,5,6,7,2,…)", () => {
    // 1 en la 7.ª posición desde la derecha pesa 2: suma 2 → 11 − 2 = 9
    expect(calcularDigitoVerificador("1000000")).toBe(9);
    expect(calcularDigitoVerificador("1000000")).toBe(modulo11Referencia("1000000"));
  });

  it("coincide con la implementación independiente en 2.000 cadenas aleatorias de 48 dígitos", () => {
    for (let i = 0; i < 2000; i++) {
      const cadena = Array.from({ length: 48 }, () => Math.floor(Math.random() * 10)).join("");
      expect(calcularDigitoVerificador(cadena)).toBe(modulo11Referencia(cadena));
    }
  });

  it("rechaza cadenas con caracteres no numéricos", () => {
    expect(() => calcularDigitoVerificador("12a4")).toThrow(AppError);
  });
});

describe("generarClaveAcceso", () => {
  it("compone los 9 campos en el orden y la longitud de la Tabla 1", () => {
    const clave = generarClaveAcceso(base);
    expect(clave).toHaveLength(49);
    expect(clave.slice(0, 48)).toBe(
      "01122023" + "01" + "1790012345001" + "1" + "001002" + "000000123" + "12345678" + "1"
    );
    expect(Number(clave[48])).toBe(modulo11Referencia(clave.slice(0, 48)));
  });

  it("parsearClaveAcceso es la inversa y validarClaveAcceso la acepta", () => {
    const clave = generarClaveAcceso({ ...base, tipoComprobante: "04", ambiente: "2", secuencial: 987654321 });
    expect(validarClaveAcceso(clave)).toBe(true);
    expect(parsearClaveAcceso(clave)).toMatchObject({
      fechaEmision: "01122023", tipoComprobante: "04", ruc: "1790012345001", ambiente: "2", serie: "001002",
      secuencial: "987654321", codigoNumerico: "12345678", tipoEmision: "1",
    });
  });

  it("cualquier error de un solo dígito invalida la clave (los 49 puestos)", () => {
    const clave = generarClaveAcceso(base);
    for (let i = 0; i < 49; i++) {
      const alterada = clave.slice(0, i) + String((Number(clave[i]) + 1) % 10) + clave.slice(i + 1);
      expect(validarClaveAcceso(alterada), `posición ${i}`).toBe(false);
    }
  });

  it("validarClaveAcceso rechaza longitudes y caracteres inválidos", () => {
    expect(validarClaveAcceso("123")).toBe(false);
    expect(validarClaveAcceso("a".repeat(49))).toBe(false);
    expect(validarClaveAcceso("1".repeat(50))).toBe(false);
  });

  it("el secuencial se rellena a 9 dígitos y el código numérico se genera si falta", () => {
    const sin = generarClaveAcceso({ ...base, secuencial: 1, codigoNumerico: undefined as unknown as string });
    expect(parsearClaveAcceso(sin).secuencial).toBe("000000001");
    expect(parsearClaveAcceso(sin).codigoNumerico).toMatch(/^\d{8}$/);
    expect(validarClaveAcceso(sin)).toBe(true);
  });

  it("valida cada campo de entrada", () => {
    const mal = (cambios: Partial<EntradaClaveAcceso>) => () => generarClaveAcceso({ ...base, ...cambios });
    expect(mal({ tipoComprobante: "99" })).toThrow(/Tipo de comprobante/);
    expect(mal({ ruc: "123" })).toThrow(/RUC/);
    expect(mal({ ruc: "1790012345002" })).toThrow(/RUC/); // debe terminar en 001
    expect(mal({ ambiente: "3" as "1" })).toThrow(/ambiente/);
    expect(mal({ establecimiento: "1" })).toThrow(/Establecimiento/);
    expect(mal({ puntoEmision: "0001" })).toThrow(/Punto de emisión/);
    expect(mal({ secuencial: 0 })).toThrow(/Secuencial/);
    expect(mal({ secuencial: 1_000_000_000 })).toThrow(/Secuencial/);
    expect(mal({ secuencial: 1.5 })).toThrow(/Secuencial/);
    expect(mal({ codigoNumerico: "123" })).toThrow(/código numérico/);
  });

  it("generarCodigoNumerico produce siempre 8 dígitos", () => {
    for (let i = 0; i < 200; i++) expect(generarCodigoNumerico()).toMatch(/^\d{8}$/);
  });
});

describe("Fecha civil de Ecuador (UTC−5)", () => {
  it("una venta a las 21:30 locales sigue siendo del mismo día aunque en UTC ya sea el siguiente", () => {
    const tarde = new Date("2024-01-02T02:30:00Z"); // 01/01/2024 21:30 en Guayaquil
    expect(aFechaCivilEcuador(tarde)).toEqual({ dia: 1, mes: 1, anio: 2024 });
    expect(fechaParaClave(tarde)).toBe("01012024");
    expect(fechaParaXml(tarde)).toBe("01/01/2024");
  });

  it("después de las 05:00 UTC es el día UTC; antes, el día anterior", () => {
    expect(fechaParaXml(new Date("2024-03-10T04:59:59Z"))).toBe("09/03/2024");
    expect(fechaParaXml(new Date("2024-03-10T05:00:00Z"))).toBe("10/03/2024");
  });

  it("cambio de año y de mes", () => {
    expect(fechaParaXml(new Date("2025-01-01T03:00:00Z"))).toBe("31/12/2024");
    expect(fechaParaXml(new Date("2024-03-01T04:00:00Z"))).toBe("29/02/2024"); // año bisiesto
  });

  it("la clave usa esa fecha (no la del servidor)", () => {
    const clave = generarClaveAcceso({ ...base, fechaEmision: new Date("2024-01-02T02:30:00Z") });
    expect(parsearClaveAcceso(clave).fechaEmision).toBe("01012024");
  });
});

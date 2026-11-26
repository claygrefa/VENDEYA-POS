// Pruebas de fechaEcuador.util, xmlTexto.util y xsdValidator.service
import { describe, expect, it } from "vitest";
import { fechaHoraIsoEcuador } from "../../../../src/server/services/sri/fechaEcuador.util";
import { formatoDinero, formatoUnitario, limpiarTexto, limpiarTextoOpcional } from "../../../../src/server/services/sri/xmlTexto.util";
import { XsdValidatorService } from "../../../../src/server/services/sri/xsdValidator.service";

describe("fechaEcuador.util", () => {
  it("fechaHoraIsoEcuador usa la hora civil UTC−5 con su desfase", () => {
    expect(fechaHoraIsoEcuador(new Date("2024-05-11T02:30:05Z"))).toBe("2024-05-10T21:30:05-05:00");
  });
});

describe("xmlTexto.util", () => {
  it("limpiarTexto quita controles, normaliza saltos y espacios y recorta", () => {
    expect(limpiarTexto("  Hola\u0001\r\n  mundo\t!  ", 50)).toBe("Hola mundo !");
    expect(limpiarTexto("abcdefghij", 4)).toBe("abcd");
  });

  it("limpiarTexto usa el respaldo si queda vacío; el opcional devuelve undefined", () => {
    expect(limpiarTexto("   \n ", 10)).toBe("N/A");
    expect(limpiarTexto(null, 10, "X")).toBe("X");
    expect(limpiarTextoOpcional(undefined, 10)).toBeUndefined();
    expect(limpiarTextoOpcional(" ok ", 10)).toBe("ok");
  });

  it("formatoDinero (2 decimales) y formatoUnitario (6 decimales)", () => {
    expect(formatoDinero(1.005)).toBe("1.01");
    expect(formatoDinero(10)).toBe("10.00");
    expect(formatoUnitario(0.1234567)).toBe("0.123457");
    expect(formatoUnitario(2)).toBe("2.000000");
  });
});

describe("xsdValidator.service", () => {
  const validador = new XsdValidatorService();

  it("un XML mal formado o fuera del esquema es inválido y reporta el elemento con error", async () => {
    const r = await validador.validar("factura", `<?xml version="1.0" encoding="UTF-8"?><factura id="comprobante" version="2.1.0"><infoTributaria><ambiente>9</ambiente></infoTributaria></factura>`);
    expect(r.valido).toBe(false);
    expect(r.errores.length).toBeGreaterThan(0);
    expect(r.errores.every((e) => e.mensaje.length > 0 && !e.mensaje.startsWith("comprobante.xml"))).toBe(true);
    expect(r.errores.some((e) => e.elemento !== null)).toBe(true);
  });

  it("falla de forma clara si la carpeta de esquemas no existe", async () => {
    await expect(new XsdValidatorService("Z:/no-existe-vendeya").validar("factura", "<a/>")).rejects.toThrow();
  });
});

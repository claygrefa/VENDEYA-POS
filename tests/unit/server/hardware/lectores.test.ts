// ============================================================
// tests/unit/server/hardware/lectores.test.ts — Códigos de barras, detector de escaneo y protocolos de balanza
// ============================================================
import { describe, expect, it } from "vitest";
import { armarEtiquetaBalanza, digitoVerificadorGs1, esGtinValido, leerEtiquetaBalanza } from "../../../../src/server/services/hardware/codigoBarras.util";
import { leerPesoEstable, parsearLinea, type PuertoSerie } from "../../../../src/server/services/hardware/balanza.protocolo";
import { DetectorEscaneo, type ResultadoTecla } from "../../../../src/server/services/hardware/detectorEscaneo.util";
import { kilosAUnidad } from "../../../../src/server/services/hardware/escaneo.service";

describe("Dígito verificador GS1 y etiquetas de balanza", () => {
  it("valida EAN-13, EAN-8, UPC-A y GTIN-14 reales y rechaza los alterados", () => {
    for (const bueno of ["4006381333931", "5901234123457", "96385074", "036000291452", "10012345678902"]) expect(esGtinValido(bueno), bueno).toBe(true);
    for (const malo of ["4006381333932", "5901234123450", "96385075", "036000291453", "123", "abcdefghijklm", "400638133393"]) expect(esGtinValido(malo), malo).toBe(false);
    expect(digitoVerificadorGs1("400638133393")).toBe(1);
    expect(() => digitoVerificadorGs1("12a")).toThrow();
  });

  it("etiqueta de peso: PLU de 6 dígitos y gramos de 5; ida y vuelta con el verificador correcto", () => {
    const codigo = armarEtiquetaBalanza("123456", 1.25, "PESO");
    expect(codigo).toMatch(/^2123456\d{5}\d$/);
    expect(codigo.slice(0, 12)).toBe("212345601250");
    expect(esGtinValido(codigo)).toBe(true);
    expect(leerEtiquetaBalanza(codigo, "PESO")).toEqual({ plu: "123456", tipo: "PESO", valor: 1.25 });
    expect(leerEtiquetaBalanza(armarEtiquetaBalanza("42", 0.005, "PESO"), "PESO")).toEqual({ plu: "000042", tipo: "PESO", valor: 0.005 });
  });

  it("etiqueta de precio: centavos de 5 dígitos", () => {
    const codigo = armarEtiquetaBalanza("000777", 3.5, "PRECIO");
    expect(codigo.slice(0, 12)).toBe("200077700350");
    expect(leerEtiquetaBalanza(codigo, "PRECIO")).toEqual({ plu: "000777", tipo: "PRECIO", valor: 3.5 });
  });

  it("no es etiqueta si no empieza con 2, no mide 13 o el verificador no coincide; no caben valores enormes", () => {
    const codigo = armarEtiquetaBalanza("123456", 1, "PESO");
    expect(leerEtiquetaBalanza(`7${codigo.slice(1)}`, "PESO")).toBeNull();
    expect(leerEtiquetaBalanza(codigo.slice(0, 12) + String((Number(codigo.slice(12)) + 1) % 10), "PESO")).toBeNull();
    expect(leerEtiquetaBalanza(codigo.slice(1), "PESO")).toBeNull();
    expect(leerEtiquetaBalanza("hola", "PESO")).toBeNull();
    expect(() => armarEtiquetaBalanza("1234567", 1, "PESO")).toThrow(/PLU/);
    expect(() => armarEtiquetaBalanza("1", 100, "PESO")).toThrow(/5 dígitos/);
    expect(() => armarEtiquetaBalanza("1", -1, "PESO")).toThrow(/5 dígitos/);
  });

  it("conversión de kilos a la unidad del producto", () => {
    expect(kilosAUnidad(1.5, "KG")).toBe(1.5);
    expect(kilosAUnidad(1, "LB")).toBe(2.205);
    expect(kilosAUnidad(0.25, "G")).toBe(250);
    expect(kilosAUnidad(1, "UN")).toBeNull();
  });
});

/** Escribe `texto` como si fuera tecleado: una tecla cada `cada` ms desde `inicio`; devuelve el último resultado y el tiempo final. */
function teclear(d: DetectorEscaneo, texto: string, inicio: number, cada: number): { fin: number; ultimo: ResultadoTecla | null } {
  let t = inicio;
  let ultimo: ResultadoTecla | null = null;
  for (const c of texto) {
    ultimo = d.teclaPresionada(c, t);
    t += cada;
  }
  return { fin: t, ultimo };
}

describe("Detector de escaneo vs. digitación", () => {
  it("una ráfaga rápida terminada en Enter es un ESCANEO", () => {
    const d = new DetectorEscaneo();
    const { fin } = teclear(d, "7861234567890", 1_000, 8);
    expect(d.texto).toBe("7861234567890");
    expect(d.teclaPresionada("Enter", fin)).toEqual({ tipo: "ESCANEO", codigo: "7861234567890" });
    expect(d.texto).toBe(""); // listo para el siguiente
  });

  it("escritura con pausas es MANUAL aunque tenga el mismo contenido", () => {
    const d = new DetectorEscaneo();
    const { fin } = teclear(d, "7861234567890", 1_000, 220);
    expect(d.teclaPresionada("Enter", fin)).toEqual({ tipo: "MANUAL", texto: "7861234567890" });
  });

  it("una sola pausa larga en medio ya delata a una persona; la primera tecla puede llegar tarde", () => {
    const d = new DetectorEscaneo();
    teclear(d, "78612", 5_000, 10);
    teclear(d, "34567", 5_400, 10); // pausa de ~350 ms
    expect(d.teclaPresionada("Enter", 5_500)).toEqual({ tipo: "MANUAL", texto: "7861234567" });
    // el primer carácter del escaneo no tiene tecla previa: no cuenta como pausa
    const e = new DetectorEscaneo();
    const { fin } = teclear(e, "ABC12345", 60_000, 5);
    expect(e.teclaPresionada("Enter", fin)).toMatchObject({ tipo: "ESCANEO" });
  });

  it("el Retroceso (que los lectores nunca usan) vuelve manual la entrada", () => {
    const d = new DetectorEscaneo();
    teclear(d, "12345X", 0, 5);
    d.teclaPresionada("Backspace", 40);
    teclear(d, "6", 45, 5);
    expect(d.texto).toBe("123456");
    expect(d.teclaPresionada("Enter", 55)).toEqual({ tipo: "MANUAL", texto: "123456" });
  });

  it("entradas demasiado cortas o largas no son escaneos; Enter vacío se ignora; Escape reinicia; Shift y flechas no cuentan", () => {
    const corto = new DetectorEscaneo();
    const c = teclear(corto, "123", 0, 5);
    expect(corto.teclaPresionada("Enter", c.fin)).toEqual({ tipo: "MANUAL", texto: "123" });

    const largo = new DetectorEscaneo({ maxLongitud: 10 });
    const l = teclear(largo, "12345678901", 0, 5);
    expect(largo.teclaPresionada("Enter", l.fin)).toMatchObject({ tipo: "MANUAL" });

    const d = new DetectorEscaneo();
    expect(d.teclaPresionada("Enter", 0)).toEqual({ tipo: "IGNORADA" });
    expect(d.teclaPresionada("Shift", 1)).toEqual({ tipo: "IGNORADA" });
    expect(d.teclaPresionada("ArrowLeft", 2)).toEqual({ tipo: "IGNORADA" });
    teclear(d, "ABCDEF", 10, 5);
    expect(d.teclaPresionada("Escape", 50)).toEqual({ tipo: "REINICIO" });
    expect(d.texto).toBe("");
    const siguiente = teclear(d, "ZZZZ9", 60, 5);
    expect(d.teclaPresionada("Enter", siguiente.fin)).toEqual({ tipo: "ESCANEO", codigo: "ZZZZ9" });
  });

  it("el umbral es configurable", () => {
    const lento = new DetectorEscaneo({ maxMsEntreTeclas: 120 });
    const { fin } = teclear(lento, "1234567", 0, 100);
    expect(lento.teclaPresionada("Enter", fin)).toMatchObject({ tipo: "ESCANEO" });
    const normal = new DetectorEscaneo();
    const r = teclear(normal, "1234567", 0, 100);
    expect(normal.teclaPresionada("Enter", r.fin)).toMatchObject({ tipo: "MANUAL" });
  });
});

describe("Protocolos de balanza", () => {
  it("CAS: estado (ST/US), bruto/neto y unidades normalizadas a kilogramos", () => {
    expect(parsearLinea("ST,GS,+  1.250kg", "CAS")).toMatchObject({ pesoKg: 1.25, estable: true, neto: false });
    expect(parsearLinea("US,GS,   0.002kg", "CAS")).toMatchObject({ pesoKg: 0.002, estable: false });
    expect(parsearLinea("ST,NT,+  0.500 kg", "CAS")).toMatchObject({ pesoKg: 0.5, neto: true });
    expect(parsearLinea("ST,GS,+  250g", "CAS")).toMatchObject({ pesoKg: 0.25 });
    expect(parsearLinea("ST,GS,+  2.0lb", "CAS")?.pesoKg).toBeCloseTo(0.9072, 4);
    expect(parsearLinea("ST,GS,-  0.100kg", "CAS")?.pesoKg).toBe(-0.1);
    expect(parsearLinea("basura", "CAS")).toBeNull();
    expect(parsearLinea("", "CAS")).toBeNull();
  });

  it("genérico: número con unidad opcional, coma decimal y marcas de estabilidad", () => {
    expect(parsearLinea("  1.250 kg", "GENERICO")).toMatchObject({ pesoKg: 1.25, estable: null });
    expect(parsearLinea("W: 1,5 kg", "GENERICO")?.pesoKg).toBe(1.5);
    expect(parsearLinea("ST  0.456", "GENERICO")).toMatchObject({ pesoKg: 0.456, estable: true });
    expect(parsearLinea("US 0.100", "GENERICO")).toMatchObject({ pesoKg: 0.1, estable: false });
    expect(parsearLinea("M  0.100 kg", "GENERICO")).toMatchObject({ estable: false });
    expect(parsearLinea("500 g", "GENERICO")?.pesoKg).toBe(0.5);
    expect(parsearLinea("sin numeros", "GENERICO")).toBeNull();
  });
});

/** Puerto simulado: entrega los bloques indicados con su demora y registra el cierre. */
function puertoSimulado(opciones: { bloques?: Array<{ texto: string; demora: number }>; falloAlAbrir?: Error; falloDespues?: { demora: number; error: Error } } = {}) {
  const estado = { abierto: false, cierres: 0 };
  let receptor: (d: Buffer) => void = () => undefined;
  let fallo: (e: Error) => void = () => undefined;
  const puerto: PuertoSerie = {
    alRecibir: (r) => {
      receptor = r;
    },
    alFallar: (r) => {
      fallo = r;
    },
    abrir: async () => {
      if (opciones.falloAlAbrir !== undefined) throw opciones.falloAlAbrir;
      estado.abierto = true;
      for (const b of opciones.bloques ?? []) setTimeout(() => estado.abierto && receptor(Buffer.from(b.texto, "latin1")), b.demora);
      if (opciones.falloDespues !== undefined) {
        const f = opciones.falloDespues;
        setTimeout(() => fallo(f.error), f.demora);
      }
    },
    cerrar: async () => {
      estado.abierto = false;
      estado.cierres += 1;
    },
  };
  return { puerto, estado };
}

describe("Lectura de peso estable", () => {
  it("con marca de estabilidad (CAS): ignora lo inestable y responde con el primer ST, aunque la trama llegue partida", async () => {
    const { puerto, estado } = puertoSimulado({
      bloques: [
        { texto: "US,GS,   0.8", demora: 5 }, // trama partida en dos bloques
        { texto: "00kg\r\nUS,GS,   1.100kg\r\n", demora: 10 },
        { texto: "ST,GS,+  1.250kg\r\nST,GS,+  1.250kg\r\n", demora: 20 },
      ],
    });
    const l = await leerPesoEstable(puerto, { protocolo: "CAS", timeoutMs: 1_000 });
    expect(l).toMatchObject({ pesoKg: 1.25, estable: true });
    expect(estado.cierres).toBe(1);
    expect(estado.abierto).toBe(false);
  });

  it("sin marca (genérico): exige varias lecturas iguales seguidas y una variación reinicia la cuenta", async () => {
    const { puerto } = puertoSimulado({
      bloques: [
        { texto: "1.250 kg\n1.250 kg\n1.300 kg\n", demora: 5 }, // rompe la racha
        { texto: "1.300 kg\n1.300 kg\n", demora: 15 },
      ],
    });
    expect(await leerPesoEstable(puerto, { protocolo: "GENERICO", lecturasIguales: 3, timeoutMs: 1_000 })).toMatchObject({ pesoKg: 1.3 });
  });

  it("un peso que nunca se estabiliza agota el tiempo con un mensaje claro; sin datos, «no responde»", async () => {
    const inestable = puertoSimulado({ bloques: [1, 2, 3, 4, 5].map((n) => ({ texto: `${n}.${n} kg\n`, demora: n * 10 })) });
    await expect(leerPesoEstable(inestable.puerto, { protocolo: "GENERICO", timeoutMs: 200 })).rejects.toThrow(/no se estabilizó/);
    expect(inestable.estado.cierres).toBe(1);
    const muda = puertoSimulado();
    await expect(leerPesoEstable(muda.puerto, { protocolo: "GENERICO", timeoutMs: 100 })).rejects.toThrow(/no responde/);
    expect(muda.estado.cierres).toBe(1);
  });

  it("falla al abrir el puerto o se pierde la conexión a mitad: error claro y el puerto se cierra", async () => {
    const noAbre = puertoSimulado({ falloAlAbrir: new Error("Access denied") });
    await expect(leerPesoEstable(noAbre.puerto, { protocolo: "CAS", timeoutMs: 200 })).rejects.toThrow(/Access denied/);
    expect(noAbre.estado.cierres).toBe(1);
    const seCae = puertoSimulado({ falloDespues: { demora: 10, error: new Error("USB desconectado") } });
    await expect(leerPesoEstable(seCae.puerto, { protocolo: "CAS", timeoutMs: 500 })).rejects.toThrow(/Se perdió la conexión con la balanza: USB desconectado/);
    expect(seCae.estado.cierres).toBe(1);
  });
});

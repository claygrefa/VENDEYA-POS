// ============================================================
// tests/unit/server/hardware/escpos.test.ts — Comandos ESC/POS, tickets y transportes de impresora
// ============================================================
import { readFileSync } from "fs";
import net from "net";
import type { AddressInfo } from "net";
import iconv from "iconv-lite";
import { afterEach, describe, expect, it } from "vitest";
import { EscPosBuilder, columnasPara, envolver, sanearTexto } from "../../../../src/server/services/hardware/escpos.builder";
import { construirTicketArqueo, construirTicketVenta, type DatosTicketVenta } from "../../../../src/server/services/hardware/ticket.builder";
import { ImpresoraError, TransporteRed, TransporteSistema, nombreImpresoraValido } from "../../../../src/server/services/hardware/transporteImpresora";

const hex = (b: Buffer): string => b.toString("hex");
const PULSO_GAVETA = "1b7000 19fa".replace(" ", "");
const decodificar = (b: Buffer): string => iconv.decode(b, "cp858");

/** Quita los comandos de control para leer solo el texto impreso (los comandos del ticket de prueba son de longitud conocida). */
function lineasDe(b: Buffer): string[] {
  return decodificar(b).split("\n");
}

describe("Comandos ESC/POS (golden)", () => {
  it("inicializar, alinear, negrita, tamaño, avance, corte y gaveta emiten los bytes del estándar", () => {
    expect(hex(new EscPosBuilder(48).inicializar().aBuffer())).toBe("1b40" + "1b7413");
    expect(hex(new EscPosBuilder(48).alinear("izquierda").alinear("centro").alinear("derecha").aBuffer())).toBe("1b6100" + "1b6101" + "1b6102");
    expect(hex(new EscPosBuilder(48).negrita(true).negrita(false).aBuffer())).toBe("1b4501" + "1b4500");
    expect(hex(new EscPosBuilder(48).tamano(2, 2).tamano(1, 1).tamano(3, 4).aBuffer())).toBe("1d2111" + "1d2100" + "1d2123");
    expect(hex(new EscPosBuilder(48).avanzar(5).aBuffer())).toBe("1b6405");
    expect(hex(new EscPosBuilder(48).cortar().aBuffer())).toBe("1b6403" + "1d564200"); // avanza 3 líneas y corte parcial
    expect(hex(new EscPosBuilder(48).cortar(false).aBuffer())).toBe("1b6403" + "1d564100");
    expect(hex(new EscPosBuilder(48).abrirGaveta().aBuffer())).toBe(PULSO_GAVETA);
  });

  it("el QR usa la secuencia GS ( k nativa: modelo, tamaño, corrección, datos e impresión", () => {
    const b = new EscPosBuilder(48).qr("ABC", 5).aBuffer();
    expect(hex(b)).toBe(
      "1d286b0400314132" + "00" + // modelo 2
        "1d286b03003143" + "05" + // módulo 5
        "1d286b03003145" + "31" + // corrección M
        "1d286b0600315030" + "414243" + // datos (3 + 3 bytes de cabecera)
        "1d286b0300315130" // imprimir
    );
    expect(() => new EscPosBuilder(48).qr("")).toThrow(/entre 1 y 700/);
    expect(() => new EscPosBuilder(48).qr("x".repeat(701))).toThrow(/entre 1 y 700/);
  });

  it("columnas válidas según el papel y rechazo de valores absurdos", () => {
    expect(columnasPara(80)).toBe(48);
    expect(columnasPara(58)).toBe(32);
    expect(() => new EscPosBuilder(4)).toThrow(/Columnas inválidas/);
  });
});

describe("Texto: codificación, saneamiento y ajuste al ancho", () => {
  it("acentos, ñ, ¿ y € se codifican en CP858 (los bytes que espera la impresora) y vuelven íntegros", () => {
    const b = new EscPosBuilder(48).texto("áéíóú ñ Ñ ¿? €").aBuffer();
    expect(hex(b)).toBe("a082a1a2a3" + "20" + "a4" + "20" + "a5" + "20" + "a83f" + "20" + "d5");
    expect(decodificar(b)).toBe("áéíóú ñ Ñ ¿? €");
  });

  it("los caracteres de control no llegan a la impresora: ni ESC, ni GS, ni DEL, ni separadores Unicode", () => {
    const hostil = `Hola${String.fromCharCode(0x1b)}@${String.fromCharCode(0x1d)}V${String.fromCharCode(0)}${String.fromCharCode(0x7f)}${String.fromCharCode(0x2028)}${String.fromCharCode(0x200b)}fin`;
    expect(sanearTexto(hostil)).toBe("Hola@Vfin");
    const b = new EscPosBuilder(48).linea(hostil).aBuffer();
    expect(b.includes(0x1b)).toBe(false);
    expect(b.includes(0x1d)).toBe(false);
    expect(decodificar(b)).toBe("Hola@Vfin\n");
    expect(sanearTexto("a\r\nb\rc")).toBe("a\nb\nc");
  });

  it("envolver corta por palabras y parte las palabras más largas que el ancho", () => {
    expect(envolver("uno dos tres cuatro", 9)).toEqual(["uno dos", "tres", "cuatro"]);
    expect(envolver("abcdefghijkl", 5)).toEqual(["abcde", "fghij", "kl"]);
    expect(envolver("a\nb", 10)).toEqual(["a", "b"]);
    expect(envolver("", 10)).toEqual([""]);
  });

  it("columnasLR llena exactamente el ancho y recorta el texto de la izquierda si no cabe", () => {
    for (const cols of [32, 42, 48]) {
      const [linea] = lineasDe(new EscPosBuilder(cols).columnasLR("TOTAL", "$ 12.50").aBuffer());
      expect(linea).toHaveLength(cols);
      expect(linea?.startsWith("TOTAL")).toBe(true);
      expect(linea?.endsWith("$ 12.50")).toBe(true);
    }
    const [largo] = lineasDe(new EscPosBuilder(32).columnasLR("Un producto con un nombre larguísimo de verdad", "123.45").aBuffer());
    expect(largo).toHaveLength(32);
    expect(largo?.endsWith("123.45")).toBe(true);
  });
});

const datosVenta = (cambios: Partial<DatosTicketVenta> = {}): DatosTicketVenta => ({
  empresa: { razonSocial: "COMERCIAL ANDINA S.A.", nombreComercial: "ANDINA", ruc: "1790012345001", direccion: "Av. Amazonas N34-12, Quito", telefono: "022345678" },
  numero: "001-001-000000042",
  fecha: new Date("2024-05-10T20:30:00Z"),
  cajero: "María Pérez",
  cliente: { nombre: "Juan Pérez", identificacion: "1710034065" },
  lineas: [
    { descripcion: "Café \"Premium\" molido 250 g con un nombre bastante largo para el papel", cantidad: 2, precioUnitario: 10, total: 20 },
    { descripcion: "Arroz 1 kg", cantidad: 1.5, precioUnitario: 1.2, total: 1.8 },
  ],
  subtotal: 21.8,
  descuento: 0,
  iva: 3,
  propina: 0,
  total: 24.8,
  pagos: [{ formaPago: "EFECTIVO", monto: 30, cambio: 5.2 }],
  comprobante: { claveAcceso: "1005202401179001234500110010010000000011234567813", estado: "AUTORIZADO", numeroAutorizacion: null, ambiente: "1" },
  anulada: false,
  reimpresion: false,
  abrirGaveta: true,
  ...cambios,
});

describe("Ticket de venta", () => {
  it("80 mm (48 col) y 58 mm (32 col): ninguna línea de texto excede el ancho y el contenido está completo", () => {
    for (const [anchoMm, cols] of [[80, 48], [58, 32]] as const) {
      const bytes = construirTicketVenta(datosVenta(), columnasPara(anchoMm));
      expect(columnasPara(anchoMm)).toBe(cols);
      const texto = decodificar(bytes);
      for (const esperado of ["ANDINA", "RUC: 1790012345001", "Venta: 001-001-000000042", "Fecha: 10/05/2024 15:30", "Cajero: María Pérez", "Cliente: Juan Pérez", "TOTAL", "Efectivo", "Cambio", "FACTURA ELECTRONICA", "Autorizada por el SRI", "Gracias por su compra"]) {
        expect(texto, esperado).toContain(esperado);
      }
      expect(texto).toContain("1005202401179001234500110010010000000011234567813");
    }
  });

  it("cada línea del cuerpo se ajusta al ancho exacto del papel", () => {
    for (const cols of [32, 48]) {
      const bytes = construirTicketVenta(datosVenta({ comprobante: null }), cols);
      // se descartan los comandos: se queda con las líneas del cuerpo que son texto imprimible puro
      const largas = decodificar(bytes)
        .split("\n")
        .map((l) => l.replace(/[\u0000-\u001f\u007f]+[@a-zA-Z0-9!]?/g, ""))
        .filter((l) => l.length > cols);
      expect(largas, `columnas ${cols}`).toEqual([]);
    }
  });

  it("la gaveta se abre solo cuando el ticket lo indica; el QR de la clave solo con factura", () => {
    expect(hex(construirTicketVenta(datosVenta({ abrirGaveta: true }), 48))).toContain(PULSO_GAVETA);
    expect(hex(construirTicketVenta(datosVenta({ abrirGaveta: false }), 48))).not.toContain(PULSO_GAVETA);
    const sinFactura = construirTicketVenta(datosVenta({ comprobante: null }), 48);
    expect(hex(sinFactura)).not.toContain("1d286b");
    expect(hex(construirTicketVenta(datosVenta(), 48))).toContain("1d286b");
    // el pulso va al final, después del corte
    const b = hex(construirTicketVenta(datosVenta(), 48));
    expect(b.endsWith(PULSO_GAVETA)).toBe(true);
  });

  it("marca las ventas anuladas, las reimpresiones y la factura pendiente", () => {
    const anulada = decodificar(construirTicketVenta(datosVenta({ anulada: true, abrirGaveta: false }), 48));
    expect(anulada).toContain("ANULADA");
    const re = decodificar(construirTicketVenta(datosVenta({ reimpresion: true, comprobante: { claveAcceso: "1".repeat(49), estado: "PENDIENTE", numeroAutorizacion: null, ambiente: "2" } }), 48));
    expect(re).toContain("*** REIMPRESION ***");
    expect(re).toContain("Pendiente de autorizacion del SRI");
    expect(re).toContain("Ambiente: PRODUCCION");
  });

  it("un nombre de producto hostil no puede inyectar comandos en el ticket", () => {
    const hostil = `Pan${String.fromCharCode(0x1b)}p${String.fromCharCode(0)}${String.fromCharCode(0x19)}${String.fromCharCode(0xfa)}`;
    const bytes = construirTicketVenta(datosVenta({ lineas: [{ descripcion: hostil, cantidad: 1, precioUnitario: 1, total: 1 }], abrirGaveta: false, comprobante: null }), 48);
    expect(hex(bytes)).not.toContain(PULSO_GAVETA);
  });

  it("ticket de arqueo con totales, formas de pago, movimientos y diferencia", () => {
    const t = decodificar(
      construirTicketArqueo(
        {
          empresa: datosVenta().empresa,
          sucursal: "Matriz",
          cajero: "María Pérez",
          estado: "CERRADO",
          fechaApertura: new Date("2024-05-10T13:00:00Z"),
          fechaCierre: new Date("2024-05-10T23:00:00Z"),
          montoApertura: 100,
          ventas: { cantidad: 12, subtotal: 200, descuento: 5, iva: 30, total: 225 },
          anuladas: { cantidad: 1, total: 10 },
          porFormaPago: [{ formaPago: "EFECTIVO", neto: 150 }, { formaPago: "TARJETA_CREDITO", neto: 75 }],
          ingresos: 20,
          egresos: 15,
          efectivo: { esperado: 255, contado: 250, diferencia: -5 },
        },
        48
      )
    );
    for (const esperado of ["CIERRE DE CAJA", "Sucursal: Matriz", "Ventas (12)", "225.00", "Anuladas (1)", "Efectivo", "150.00", "Tarjeta crédito", "Ingresos de caja", "Efectivo esperado", "255.00", "Efectivo contado", "Diferencia", "-5.00", "Firma cajero"]) {
      expect(t, esperado).toContain(esperado);
    }
    expect(t).not.toContain("ARQUEO DE CAJA");
  });
});

describe("Transportes de impresora", () => {
  const abiertos: net.Server[] = [];
  afterEach(async () => {
    await Promise.all(abiertos.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
  });
  const servidor = async (): Promise<{ puerto: number; recibido: Promise<Buffer> }> => {
    let resolver: (b: Buffer) => void = () => undefined;
    const recibido = new Promise<Buffer>((r) => {
      resolver = r;
    });
    const s = net.createServer((socket) => {
      const trozos: Buffer[] = [];
      socket.on("data", (c) => trozos.push(c));
      socket.on("end", () => resolver(Buffer.concat(trozos)));
    });
    abiertos.push(s);
    await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
    return { puerto: (s.address() as AddressInfo).port, recibido };
  };

  it("TCP: los bytes llegan íntegros (incluidos los que parecen de control)", async () => {
    const { puerto, recibido } = await servidor();
    const datos = Buffer.from([0x1b, 0x40, 0x00, 0xff, 0x1d, 0x56, 0x42, 0x00, ...Buffer.from("ñandú")]);
    await new TransporteRed("127.0.0.1", puerto).enviar(datos);
    expect((await recibido).equals(datos)).toBe(true);
  });

  it("TCP: conexión rechazada y tiempo agotado dan un error de impresora claro", async () => {
    await expect(new TransporteRed("127.0.0.1", 1, 500).enviar(Buffer.from("x"))).rejects.toBeInstanceOf(ImpresoraError);
    await expect(new TransporteRed("127.0.0.1", 1, 500).enviar(Buffer.from("x"))).rejects.toThrow(/No se pudo imprimir en 127.0.0.1:1/);
    // 10.255.255.1 no responde: el tiempo de espera corta
    await expect(new TransporteRed("10.255.255.1", 9100, 300).enviar(Buffer.from("x"))).rejects.toThrow(/No se pudo imprimir|tiempo de espera/);
  });

  it("sistema: Windows copia el archivo a la impresora compartida y Linux/macOS usan lp en modo raw; el archivo temporal se borra", async () => {
    const llamadas: Array<{ programa: string; args: string[]; contenido: string }> = [];
    const ejecutar = async (programa: string, args: string[]): Promise<void> => {
      const archivo = (args.find((a) => a.endsWith("ticket.bin")) as string);
      llamadas.push({ programa, args, contenido: readFileSync(archivo).toString("hex") });
    };
    await new TransporteSistema("POS-80", "win32", ejecutar).enviar(Buffer.from([1, 2, 3]));
    await new TransporteSistema("POS-80", "linux", ejecutar).enviar(Buffer.from([4, 5]));
    expect(llamadas[0]).toMatchObject({ programa: "cmd.exe", contenido: "010203" });
    expect(llamadas[0]?.args.slice(0, 3)).toEqual(["/c", "copy", "/b"]);
    expect(llamadas[0]?.args[4]).toBe("\\\\localhost\\POS-80");
    expect(llamadas[1]).toMatchObject({ programa: "lp", contenido: "0405" });
    expect(llamadas[1]?.args).toEqual(["-d", "POS-80", "-o", "raw", llamadas[1]?.args[4]]);
    const archivo = llamadas[1]?.args[4] as string;
    expect(() => readFileSync(archivo)).toThrow(); // ya no existe
  });

  it("sistema: rechaza nombres de impresora peligrosos y traduce los fallos del comando", async () => {
    const nunca = async (): Promise<void> => {
      throw new Error("no debía ejecutarse");
    };
    for (const malo of ["", "-d x", "a & calc", "x\"y", "../etc", "a|b", "a;b"]) {
      expect(nombreImpresoraValido(malo), malo).toBe(false);
      await expect(new TransporteSistema(malo, "linux", nunca).enviar(Buffer.from("x"))).rejects.toThrow(/nombre de la impresora no es válido/);
    }
    expect(nombreImpresoraValido("EPSON TM-T20II (USB)")).toBe(true);
    expect(nombreImpresoraValido("Impresora Ñandú")).toBe(true);
    const falla = async (): Promise<void> => {
      throw new Error("lp: destino desconocido");
    };
    await expect(new TransporteSistema("POS", "linux", falla).enviar(Buffer.from("x"))).rejects.toThrow(/No se pudo imprimir en "POS": lp: destino desconocido/);
  });
});

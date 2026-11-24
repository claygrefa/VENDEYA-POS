// ============================================================
// src/server/services/hardware/escpos.builder.ts — Constructor de comandos ESC/POS
//
// Genera los bytes que entienden las impresoras térmicas de tickets (Epson TM, Bixolon, Star en modo ESC/POS, genéricas
// de 58 y 80 mm). Es una función pura: no toca ningún dispositivo. El texto se codifica en CP858 (acentos, ñ y €) y se
// limpia de caracteres de control para que el contenido de un producto o cliente nunca inyecte comandos en la impresora.
// ============================================================
import iconv from "iconv-lite";

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

/** Página de códigos que se selecciona en la impresora (ESC t n): 19 = PC858 «Euro» (latín con acentos). */
const PAGINA_CODIGOS = 19;
const CODIFICACION = "cp858";

export type Alineacion = "izquierda" | "centro" | "derecha";

/** Columnas de texto (fuente A) según el ancho del papel. */
export function columnasPara(anchoMm: 58 | 80): number {
  return anchoMm === 58 ? 32 : 48;
}

/** ¿Es un carácter que no debe llegar a la impresora? (control, formato invisible o separadores de línea Unicode) */
function esCaracterProhibido(codigo: number): boolean {
  if (codigo === 10) return false; // salto de línea: se conserva
  if (codigo < 32 || codigo === 127) return true; // C0 y DEL (incluye ESC y GS)
  if (codigo >= 0x80 && codigo <= 0x9f) return true; // C1
  if (codigo >= 0x200b && codigo <= 0x200f) return true; // espacios de ancho cero y marcas de dirección
  return codigo === 0x2028 || codigo === 0x2029 || codigo === 0xfeff;
}

/** Quita los caracteres de control (salvo el salto de línea, que se normaliza) y los que no se pueden imprimir. */
export function sanearTexto(texto: string): string {
  const CR = String.fromCharCode(13);
  const LF_ = String.fromCharCode(10);
  const normal = texto.split(CR + LF_).join(LF_).split(CR).join(LF_);
  let salida = "";
  for (const c of normal) if (!esCaracterProhibido(c.codePointAt(0) ?? 0)) salida += c;
  return salida;
}

/**
 * Divide el texto en líneas de como máximo `ancho` caracteres, cortando por palabras (y por caracteres si no caben).
 * Una línea que ya cabe se respeta tal cual (con sus espacios de sangría o de relleno).
 */
export function envolver(texto: string, ancho: number): string[] {
  const salida: string[] = [];
  for (const parrafo of sanearTexto(texto).split("\n")) {
    if (parrafo.length <= ancho) {
      salida.push(parrafo);
      continue;
    }
    let actual = "";
    for (const palabra of parrafo.split(/\s+/).filter((p) => p !== "")) {
      let resto = palabra;
      while (resto.length > ancho) {
        if (actual !== "") {
          salida.push(actual);
          actual = "";
        }
        salida.push(resto.slice(0, ancho));
        resto = resto.slice(ancho);
      }
      if (actual === "") actual = resto;
      else if (actual.length + 1 + resto.length <= ancho) actual += ` ${resto}`;
      else {
        salida.push(actual);
        actual = resto;
      }
    }
    salida.push(actual);
  }
  return salida;
}

export class EscPosBuilder {
  private readonly partes: Buffer[] = [];

  constructor(readonly columnas: number) {
    if (!Number.isInteger(columnas) || columnas < 16 || columnas > 64) throw new Error(`Columnas inválidas: ${columnas}`);
  }

  private bytes(...b: number[]): this {
    this.partes.push(Buffer.from(b));
    return this;
  }

  /** ESC @ y selección de la página de códigos. Va al inicio de todo documento. */
  inicializar(): this {
    return this.bytes(ESC, 0x40, ESC, 0x74, PAGINA_CODIGOS);
  }

  alinear(a: Alineacion): this {
    return this.bytes(ESC, 0x61, a === "izquierda" ? 0 : a === "centro" ? 1 : 2);
  }

  negrita(activa: boolean): this {
    return this.bytes(ESC, 0x45, activa ? 1 : 0);
  }

  /** Tamaño del carácter: 1 a 4 veces en ancho y alto (GS !). */
  tamano(ancho: 1 | 2 | 3 | 4 = 1, alto: 1 | 2 | 3 | 4 = 1): this {
    return this.bytes(GS, 0x21, ((ancho - 1) << 4) | (alto - 1));
  }

  /** Texto sin salto de línea. */
  texto(t: string): this {
    this.partes.push(iconv.encode(sanearTexto(t).replace(/\n/g, ""), CODIFICACION));
    return this;
  }

  /** Una línea (con salto). Si no cabe en el ancho se corta por palabras. */
  linea(t = ""): this {
    const ancho = this.columnas;
    for (const l of envolver(t, ancho)) {
      this.texto(l);
      this.bytes(LF);
    }
    return this;
  }

  separador(caracter = "-"): this {
    return this.linea(caracter.repeat(this.columnas));
  }

  /** `izquierda` pegado a la izquierda y `derecha` a la derecha de la misma línea (el texto largo de la izquierda se recorta). */
  columnasLR(izquierda: string, derecha: string): this {
    const der = sanearTexto(derecha).replace(/\n/g, " ");
    const maxIzq = Math.max(this.columnas - der.length - 1, 1);
    let izq = sanearTexto(izquierda).replace(/\n/g, " ");
    if (izq.length > maxIzq) izq = izq.slice(0, maxIzq);
    return this.linea(`${izq}${" ".repeat(Math.max(this.columnas - izq.length - der.length, 1))}${der}`);
  }

  /** Avanza `n` líneas de papel (ESC d n). */
  avanzar(n: number): this {
    return this.bytes(ESC, 0x64, Math.max(0, Math.min(255, Math.floor(n))));
  }

  /** Código QR nativo (GS ( k): modelo 2, corrección de errores M. `modulo` 1–16 (tamaño del punto). */
  qr(contenido: string, modulo = 6): this {
    const datos = Buffer.from(sanearTexto(contenido), "utf8");
    if (datos.length === 0 || datos.length > 700) throw new Error("El contenido del QR debe tener entre 1 y 700 bytes");
    const m = Math.max(1, Math.min(16, Math.floor(modulo)));
    const largo = datos.length + 3;
    this.bytes(GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00); // modelo 2
    this.bytes(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, m); // tamaño del módulo
    this.bytes(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31); // corrección M
    this.bytes(GS, 0x28, 0x6b, largo & 0xff, (largo >> 8) & 0xff, 0x31, 0x50, 0x30);
    this.partes.push(datos);
    return this.bytes(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30); // imprimir
  }

  /** Corte del papel (parcial por defecto) tras avanzar unas líneas. */
  cortar(parcial = true): this {
    return this.avanzar(3).bytes(GS, 0x56, parcial ? 0x42 : 0x41, 0x00);
  }

  /** Pulso para abrir la gaveta conectada a la impresora (ESC p): pin 2, 50 ms encendido, 500 ms apagado. */
  abrirGaveta(): this {
    return this.bytes(ESC, 0x70, 0x00, 0x19, 0xfa);
  }

  aBuffer(): Buffer {
    return Buffer.concat(this.partes);
  }
}

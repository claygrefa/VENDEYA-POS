// ============================================================
// src/server/services/hardware/codigoBarras.util.ts — Códigos de barras: dígito verificador y etiquetas de balanza
//
// Etiqueta de balanza (EAN-13 con prefijo 2, el formato habitual de las balanzas con impresora de etiquetas):
//     2 PPPPPP VVVVV C      P = código del producto (PLU, 6 dígitos) · V = valor (5 dígitos) · C = dígito verificador
// El valor lleva el PESO en gramos (p. ej. 01250 = 1,250 kg) o el PRECIO en centavos, según cómo esté configurada la balanza.
// ============================================================

/** Dígito verificador GS1 (EAN-8/13, UPC-A, GTIN-14) de los dígitos SIN el verificador. */
export function digitoVerificadorGs1(sinVerificador: string): number {
  if (!/^\d+$/.test(sinVerificador)) throw new Error("El código debe tener solo dígitos");
  let suma = 0;
  // De derecha a izquierda: los pesos alternan 3, 1, 3, 1…
  for (let i = 0; i < sinVerificador.length; i++) {
    const digito = Number(sinVerificador[sinVerificador.length - 1 - i]);
    suma += digito * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (suma % 10)) % 10;
}

/** ¿Es un EAN-8, UPC-A, EAN-13 o GTIN-14 con dígito verificador correcto? */
export function esGtinValido(codigo: string): boolean {
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(codigo)) return false;
  return digitoVerificadorGs1(codigo.slice(0, -1)) === Number(codigo.slice(-1));
}

export type TipoEtiquetaBalanza = "PESO" | "PRECIO";

export interface EtiquetaBalanza {
  /** Código del producto en la balanza (6 dígitos, tal como viene) */
  plu: string;
  tipo: TipoEtiquetaBalanza;
  /** PESO: kilogramos · PRECIO: dólares */
  valor: number;
}

/** Interpreta una etiqueta de balanza; `null` si no lo es (no empieza con 2, no mide 13 o el verificador no coincide). */
export function leerEtiquetaBalanza(codigo: string, tipo: TipoEtiquetaBalanza): EtiquetaBalanza | null {
  if (!/^2\d{12}$/.test(codigo) || !esGtinValido(codigo)) return null;
  const plu = codigo.slice(1, 7);
  const bruto = Number(codigo.slice(7, 12));
  return { plu, tipo, valor: tipo === "PESO" ? bruto / 1000 : bruto / 100 };
}

/** Arma una etiqueta de balanza con su dígito verificador (para pruebas y para imprimir etiquetas de prueba). */
export function armarEtiquetaBalanza(plu: string, valor: number, tipo: TipoEtiquetaBalanza): string {
  if (!/^\d{1,6}$/.test(plu)) throw new Error("El PLU debe tener hasta 6 dígitos");
  const unidades = Math.round(tipo === "PESO" ? valor * 1000 : valor * 100);
  if (!Number.isInteger(unidades) || unidades < 0 || unidades > 99_999) throw new Error("El valor no cabe en 5 dígitos");
  const sin = `2${plu.padStart(6, "0")}${String(unidades).padStart(5, "0")}`;
  return `${sin}${digitoVerificadorGs1(sin)}`;
}

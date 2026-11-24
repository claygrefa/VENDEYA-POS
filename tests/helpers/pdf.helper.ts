// ============================================================
// tests/helpers/pdf.helper.ts — Lectura del texto de un PDF generado SIN compresión (pdfkit, fuentes estándar)
// ============================================================

/** Texto de todas las operaciones `[<hex>…] TJ` del PDF (WinAnsi ≈ latin1), una línea por operación. */
export function textoDePdf(pdf: Buffer): string {
  const contenido = pdf.toString("latin1");
  const lineas: string[] = [];
  for (const m of contenido.matchAll(/\[((?:<[0-9a-fA-F]*>|\s|-?[\d.]+)+)\]\s*TJ/g)) {
    const grupo = m[1] ?? "";
    let linea = "";
    for (const h of grupo.matchAll(/<([0-9a-fA-F]*)>/g)) linea += Buffer.from(h[1] ?? "", "hex").toString("latin1");
    lineas.push(linea);
  }
  return lineas.join("\n");
}

/** Cantidad de páginas del PDF. */
export function paginasDePdf(pdf: Buffer): number {
  return (pdf.toString("latin1").match(/\/Type \/Page\b(?!s)/g) ?? []).length;
}

/** Igual que `textoDePdf` pero sin saltos entre operaciones: sirve para frases que pdfkit parte en varios fragmentos. */
export function textoPlanoDePdf(pdf: Buffer): string {
  return textoDePdf(pdf).split("\n").join("");
}

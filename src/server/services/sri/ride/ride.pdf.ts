// ============================================================
// src/server/services/sri/ride/ride.pdf.ts — RIDE en PDF (A4) con pdfkit
//
// PDF puro en JavaScript (sin módulos nativos). El código de barras de la clave de acceso es Code 128 dibujado con
// rectángulos a partir de `bwip-js` (solo calcula las barras). Fuentes estándar de PDF: no se incrusta ninguna.
// ============================================================
import bwipjs from "bwip-js";
import PDFDocument from "pdfkit";
import type { DatosRide, TablaRide } from "./ride.datos";

const MARGEN = 36;
const ANCHO = 595.28 - 2 * MARGEN;
const ALTO_PAGINA = 841.89;
const LIMITE_Y = ALTO_PAGINA - MARGEN - 20;
const GRIS = "#555555";
const LINEA = "#999999";

export interface OpcionesRidePdf {
  /** Comprimir los flujos del PDF (default true; las pruebas lo desactivan para poder leer el texto) */
  comprimir?: boolean;
}

/** Anchos de barras y espacios alternados (empezando por una barra) del Code 128 de `texto`. */
export function barrasCode128(texto: string): number[] {
  const r = bwipjs.raw("code128", texto, {}) as Array<{ sbs: number[] }>;
  const sbs = r[0]?.sbs;
  if (sbs === undefined || sbs.length === 0) throw new Error("No se pudo codificar el código de barras");
  return sbs;
}

function dibujarCodigoBarras(doc: PDFKit.PDFDocument, texto: string, x: number, y: number, ancho: number, alto: number): void {
  const sbs = barrasCode128(texto);
  const modulos = sbs.reduce((a, b) => a + b, 0);
  const escala = ancho / modulos;
  let cursor = x;
  sbs.forEach((w, i) => {
    if (i % 2 === 0) doc.rect(cursor, y, w * escala, alto).fill("#000000");
    cursor += w * escala;
  });
}

function caja(doc: PDFKit.PDFDocument, x: number, y: number, w: number, h: number): void {
  doc.lineWidth(0.7).strokeColor(LINEA).roundedRect(x, y, w, h, 4).stroke();
}

/** Escribe pares «Etiqueta: valor» y devuelve la `y` final. */
function lineas(doc: PDFKit.PDFDocument, x: number, y: number, w: number, filas: Array<[string, string]>, tam = 8): number {
  let cursor = y;
  for (const [etiqueta, valor] of filas) {
    if (valor === "") continue;
    doc.font("Helvetica-Bold").fontSize(tam);
    const texto = etiqueta === "" ? valor : `${etiqueta}: `;
    if (etiqueta === "") {
      doc.font("Helvetica").text(valor, x, cursor, { width: w });
    } else {
      doc.text(texto, x, cursor, { width: w, continued: true }).font("Helvetica").text(valor);
    }
    cursor = doc.y + 1.5;
  }
  return cursor;
}

function altoLineas(doc: PDFKit.PDFDocument, w: number, filas: Array<[string, string]>, tam = 8): number {
  let alto = 0;
  for (const [etiqueta, valor] of filas) {
    if (valor === "") continue;
    doc.font("Helvetica").fontSize(tam);
    alto += doc.heightOfString(etiqueta === "" ? valor : `${etiqueta}: ${valor}`, { width: w }) + 1.5;
  }
  return alto;
}

function encabezado(doc: PDFKit.PDFDocument, d: DatosRide): number {
  const anchoIzq = ANCHO * 0.47;
  const x2 = MARGEN + anchoIzq + 10;
  const anchoDer = ANCHO - anchoIzq - 10;
  const y0 = MARGEN;

  const filasEmisor: Array<[string, string]> = [
    ["", d.emisor.nombreComercial !== "" && d.emisor.nombreComercial !== d.emisor.razonSocial ? d.emisor.nombreComercial : ""],
    ["Dir. Matriz", d.emisor.dirMatriz],
    ["Dir. Sucursal", d.emisor.dirEstablecimiento],
    ["Contribuyente Especial Nro", d.emisor.contribuyenteEspecial ?? ""],
    ["OBLIGADO A LLEVAR CONTABILIDAD", d.emisor.obligadoContabilidad],
    ["Agente de Retención Resolución", d.emisor.agenteRetencion ?? ""],
    ["", d.emisor.rimpe ?? ""],
  ];
  const interior = anchoIzq - 16;
  doc.font("Helvetica-Bold").fontSize(11);
  const altoRazon = doc.heightOfString(d.emisor.razonSocial, { width: interior });
  const altoIzq = altoRazon + 8 + altoLineas(doc, interior, filasEmisor) + 16;

  const filasDoc: Array<[string, string]> = [
    ["NÚMERO DE AUTORIZACIÓN", ""],
    ["", d.numeroAutorizacion ?? "NO AUTORIZADO"],
    ["FECHA Y HORA DE AUTORIZACIÓN", d.fechaAutorizacion ?? "—"],
    ["AMBIENTE", d.ambiente],
    ["EMISIÓN", "NORMAL"],
  ];
  const interiorDer = anchoDer - 16;
  const altoDer = 14 + 16 + 12 + altoLineas(doc, interiorDer, filasDoc) + 10 + 38 + 12 + 18;
  const alto = Math.max(altoIzq, altoDer);

  caja(doc, MARGEN, y0, anchoIzq, alto);
  caja(doc, x2, y0, anchoDer, alto);

  doc.fillColor("#000000").font("Helvetica-Bold").fontSize(11).text(d.emisor.razonSocial, MARGEN + 8, y0 + 8, { width: interior });
  lineas(doc, MARGEN + 8, doc.y + 6, interior, filasEmisor);

  let y = y0 + 8;
  doc.font("Helvetica-Bold").fontSize(10).text(`R.U.C.: ${d.emisor.ruc}`, x2 + 8, y, { width: interiorDer });
  y = doc.y + 3;
  doc.fontSize(11).text(d.titulo, x2 + 8, y, { width: interiorDer });
  y = doc.y + 3;
  doc.fontSize(9).text(`No. ${d.numero}`, x2 + 8, y, { width: interiorDer });
  y = doc.y + 4;
  y = lineas(doc, x2 + 8, y, interiorDer, filasDoc);
  doc.font("Helvetica-Bold").fontSize(8).text("CLAVE DE ACCESO", x2 + 8, y + 2, { width: interiorDer });
  y = doc.y + 2;
  dibujarCodigoBarras(doc, d.claveAcceso, x2 + 8, y, interiorDer, 30);
  doc.font("Helvetica").fontSize(7).text(d.claveAcceso, x2 + 8, y + 32, { width: interiorDer, align: "center", characterSpacing: 0.4 });
  return y0 + alto + 8;
}

function bloqueReceptor(doc: PDFKit.PDFDocument, d: DatosRide, y: number): number {
  const filas: Array<[string, string]> = [
    [`Razón Social / Nombres y Apellidos (${d.receptor.etiqueta})`, d.receptor.razonSocial],
    ["Identificación", d.receptor.identificacion],
    ["Fecha de Emisión", d.fechaEmision],
    ["Dirección", d.receptor.direccion ?? ""],
    ...d.extras,
  ];
  const interior = ANCHO - 16;
  const alto = altoLineas(doc, interior, filas) + 12;
  caja(doc, MARGEN, y, ANCHO, alto);
  doc.fillColor("#000000");
  lineas(doc, MARGEN + 8, y + 6, interior, filas);
  return y + alto + 8;
}

function tabla(doc: PDFKit.PDFDocument, t: TablaRide, yInicial: number, pie: (pagina: number) => void): number {
  const suma = t.columnas.reduce((a, c) => a + c.ancho, 0);
  const anchos = t.columnas.map((c) => (c.ancho / suma) * ANCHO);
  let y = yInicial;
  if (t.titulo !== undefined) {
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#000000").text(t.titulo, MARGEN, y, { width: ANCHO });
    y = doc.y + 3;
  }

  const cabecera = (): void => {
    doc.rect(MARGEN, y, ANCHO, 16).fill("#e8e8e8");
    doc.fillColor("#000000").font("Helvetica-Bold").fontSize(7.5);
    let x = MARGEN;
    t.columnas.forEach((c, i) => {
      doc.text(c.titulo, x + 3, y + 4, { width: (anchos[i] ?? 0) - 6, align: c.alineacion === "izquierda" ? "left" : c.alineacion === "derecha" ? "right" : "center", lineBreak: false });
      x += anchos[i] ?? 0;
    });
    y += 18;
  };
  cabecera();

  doc.font("Helvetica").fontSize(7.5);
  for (const fila of t.filas) {
    const altos = fila.map((celda, i) => doc.heightOfString(celda, { width: (anchos[i] ?? 0) - 6 }));
    const alto = Math.max(...altos, 9) + 4;
    if (y + alto > LIMITE_Y) {
      pie(doc.bufferedPageRange().count);
      doc.addPage();
      y = MARGEN;
      cabecera();
      doc.font("Helvetica").fontSize(7.5);
    }
    let x = MARGEN;
    fila.forEach((celda, i) => {
      const c = t.columnas[i];
      doc.fillColor("#000000").text(celda, x + 3, y + 2, { width: (anchos[i] ?? 0) - 6, align: c?.alineacion === "derecha" ? "right" : c?.alineacion === "centro" ? "center" : "left" });
      x += anchos[i] ?? 0;
    });
    y += alto;
    doc.moveTo(MARGEN, y).lineTo(MARGEN + ANCHO, y).lineWidth(0.3).strokeColor("#cccccc").stroke();
  }
  return y + 8;
}

function marcaDeAgua(doc: PDFKit.PDFDocument): void {
  doc.save();
  doc.rotate(-40, { origin: [297, 420] });
  doc.fillColor("#b00020").fillOpacity(0.1).font("Helvetica-Bold").fontSize(54);
  doc.text("SIN VALOR TRIBUTARIO", 20, 380, { width: 560, align: "center", lineBreak: false });
  doc.fontSize(24).text("NO AUTORIZADO POR EL SRI", 20, 450, { width: 560, align: "center", lineBreak: false });
  doc.restore();
  doc.fillOpacity(1);
}

/** Genera el PDF del RIDE. */
export function generarRidePdf(d: DatosRide, opciones: OpcionesRidePdf = {}): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: MARGEN,
      compress: opciones.comprimir ?? true,
      bufferPages: true,
      info: { Title: `${d.titulo} ${d.numero}`, Author: d.emisor.razonSocial, Subject: `Clave de acceso ${d.claveAcceso}` },
    });
    const trozos: Buffer[] = [];
    doc.on("data", (c: Buffer) => trozos.push(c));
    doc.on("end", () => resolve(Buffer.concat(trozos)));
    doc.on("error", reject);

    try {
      let y = encabezado(doc, d);
      y = bloqueReceptor(doc, d, y);
      for (const t of d.tablas) y = tabla(doc, t, y, () => undefined);

      // Totales, formas de pago e información adicional (si no caben se pasan a una página nueva)
      const anchoCol = (ANCHO - 12) / 2;
      const filasTot = d.totales;
      const altoTot = filasTot.length * 13 + 8;
      const altoPagos = d.pagos.length === 0 ? 0 : altoLineas(doc, anchoCol - 16, d.pagos.map(([a, b]) => [a, b] as [string, string])) + 22;
      const altoInfo = d.infoAdicional.length === 0 ? 0 : altoLineas(doc, anchoCol - 16, d.infoAdicional) + 22;
      const altoIzq = altoPagos + (altoPagos > 0 && altoInfo > 0 ? 8 : 0) + altoInfo;
      if (y + Math.max(altoTot, altoIzq) > LIMITE_Y) {
        doc.addPage();
        y = MARGEN;
      }
      const xDer = MARGEN + anchoCol + 12;
      let yTot = y;
      doc.fillColor("#000000");
      for (const [etiqueta, valor] of filasTot) {
        const fuerte = etiqueta === "VALOR TOTAL" || etiqueta === "TOTAL RETENIDO";
        doc.font(fuerte ? "Helvetica-Bold" : "Helvetica").fontSize(fuerte ? 9 : 8);
        doc.text(etiqueta, xDer + 4, yTot + 2, { width: anchoCol * 0.62, lineBreak: false });
        doc.text(valor, xDer + anchoCol * 0.62, yTot + 2, { width: anchoCol * 0.38 - 6, align: "right", lineBreak: false });
        yTot += 13;
        doc.moveTo(xDer, yTot).lineTo(xDer + anchoCol, yTot).lineWidth(0.3).strokeColor("#cccccc").stroke();
      }

      let yIzq = y;
      const bloque = (titulo: string, filas: Array<[string, string]>): void => {
        const alto = altoLineas(doc, anchoCol - 16, filas) + 22;
        caja(doc, MARGEN, yIzq, anchoCol, alto);
        doc.fillColor("#000000").font("Helvetica-Bold").fontSize(8).text(titulo, MARGEN + 8, yIzq + 6, { width: anchoCol - 16 });
        lineas(doc, MARGEN + 8, yIzq + 18, anchoCol - 16, filas);
        yIzq += alto + 8;
      };
      if (d.pagos.length > 0) bloque("Formas de pago", d.pagos);
      if (d.infoAdicional.length > 0) bloque("Información adicional", d.infoAdicional);

      // Marca de agua y pie en todas las páginas
      const paginas = doc.bufferedPageRange();
      for (let i = paginas.start; i < paginas.start + paginas.count; i++) {
        doc.switchToPage(i);
        if (!d.autorizado) marcaDeAgua(doc);
        doc.fillColor(GRIS).font("Helvetica").fontSize(7);
        doc.text(`Página ${i - paginas.start + 1} de ${paginas.count}${d.autorizado ? "" : " · Documento sin autorización del SRI: no tiene valor tributario"}`, MARGEN, ALTO_PAGINA - MARGEN - 16, { width: ANCHO, align: "center", lineBreak: false });
      }
      doc.end();
    } catch (e) {
      doc.end();
      reject(e);
    }
  });
}

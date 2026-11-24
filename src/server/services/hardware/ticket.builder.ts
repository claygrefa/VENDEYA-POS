// ============================================================
// src/server/services/hardware/ticket.builder.ts — Tickets térmicos: venta y arqueo de caja
// ============================================================
import { round2 } from "../ventaCalculo.util";
import { EscPosBuilder } from "./escpos.builder";

export interface DatosTicketVenta {
  empresa: { razonSocial: string; nombreComercial: string; ruc: string; direccion: string; telefono: string };
  numero: string;
  fecha: Date;
  cajero: string;
  cliente: { nombre: string; identificacion: string } | null;
  lineas: Array<{ descripcion: string; cantidad: number; precioUnitario: number; total: number }>;
  subtotal: number;
  descuento: number;
  iva: number;
  propina: number;
  total: number;
  pagos: Array<{ formaPago: string; monto: number; cambio: number }>;
  /** Factura electrónica de la venta (si se emitió) */
  comprobante: { claveAcceso: string; estado: string; numeroAutorizacion: string | null; ambiente: string } | null;
  anulada: boolean;
  reimpresion: boolean;
  /** Abrir la gaveta junto con este ticket */
  abrirGaveta: boolean;
}

const ETIQUETA_PAGO: Record<string, string> = {
  EFECTIVO: "Efectivo",
  TARJETA_CREDITO: "Tarjeta crédito",
  TARJETA_DEBITO: "Tarjeta débito",
  TRANSFERENCIA: "Transferencia",
  CHEQUE: "Cheque",
  CREDITO: "Crédito",
};

const dinero = (n: number): string => round2(n).toFixed(2);
const cantidad = (n: number): string => (Number.isInteger(n) ? String(n) : String(round2(n)));
export const etiquetaPago = (f: string): string => ETIQUETA_PAGO[f] ?? f;

/** Fecha y hora de Ecuador (UTC−5) como `dd/MM/yyyy HH:mm`. */
export function fechaHoraTicket(f: Date): string {
  const l = new Date(f.getTime() - 5 * 3_600_000);
  const d = (n: number): string => String(n).padStart(2, "0");
  return `${d(l.getUTCDate())}/${d(l.getUTCMonth() + 1)}/${l.getUTCFullYear()} ${d(l.getUTCHours())}:${d(l.getUTCMinutes())}`;
}

function encabezado(b: EscPosBuilder, e: DatosTicketVenta["empresa"]): void {
  b.alinear("centro").negrita(true).tamano(1, 2).linea(e.nombreComercial || e.razonSocial).tamano(1, 1).negrita(false);
  if (e.nombreComercial !== "" && e.nombreComercial !== e.razonSocial) b.linea(e.razonSocial);
  b.linea(`RUC: ${e.ruc}`).linea(e.direccion);
  if (e.telefono !== "") b.linea(`Tel: ${e.telefono}`);
  b.alinear("izquierda");
}

/** Ticket de venta. Si hay factura electrónica incluye su clave de acceso (texto y QR). */
export function construirTicketVenta(d: DatosTicketVenta, columnas: number): Buffer {
  const b = new EscPosBuilder(columnas).inicializar();
  encabezado(b, d.empresa);
  b.separador("=");
  if (d.anulada) b.alinear("centro").negrita(true).tamano(2, 2).linea("ANULADA").tamano(1, 1).negrita(false).alinear("izquierda");
  b.linea(`Venta: ${d.numero}`).linea(`Fecha: ${fechaHoraTicket(d.fecha)}`).linea(`Cajero: ${d.cajero}`);
  if (d.cliente !== null) b.linea(`Cliente: ${d.cliente.nombre}`).linea(`C.I./RUC: ${d.cliente.identificacion}`);
  b.separador();

  for (const l of d.lineas) {
    b.linea(l.descripcion);
    b.columnasLR(`  ${cantidad(l.cantidad)} x ${dinero(l.precioUnitario)}`, dinero(l.total));
  }
  b.separador();
  b.columnasLR("Subtotal", dinero(d.subtotal));
  if (d.descuento > 0) b.columnasLR("Descuento", `-${dinero(d.descuento)}`);
  b.columnasLR("IVA", dinero(d.iva));
  if (d.propina > 0) b.columnasLR("Propina", dinero(d.propina));
  b.negrita(true).tamano(1, 2).columnasLR("TOTAL", `$ ${dinero(d.total + d.propina)}`).tamano(1, 1).negrita(false);
  b.separador();
  for (const p of d.pagos) {
    b.columnasLR(etiquetaPago(p.formaPago), dinero(p.monto));
    if (p.cambio > 0) b.columnasLR("  Cambio", dinero(p.cambio));
  }

  if (d.comprobante !== null) {
    b.separador();
    b.alinear("centro").negrita(true).linea("FACTURA ELECTRONICA").negrita(false);
    b.linea(`Ambiente: ${d.comprobante.ambiente === "2" ? "PRODUCCION" : "PRUEBAS"}`);
    b.linea(d.comprobante.estado === "AUTORIZADO" ? "Autorizada por el SRI" : "Pendiente de autorizacion del SRI");
    b.alinear("izquierda").linea("Clave de acceso:").linea(d.comprobante.claveAcceso);
    b.alinear("centro").qr(d.comprobante.claveAcceso, columnas >= 48 ? 5 : 4).alinear("izquierda");
  }

  b.separador();
  b.alinear("centro");
  if (d.reimpresion) b.negrita(true).linea("*** REIMPRESION ***").negrita(false);
  b.linea("Gracias por su compra").alinear("izquierda").cortar();
  if (d.abrirGaveta) b.abrirGaveta();
  return b.aBuffer();
}

export interface DatosTicketArqueo {
  empresa: { razonSocial: string; nombreComercial: string; ruc: string; direccion: string; telefono: string };
  sucursal: string;
  cajero: string;
  estado: string;
  fechaApertura: Date;
  fechaCierre: Date | null;
  montoApertura: number;
  ventas: { cantidad: number; subtotal: number; descuento: number; iva: number; total: number };
  anuladas: { cantidad: number; total: number };
  porFormaPago: Array<{ formaPago: string; neto: number }>;
  ingresos: number;
  egresos: number;
  efectivo: { esperado: number; contado: number | null; diferencia: number | null } | null;
}

/** Ticket de arqueo / cierre de caja. */
export function construirTicketArqueo(d: DatosTicketArqueo, columnas: number): Buffer {
  const b = new EscPosBuilder(columnas).inicializar();
  encabezado(b, d.empresa);
  b.separador("=");
  b.alinear("centro").negrita(true).linea(d.estado === "CERRADO" ? "CIERRE DE CAJA" : "ARQUEO DE CAJA").negrita(false).alinear("izquierda");
  b.linea(`Sucursal: ${d.sucursal}`).linea(`Cajero: ${d.cajero}`).linea(`Apertura: ${fechaHoraTicket(d.fechaApertura)}`);
  if (d.fechaCierre !== null) b.linea(`Cierre: ${fechaHoraTicket(d.fechaCierre)}`);
  b.separador();
  b.columnasLR("Monto de apertura", dinero(d.montoApertura));
  b.columnasLR(`Ventas (${d.ventas.cantidad})`, dinero(d.ventas.total));
  b.columnasLR("  Subtotal", dinero(d.ventas.subtotal));
  b.columnasLR("  Descuentos", dinero(d.ventas.descuento));
  b.columnasLR("  IVA", dinero(d.ventas.iva));
  if (d.anuladas.cantidad > 0) b.columnasLR(`Anuladas (${d.anuladas.cantidad})`, dinero(d.anuladas.total));
  b.separador();
  b.negrita(true).linea("Cobros por forma de pago").negrita(false);
  for (const f of d.porFormaPago) b.columnasLR(`  ${etiquetaPago(f.formaPago)}`, dinero(f.neto));
  b.separador();
  b.columnasLR("Ingresos de caja", dinero(d.ingresos));
  b.columnasLR("Egresos de caja", dinero(d.egresos));
  if (d.efectivo !== null) {
    b.separador();
    b.columnasLR("Efectivo esperado", dinero(d.efectivo.esperado));
    if (d.efectivo.contado !== null) b.columnasLR("Efectivo contado", dinero(d.efectivo.contado));
    if (d.efectivo.diferencia !== null) b.negrita(true).columnasLR("Diferencia", dinero(d.efectivo.diferencia)).negrita(false);
  }
  b.separador().linea().linea("Firma cajero: ______________").cortar();
  return b.aBuffer();
}

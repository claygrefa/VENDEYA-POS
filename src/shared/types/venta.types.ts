// ============================================================
// src/shared/types/venta.types.ts — Venta, Línea de Venta, Pago
// ============================================================

import type { UUID, AuditTimestamps, Money } from "./common.types";

export type EstadoVenta = "BORRADOR" | "COMPLETADA" | "ANULADA";
export type FormaPago   = "EFECTIVO" | "TARJETA_CREDITO" | "TARJETA_DEBITO" | "TRANSFERENCIA" | "CHEQUE" | "CREDITO" | "OTRO";
export type TipoDescuento = "PORCENTAJE" | "VALOR";

export interface LineaVenta {
  id:              UUID;
  ventaId:         UUID;
  productoId:      UUID;
  loteId?:         UUID | null;
  descripcion:     string;
  cantidad:        number;
  precioUnitario:  Money;
  descuento:       Money;
  tipoDescuento:   TipoDescuento;
  subtotal:        Money;
  iva:             Money;        // valor calculado
  porcentajeIva:   number;      // 0, 5, 12, 15
  total:           Money;
  costoUnitario:   Money;       // para kardex
}

export interface PagoVenta {
  id:            UUID;
  ventaId:       UUID;
  formaPago:     FormaPago;
  monto:         Money;
  referencia?:   string | null; // nº transacción, cheque, etc.
  cambio:        Money;
}

export interface Venta extends AuditTimestamps {
  id:               UUID;
  numero:           string;        // secuencial visible: "000-001-000000001"
  sucursalId:       UUID;
  puntoEmisionId:   UUID;
  turnoId:          UUID;
  cajeroId:         UUID;         // userId
  clienteId?:       UUID | null;
  clienteRuc?:      string | null;
  clienteNombre?:   string | null;
  estado:           EstadoVenta;
  subtotal:         Money;
  descuento:        Money;
  iva:              Money;
  total:            Money;
  pagos:            PagoVenta[];
  lineas:           LineaVenta[];
  motivoAnulacion?: string | null;
  comprobanteId?:   UUID | null;  // FK a ComprobanteElectronico (Semana 9)
  observaciones?:   string | null;
}

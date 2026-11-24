// ============================================================
// src/renderer/services/tipos.ts — Forma de los datos que devuelve la API (lo que usa la pantalla del POS)
// ============================================================

export interface UsuarioSesion {
  id: string;
  empresaId: string;
  username: string;
  nombre: string;
  apellido: string;
  rol: string;
  permisos: string[];
}

export interface ProductoPos {
  id: string;
  codigo: string;
  codigoBarras: string | null;
  nombre: string;
  tipo: string;
  precioVenta: number;
  stockActual: number;
  aplicaIva: boolean;
  codigoIvaSRI: string;
  unidadMedida: { codigo: string; nombre: string; permiteDecimales: boolean };
  tarifaImpuesto: { porcentaje: number } | null;
}

export interface PresentacionPos {
  id: string;
  nombre: string;
  factor: number;
  precioVenta: number | null;
}

export interface Pagina<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ClientePos {
  id: string;
  tipoIdentificacion: string;
  identificacion: string;
  razonSocial: string;
  email?: string | null;
}

export interface PuntoEmisionPos {
  id: string;
  codigo: string;
  descripcion: string;
  sucursal: { id: string; codigo: string; nombre: string };
}

export interface TurnoPos {
  id: string;
  sucursalId: string;
  estado: string;
  montoApertura: number;
}

export interface ResultadoEscaneoPos {
  tipo: "PRODUCTO" | "PRESENTACION" | "BALANZA";
  producto: ProductoPos;
  presentacion: PresentacionPos | null;
  cantidad: number;
  etiqueta: { plu: string; tipo: "PESO" | "PRECIO"; pesoKg: number | null; importe: number | null } | null;
}

export interface PesoLeidoPos {
  brutoKg: number;
  taraKg: number;
  netoKg: number;
  cantidad: number | null;
  unidad: string | null;
}

export interface VentaEmitidaPos {
  id: string;
  numero: string;
  subtotal: number;
  descuento: number;
  iva: number;
  propina: number;
  total: number;
  pagos: Array<{ formaPago: string; monto: number; cambio: number }>;
  comprobante: { id: string; estado: string; claveAcceso: string } | null;
  advertencias: string[];
}

export interface ConfiguracionBalanzaPos {
  habilitada: boolean;
  puerto: string | null;
}

export interface ConfiguracionImpresoraPos {
  conexion: "NINGUNA" | "RED" | "SISTEMA";
  impresionTermica: boolean;
}

export interface ColaSriPos {
  porEstado: Record<string, number>;
  pendientes: Array<{ id: string; estado: string; intentos: number; ultimoError: string | null }>;
}

export const FORMAS_PAGO = [
  { valor: "EFECTIVO", etiqueta: "Efectivo" },
  { valor: "TARJETA_CREDITO", etiqueta: "Tarjeta de crédito" },
  { valor: "TARJETA_DEBITO", etiqueta: "Tarjeta de débito" },
  { valor: "TRANSFERENCIA", etiqueta: "Transferencia" },
  { valor: "CHEQUE", etiqueta: "Cheque" },
  { valor: "CREDITO", etiqueta: "Crédito" },
] as const;

export type FormaPago = (typeof FORMAS_PAGO)[number]["valor"];

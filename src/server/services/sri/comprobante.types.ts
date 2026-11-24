// ============================================================
// src/server/services/sri/comprobante.types.ts — Datos de entrada de los constructores de XML
// ============================================================
import type { AmbienteSri } from "./claveAcceso.util";

export type TipoIdentificacionComprador = "04" | "05" | "06" | "07" | "08";

export interface DatosEmisor {
  ambiente: AmbienteSri;
  razonSocial: string;
  nombreComercial: string;
  /** 13 dígitos terminados en 001 */
  ruc: string;
  dirMatriz: string;
  /** Nº de resolución de agente de retención (solo dígitos, máx. 8) */
  agenteRetencion?: string | undefined;
  /** RIMPE (emprendedor o negocio popular): agrega la leyenda obligatoria */
  contribuyenteRimpe: boolean;
  /** Nº de resolución de contribuyente especial (3–13 alfanuméricos) */
  contribuyenteEspecial?: string | undefined;
  obligadoContabilidad: boolean;
  /** Establecimiento (3 dígitos) */
  estab: string;
  /** Punto de emisión (3 dígitos) */
  ptoEmi: string;
  dirEstablecimiento: string;
}

export interface DatosComprador {
  tipoIdentificacion: TipoIdentificacionComprador;
  identificacion: string;
  razonSocial: string;
  direccion?: string | undefined;
}

export interface LineaComprobante {
  codigoPrincipal: string;
  descripcion: string;
  unidadMedida?: string | undefined;
  cantidad: number;
  precioUnitario: number;
  /** Valor del descuento de la línea (no el porcentaje) */
  descuento: number;
  /** cantidad × precio − descuento */
  precioTotalSinImpuesto: number;
  impuesto: {
    /** Tabla 17 del SRI */
    codigoPorcentaje: string;
    /** Porcentaje (15, 5, 0…) */
    tarifa: number;
    baseImponible: number;
    valor: number;
  };
}

export interface PagoComprobante {
  /** Tabla 24 del SRI */
  formaPago: string;
  total: number;
  plazo?: number | undefined;
  unidadTiempo?: string | undefined;
}

export interface CampoAdicional {
  nombre: string;
  valor: string;
}

interface DatosBaseComprobante {
  emisor: DatosEmisor;
  /** 49 dígitos */
  claveAcceso: string;
  /** 9 dígitos */
  secuencial: string;
  fechaEmision: Date;
  comprador: DatosComprador;
  lineas: LineaComprobante[];
  infoAdicional: CampoAdicional[];
}

export interface DatosFactura extends DatosBaseComprobante {
  /** Propina/servicio: no gravada; forma parte del importe total */
  propina: number;
  pagos: PagoComprobante[];
}

export interface DatosNotaCredito extends DatosBaseComprobante {
  /** Factura que se modifica */
  docModificado: {
    /** "01" */
    codDoc: string;
    /** 001-001-000000001 */
    numero: string;
    fechaEmision: Date;
  };
  motivo: string;
}

export interface TotalImpuestoAgrupado {
  codigoPorcentaje: string;
  tarifa: number;
  baseImponible: number;
  valor: number;
}

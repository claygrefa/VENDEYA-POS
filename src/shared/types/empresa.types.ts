// ============================================================
// src/shared/types/empresa.types.ts — Empresa, Sucursal, Punto de Emisión
// ============================================================

import type { UUID, AuditTimestamps, ActiveStatus } from "./common.types";

/** Tipos de Contribuyente SRI */
export type TipoContribuyente =
  | "PERSONA_NATURAL"
  | "SOCIEDAD"
  | "PERSONA_NATURAL_OBLIGADA"
  | "MICRO_EMPRESA"
  | "RIMPE_EMPRENDEDOR"
  | "RIMPE_NEGOCIO_POPULAR";

/** Regímenes tributarios Ecuador */
export type RegimenTributario =
  | "GENERAL"
  | "RIMPE_EMPRENDEDOR"
  | "RIMPE_NEGOCIO_POPULAR"
  | "MICROEMPRESA";

export interface Empresa extends AuditTimestamps {
  id:                 UUID;
  ruc:                string;        // 13 dígitos
  razonSocial:        string;
  nombreComercial:    string;
  direccionMatriz:    string;
  telefono:           string;
  email:              string;
  logo?:              string | null; // ruta local al archivo de logo
  tipoContribuyente:  TipoContribuyente;
  regimenTributario:  RegimenTributario;
  obligadoContabilidad: boolean;
  agenteRetencion:    boolean;
  ambienteSRI:        "PRUEBAS" | "PRODUCCION";
  resolucionAgente?:  string | null;
  status:             ActiveStatus;
}

export interface Sucursal extends AuditTimestamps {
  id:          UUID;
  empresaId:   UUID;
  codigo:      string;    // 3 dígitos: "001"
  nombre:      string;
  direccion:   string;
  telefono:    string;
  status:      ActiveStatus;
}

export interface PuntoEmision extends AuditTimestamps {
  id:          UUID;
  sucursalId:  UUID;
  codigo:      string;    // 3 dígitos: "001"
  descripcion: string;
  status:      ActiveStatus;
}

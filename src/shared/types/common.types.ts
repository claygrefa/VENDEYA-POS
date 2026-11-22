// ============================================================
// src/shared/types/common.types.ts — Tipos utilitarios globales
// ============================================================

/** Resultado genérico de operación (patrón Result) */
export type Result<T, E = string> =
  | { ok: true;  value: T }
  | { ok: false; error: E };

/** Paginación estándar */
export interface PaginatedResult<T> {
  data:       T[];
  total:      number;
  page:       number;
  pageSize:   number;
  totalPages: number;
}

/** Parámetros de consulta paginada */
export interface PaginationParams {
  page?:     number;
  pageSize?: number;
  search?:   string;
  orderBy?:  string;
  orderDir?: "asc" | "desc";
}

/** Timestamps estándar de auditoría */
export interface AuditTimestamps {
  createdAt:  Date;
  updatedAt:  Date;
  deletedAt?: Date | null;
}

/** Moneda: solo USD para Ecuador */
export type Currency = "USD";

/** Precisión monetaria: 2 decimales (Decimal en Prisma → number aquí) */
export type Money = number;

/** UUID v4 */
export type UUID = string;

/** Estado genérico activo/inactivo */
export type ActiveStatus = "ACTIVO" | "INACTIVO";

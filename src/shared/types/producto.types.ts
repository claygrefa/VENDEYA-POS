// ============================================================
// src/shared/types/producto.types.ts — Producto, Categoría, Unidad, Lote
// ============================================================

import type { UUID, AuditTimestamps, Money, ActiveStatus } from "./common.types";

export type TipoProducto = "BIEN" | "SERVICIO";

export interface Categoria extends AuditTimestamps {
  id:          UUID;
  nombre:      string;
  descripcion: string;
  status:      ActiveStatus;
}

export interface UnidadMedida extends AuditTimestamps {
  id:       UUID;
  codigo:   string;  // ej: "UN", "KG", "L"
  nombre:   string;
  status:   ActiveStatus;
}

export interface Producto extends AuditTimestamps {
  id:               UUID;
  codigo:           string;
  codigoBarras?:    string | null;
  nombre:           string;
  descripcion?:     string | null;
  tipo:             TipoProducto;
  categoriaId:      UUID;
  unidadMedidaId:   UUID;
  precioCompra:     Money;
  precioVenta:      Money;
  margen:           Money;        // porcentaje
  stockMinimo:      number;
  stockActual:      number;
  costoPromedio:    Money;        // kardex costo promedio ponderado
  aplicaIva:        boolean;
  codigoIvaSRI:     string;      // Tabla 17 SRI: "4" = 15%, "5" = 5%, "0" = 0%, "6" = no objeto, "7" = exento
  tieneVencimiento: boolean;     // para módulo farmacia
  requiereLote:     boolean;
  status:           ActiveStatus;
}

export interface Lote extends AuditTimestamps {
  id:              UUID;
  productoId:      UUID;
  numeroLote:      string;
  fechaFabricacion?: Date | null;
  fechaVencimiento:  Date;
  cantidadInicial:  number;
  cantidadActual:   number;
  status:           ActiveStatus;
}

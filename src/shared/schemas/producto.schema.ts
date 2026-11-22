// ============================================================
// src/shared/schemas/producto.schema.ts
// ============================================================
import { z } from "zod";

export const ProductoSchema = z.object({
  codigo:          z.string().min(1).max(50),
  codigoBarras:    z.string().max(50).optional().nullable(),
  nombre:          z.string().min(2).max(300),
  descripcion:     z.string().max(500).optional().nullable(),
  tipo:            z.enum(["BIEN", "SERVICIO"]),
  categoriaId:     z.string().uuid(),
  unidadMedidaId:  z.string().uuid(),
  precioCompra:    z.number().nonnegative(),
  precioVenta:     z.number().positive(),
  stockMinimo:     z.number().nonnegative().default(0),
  aplicaIva:       z.boolean().default(true),
  codigoIvaSRI:    z.string().default("2"),
  tieneVencimiento: z.boolean().default(false),
  requiereLote:    z.boolean().default(false),
});

export type ProductoInput = z.infer<typeof ProductoSchema>;

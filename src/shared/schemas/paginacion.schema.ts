// ============================================================
// src/shared/schemas/paginacion.schema.ts
// ============================================================
import { z } from "zod";

export const PaginacionSchema = z.object({
  page:     z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  search:   z.string().trim().optional(),
  orderBy:  z.string().trim().optional(),
  orderDir: z.enum(["asc", "desc"]).default("asc"),
});

export type PaginacionInput = z.infer<typeof PaginacionSchema>;

// ============================================================
// src/shared/schemas/restaurante.schema.ts — Mesas, comandas, cocina y cobro
// ============================================================
import { z } from "zod";
import { PagoVentaInputSchema, VentaInputSchema } from "./venta.schema";

export const DESTINOS_PREPARACION = ["COCINA", "BARRA"] as const;

// ── Mesas ────────────────────────────────────────────────────

export const MesaSchema = z.object({
  sucursalId: z.string().uuid(),
  numero:     z.number().int().positive().max(9999),
  nombre:     z.string().trim().min(1).max(60),
  capacidad:  z.number().int().positive().max(100).default(4),
  zona:       z.string().trim().min(1).max(40).default("SALON"),
});

export const MesaActualizarSchema = MesaSchema.omit({ sucursalId: true }).partial().extend({
  status: z.enum(["ACTIVO", "INACTIVO"]).optional(),
});

/** Cambio manual de estado de una mesa sin cuenta abierta. */
export const MesaEstadoSchema = z.object({
  estado: z.enum(["LIBRE", "RESERVADA"]),
});

export const FiltroMesasSchema = z.object({
  sucursalId: z.string().uuid().optional(),
  zona:       z.string().trim().min(1).optional(),
});

// ── Comandas ─────────────────────────────────────────────────

export const AbrirComandaSchema = z.object({
  mesaId:        z.string().uuid(),
  comensales:    z.number().int().positive().max(100).default(1),
  /** Por defecto, el usuario que abre la cuenta */
  meseroId:      z.string().uuid().optional(),
  observaciones: z.string().trim().max(300).optional(),
});

export const ItemComandaInputSchema = z.object({
  productoId:    z.string().uuid(),
  cantidad:      z.number().positive().max(1000),
  observaciones: z.string().trim().max(200).optional(),
});

export const AgregarItemsSchema = z.object({
  items: z.array(ItemComandaInputSchema).min(1, "Debe agregar al menos un ítem").max(100),
});

export const CancelarItemSchema = z.object({
  motivo: z.string().trim().max(200).optional(),
});

/** Avance de un ítem enviado: cocina lo marca LISTO; el mesero lo marca ENTREGADO. */
export const EstadoItemSchema = z.object({
  estado: z.enum(["LISTO", "ENTREGADO"]),
});

export const MoverComandaSchema = z.object({
  mesaId: z.string().uuid(),
});

export const UnirComandaSchema = z.object({
  comandaDestinoId: z.string().uuid(),
});

export const AnularComandaSchema = z.object({
  motivo: z.string().trim().min(5, "El motivo debe tener al menos 5 caracteres").max(300),
});

export const FiltroComandasSchema = z.object({
  estado:     z.enum(["ABIERTA", "CERRADA", "ANULADA", "UNIDA"]).optional(),
  sucursalId: z.string().uuid().optional(),
  mesaId:     z.string().uuid().optional(),
});

export const FiltroCocinaSchema = z.object({
  destino:    z.enum(DESTINOS_PREPARACION).optional(),
  /** Por defecto EN_PREPARACION (lo que cocina debe preparar) */
  estado:     z.enum(["EN_PREPARACION", "LISTO"]).default("EN_PREPARACION"),
  sucursalId: z.string().uuid().optional(),
});

export const PreCuentaQuerySchema = z.object({
  /** Simula la división en N partes iguales */
  partes: z.coerce.number().int().min(2).max(50).optional(),
});

// ── Cobro ────────────────────────────────────────────────────

export const CobrarComandaSchema = z
  .object({
    intentoId:       VentaInputSchema.shape.intentoId,
    puntoEmisionId: z.string().uuid(),
    modo:           z.enum(["ITEMS", "PARTE_IGUAL"]).default("ITEMS"),
    /** ITEMS: ítems a cobrar en esta venta (por defecto, todos los pendientes de cobro) */
    itemIds:        z.array(z.string().uuid()).min(1).optional(),
    /** PARTE_IGUAL: nº total de partes y nº de la parte que se cobra ahora */
    partes:         z.number().int().min(2).max(50).optional(),
    parte:          z.number().int().min(1).max(50).optional(),
    clienteId:      z.string().uuid().optional().nullable(),
    clienteRuc:     z.string().max(13).optional().nullable(),
    clienteNombre:  z.string().max(300).optional().nullable(),
    propina:        z.number().nonnegative().max(100_000).default(0),
    /** Genera la factura electrónica de esta venta */
    emitirFactura:  z.boolean().default(false),
    pagos:          z.array(PagoVentaInputSchema).min(1, "Debe indicar al menos un pago"),
    observaciones:  z.string().max(300).optional().nullable(),
  })
  .superRefine((c, ctx) => {
    if (c.modo === "PARTE_IGUAL") {
      if (c.partes === undefined || c.parte === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["partes"], message: "PARTE_IGUAL requiere 'partes' y 'parte'" });
      } else if (c.parte > c.partes) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["parte"], message: "La parte no puede superar el total de partes" });
      }
      if (c.itemIds !== undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["itemIds"], message: "PARTE_IGUAL cobra todos los ítems proporcionalmente" });
      }
    } else if (c.partes !== undefined || c.parte !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["modo"], message: "'partes' y 'parte' solo aplican al modo PARTE_IGUAL" });
    }
  });

export type MesaInput = z.infer<typeof MesaSchema>;
export type AbrirComandaInput = z.infer<typeof AbrirComandaSchema>;
export type ItemComandaInput = z.infer<typeof ItemComandaInputSchema>;
export type CobrarComandaInput = z.infer<typeof CobrarComandaSchema>;

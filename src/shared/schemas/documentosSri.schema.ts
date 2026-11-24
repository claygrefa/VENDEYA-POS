// ============================================================
// src/shared/schemas/documentosSri.schema.ts — Retenciones, liquidaciones de compra y guías de remisión
// ============================================================
import { z } from "zod";

const identificacion = z.string().trim().min(1).max(20);
const texto = (max: number) => z.string().trim().min(1).max(max);

/** Una retención: el valor se calcula en el servidor (base × porcentaje) para que nunca discrepe. */
export const LineaRetencionInputSchema = z.object({
  /** 1 = Renta · 2 = IVA · 6 = ISD */
  codigo: z.enum(["1", "2", "6"]),
  /** Código de retención del SRI (p. ej. 312, 303, 9, 10) */
  codigoRetencion: z.string().trim().min(1).max(5),
  baseImponible: z.number().positive(),
  porcentaje: z.number().positive().max(100),
});

export const EmitirRetencionSchema = z.object({
  puntoEmisionId: z.string().uuid(),
  retenciones: z.array(LineaRetencionInputSchema).min(1, "Indique al menos una retención").max(20),
  parteRelacionada: z.boolean().default(false),
});

export const EmitirLiquidacionSchema = z.object({
  puntoEmisionId: z.string().uuid(),
});

export const DestinatarioGuiaInputSchema = z.object({
  identificacion,
  razonSocial: texto(300),
  direccion: texto(300),
  motivoTraslado: texto(300),
  codEstabDestino: z.string().regex(/^\d{3}$/).optional(),
  ruta: z.string().trim().max(300).optional(),
  /** Documento que sustenta el traslado (p. ej. la factura de la venta) */
  sustento: z
    .object({
      codDoc: z.string().regex(/^\d{2}$/),
      numero: z.string().regex(/^\d{3}-\d{3}-\d{9}$/, "El número debe tener el formato 001-001-000000001"),
      numAutorizacion: z.string().regex(/^\d{10,49}$/).optional(),
      fechaEmision: z.coerce.date(),
    })
    .optional(),
  detalles: z
    .array(z.object({ codigoInterno: texto(25), descripcion: texto(300), cantidad: z.number().positive() }))
    .min(1, "El destinatario necesita al menos un producto")
    .max(200),
});

export const EmitirGuiaRemisionSchema = z.object({
  puntoEmisionId: z.string().uuid(),
  dirPartida: texto(300),
  transportista: z.object({
    tipoIdentificacion: z.enum(["04", "05", "06", "08"]),
    identificacion,
    razonSocial: texto(300),
  }),
  fechaInicioTransporte: z.coerce.date(),
  fechaFinTransporte: z.coerce.date(),
  placa: texto(20),
  destinatarios: z.array(DestinatarioGuiaInputSchema).min(1, "Indique al menos un destinatario").max(50),
  infoAdicional: z.array(z.object({ nombre: texto(300), valor: texto(300) })).max(15).optional(),
});

export const PeriodoAtsSchema = z.object({
  anio: z.coerce.number().int().min(2010).max(2100),
  mes: z.coerce.number().int().min(1).max(12),
});

export type EmitirRetencionInput = z.infer<typeof EmitirRetencionSchema>;
export type EmitirGuiaRemisionInput = z.infer<typeof EmitirGuiaRemisionSchema>;

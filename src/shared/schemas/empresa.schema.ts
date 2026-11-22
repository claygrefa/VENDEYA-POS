// ============================================================
// src/shared/schemas/empresa.schema.ts
// ============================================================
import { z } from "zod";

const RUC_REGEX      = /^\d{13}$/;
const TELEFONO_REGEX  = /^[\d\s\-+()]{7,20}$/;
const EMAIL_REGEX     = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const EmpresaSchema = z.object({
  ruc:                  z.string().regex(RUC_REGEX,      "El RUC debe tener exactamente 13 dígitos"),
  razonSocial:          z.string().min(2).max(300),
  nombreComercial:      z.string().min(2).max(300),
  direccionMatriz:      z.string().min(5).max(300),
  telefono:             z.string().regex(TELEFONO_REGEX, "Teléfono inválido"),
  email:                z.string().regex(EMAIL_REGEX,    "Email inválido"),
  tipoContribuyente:    z.enum([
    "PERSONA_NATURAL", "SOCIEDAD", "PERSONA_NATURAL_OBLIGADA",
    "MICRO_EMPRESA", "RIMPE_EMPRENDEDOR", "RIMPE_NEGOCIO_POPULAR",
  ]),
  regimenTributario:    z.enum(["GENERAL", "RIMPE_EMPRENDEDOR", "RIMPE_NEGOCIO_POPULAR", "MICROEMPRESA"]),
  obligadoContabilidad: z.boolean().default(false),
  agenteRetencion:      z.boolean().default(false),
  ambienteSRI:          z.enum(["PRUEBAS", "PRODUCCION"]).default("PRUEBAS"),
  resolucionAgente:     z.string().max(100).optional().nullable(),
  logo:                 z.string().max(500).optional().nullable(),
});

export type EmpresaInput = z.infer<typeof EmpresaSchema>;

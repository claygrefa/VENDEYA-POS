// ============================================================
// src/shared/schemas/setup.schema.ts — Asistente de configuración inicial y ajustes del negocio
// ============================================================
import { z } from "zod";
import { validarCedulaEcuatoriana } from "./cliente.schema";

const TELEFONO = /^[\d\s\-+()]{7,20}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const GIROS = ["RETAIL_GENERAL", "FERRETERIA", "FARMACIA", "RESTAURANTE", "SERVICIOS", "DISTRIBUIDOR"] as const;
export const TIPOS_CONTRIBUYENTE = ["PERSONA_NATURAL", "SOCIEDAD", "PERSONA_NATURAL_OBLIGADA", "MICRO_EMPRESA", "RIMPE_EMPRENDEDOR", "RIMPE_NEGOCIO_POPULAR"] as const;
export const REGIMENES = ["GENERAL", "RIMPE_EMPRENDEDOR", "RIMPE_NEGOCIO_POPULAR", "MICROEMPRESA"] as const;

/**
 * ¿El RUC cumple el dígito verificador? Persona natural (3.er dígito 0–5): cédula módulo 10 + establecimiento;
 * sector público (6): módulo 11 con coeficientes 3,2,7,6,5,4,3,2; sociedad privada (9): módulo 11 con 4,3,2,7,6,5,4,3,2.
 * El SRI tiene excepciones históricas: por eso el asistente permite confirmar un RUC que no pasa esta prueba.
 */
export function validarRucEcuatoriano(ruc: string): boolean {
  if (!/^\d{13}$/.test(ruc)) return false;
  const d = [...ruc].map(Number) as number[];
  const provincia = Number(ruc.slice(0, 2));
  if ((provincia < 1 || provincia > 24) && provincia !== 30) return false;
  const tercero = d[2] as number;
  const modulo11 = (coef: number[], posicionVerificador: number): boolean => {
    const suma = coef.reduce((a, c, i) => a + c * (d[i] as number), 0);
    const resto = suma % 11;
    const verificador = resto === 0 ? 0 : 11 - resto;
    return verificador === d[posicionVerificador];
  };
  if (tercero <= 5) return validarCedulaEcuatoriana(ruc.slice(0, 10)) && Number(ruc.slice(10)) >= 1;
  if (tercero === 6) return modulo11([3, 2, 7, 6, 5, 4, 3, 2], 8) && Number(ruc.slice(9)) >= 1;
  if (tercero === 9) return modulo11([4, 3, 2, 7, 6, 5, 4, 3, 2], 9) && Number(ruc.slice(10)) >= 1;
  return false;
}

export const DatosEmpresaSchema = z.object({
  ruc: z.string().regex(/^\d{13}$/, "El RUC debe tener exactamente 13 dígitos"),
  razonSocial: z.string().trim().min(2).max(300),
  nombreComercial: z.string().trim().min(2).max(300),
  direccionMatriz: z.string().trim().min(5).max(300),
  telefono: z.string().regex(TELEFONO, "Teléfono inválido"),
  email: z.string().regex(EMAIL, "Email inválido"),
  tipoContribuyente: z.enum(TIPOS_CONTRIBUYENTE),
  regimenTributario: z.enum(REGIMENES),
  obligadoContabilidad: z.boolean().default(false),
  agenteRetencion: z.boolean().default(false),
  resolucionAgente: z.string().trim().max(100).optional().nullable(),
  contribuyenteEspecial: z.string().regex(/^[A-Za-z0-9]{3,13}$/, "3 a 13 caracteres alfanuméricos").optional().nullable(),
  ambienteSRI: z.enum(["PRUEBAS", "PRODUCCION"]).default("PRUEBAS"),
});

export const SetupSchema = z.object({
  empresa: DatosEmpresaSchema,
  /** El RUC no pasó la verificación y el usuario confirma que es correcto */
  confirmarRuc: z.boolean().default(false),
  sucursal: z.object({
    nombre: z.string().trim().min(2).max(100),
    direccion: z.string().trim().min(5).max(300),
    telefono: z.string().regex(TELEFONO, "Teléfono inválido"),
  }),
  giro: z.enum(GIROS),
  admin: z.object({
    username: z.string().regex(/^[a-z0-9._-]{3,30}$/, "El usuario son 3 a 30 letras minúsculas, números, punto, guion o guion bajo"),
    password: z
      .string()
      .min(8, "La contraseña debe tener al menos 8 caracteres")
      .max(100)
      .regex(/[A-Za-z]/, "La contraseña debe tener al menos una letra")
      .regex(/\d/, "La contraseña debe tener al menos un número"),
    nombre: z.string().trim().min(2).max(100),
    apellido: z.string().trim().min(2).max(100),
  }),
});

/** Validación del certificado durante el asistente (todavía no hay empresa guardada: el RUC viene del paso 1). */
export const ValidarCertificadoSetupSchema = z.object({
  archivoBase64: z.string().min(1, "Elija el archivo del certificado").max(400_000),
  password: z.string().min(1, "La contraseña del certificado es obligatoria").max(256),
  ruc: z.string().regex(/^\d{13}$/, "Indique primero el RUC de la empresa"),
  confirmarTitular: z.boolean().optional(),
});

// ── Ajustes ──────────────────────────────────────────────────

/** Datos de la empresa que se pueden cambiar (el RUC no: identifica a la empresa y a sus comprobantes). */
export const EmpresaActualizarSchema = DatosEmpresaSchema.omit({ ruc: true }).partial().strict();

export const MODULOS_AJUSTABLES = [
  "moduloLotes", "moduloVencimientos", "moduloMesas", "moduloComandasCocina", "moduloBalanza", "moduloListasPrecios",
  "moduloCuentasPorCobrar", "moduloCuentasPorPagar", "emitirFacturas", "emitirNotasCredito", "emitirRetenciones", "emitirGuiasRemision",
  "emitirLiquidaciones", "impresionTermica", "aperturaGaveta", "lecturaCodigoBarras", "sincronizacionLAN",
] as const;

export const ModulosSchema = z.object(Object.fromEntries(MODULOS_AJUSTABLES.map((m) => [m, z.boolean().optional()])) as Record<(typeof MODULOS_AJUSTABLES)[number], z.ZodOptional<z.ZodBoolean>>).strict();

export const AplicarGiroSchema = z.object({ giro: z.enum(GIROS) });

export type SetupInput = z.infer<typeof SetupSchema>;
export type GiroNegocioId = (typeof GIROS)[number];

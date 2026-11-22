// ============================================================
// src/shared/schemas/cliente.schema.ts
// ============================================================
import { z } from "zod";

/** Valida una cédula ecuatoriana (10 dígitos, Módulo 10). */
export function validarCedulaEcuatoriana(cedula: string): boolean {
  if (!/^\d{10}$/.test(cedula)) return false;
  const provincia = parseInt(cedula.slice(0, 2), 10);
  if ((provincia < 1 || provincia > 24) && provincia !== 30) return false;
  if (parseInt(cedula[2] as string, 10) > 5) return false;

  let suma = 0;
  for (let i = 0; i < 9; i++) {
    let valor = parseInt(cedula[i] as string, 10) * (i % 2 === 0 ? 2 : 1);
    if (valor > 9) valor -= 9;
    suma += valor;
  }
  const verificador = (10 - (suma % 10)) % 10;
  return verificador === parseInt(cedula[9] as string, 10);
}

export const ClienteSchema = z
  .object({
    tipoIdentificacion: z.enum(["04", "05", "06", "07", "08"]),
    identificacion:     z.string().trim().min(1).max(20),
    razonSocial:        z.string().trim().min(2).max(300),
    nombreComercial:    z.string().trim().max(300).optional().nullable(),
    email:              z.string().regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Email inválido").optional().nullable(),
    telefono:           z.string().regex(/^[\d\s\-+()]{7,20}$/, "Teléfono inválido").optional().nullable(),
    direccion:          z.string().trim().max(300).optional().nullable(),
    limiteCredito:      z.number().nonnegative().default(0),
    diasCredito:        z.number().int().nonnegative().default(0),
    descuentoHabitual:  z.number().min(0).max(100).default(0),
  })
  .superRefine((c, ctx) => {
    const id = c.identificacion;
    let valido = true;
    let mensaje = "";
    switch (c.tipoIdentificacion) {
      case "04":
        valido = /^\d{13}$/.test(id) && id.endsWith("001");
        mensaje = "El RUC debe tener 13 dígitos y terminar en 001";
        break;
      case "05":
        valido = validarCedulaEcuatoriana(id);
        mensaje = "Cédula ecuatoriana inválida";
        break;
      case "06":
      case "08":
        valido = /^[A-Za-z0-9]{3,20}$/.test(id);
        mensaje = "Identificación alfanumérica de 3 a 20 caracteres";
        break;
      case "07":
        valido = id === "9999999999999";
        mensaje = "Consumidor Final debe usar 9999999999999";
        break;
    }
    if (!valido) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["identificacion"], message: mensaje });
    }
  });

export type ClienteInput = z.infer<typeof ClienteSchema>;

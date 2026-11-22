// ============================================================
// src/shared/schemas/usuario.schema.ts
// ============================================================
import { z } from "zod";

export const UsuarioSchema = z.object({
  empresaId: z.string().uuid(),
  rol:       z.enum(["ADMIN", "SUPERVISOR", "CAJERO", "BODEGUERO", "CONTADOR"]),
  username:  z.string().trim().min(3).max(50).regex(/^[a-zA-Z0-9._-]+$/, "Solo letras, números, punto, guion y guion bajo"),
  password:  z.string().min(8, "La contraseña debe tener al menos 8 caracteres").max(100),
  nombre:    z.string().trim().min(1).max(100),
  apellido:  z.string().trim().min(1).max(100),
  email:     z.string().regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Email inválido").optional().nullable(),
  cedula:    z.string().max(13).optional().nullable(),
  telefono:  z.string().max(20).optional().nullable(),
});

export type UsuarioInput = z.infer<typeof UsuarioSchema>;

export const LoginSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
});

export type LoginInput = z.infer<typeof LoginSchema>;

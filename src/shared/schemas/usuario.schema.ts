// ============================================================
// src/shared/schemas/usuario.schema.ts
// ============================================================
import { z } from "zod";

export const UsuarioSchema = z.object({
  empresaId: z.string().uuid(),
  rol:       z.enum(["ADMIN", "SUPERVISOR", "CAJERO", "BODEGUERO", "CONTADOR", "MESERO", "COCINA"]),
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

// ── Gestión de usuarios (administrador) ──────────────────────
export const ROLES_USUARIO = ["ADMIN", "SUPERVISOR", "CAJERO", "BODEGUERO", "CONTADOR", "MESERO", "COCINA"] as const;

/** Alta desde la pantalla de usuarios: la empresa es la del administrador que la hace. El usuario se guarda en minúsculas. */
export const NuevoUsuarioSchema = UsuarioSchema.omit({ empresaId: true }).extend({
  username: UsuarioSchema.shape.username.transform((u) => u.toLowerCase()),
});
export type NuevoUsuarioInput = z.infer<typeof NuevoUsuarioSchema>;

/** Datos que se pueden corregir de un usuario (el nombre de usuario no cambia: figura en turnos y ventas). */
export const ActualizarUsuarioSchema = z.object({
  rol:      z.enum(ROLES_USUARIO).optional(),
  nombre:   z.string().trim().min(1).max(100).optional(),
  apellido: z.string().trim().min(1).max(100).optional(),
  email:    UsuarioSchema.shape.email,
  cedula:   UsuarioSchema.shape.cedula,
  telefono: UsuarioSchema.shape.telefono,
});
export type ActualizarUsuarioInput = z.infer<typeof ActualizarUsuarioSchema>;

export const EstadoUsuarioSchema = z.object({ estado: z.enum(["ACTIVO", "INACTIVO"]) });

export const FiltroUsuariosSchema = z.object({
  q:      z.string().trim().max(100).optional(),
  estado: z.enum(["ACTIVO", "INACTIVO"]).optional(),
});

/** El administrador define una contraseña nueva para otra persona: confirma con la suya. */
export const RestablecerPasswordSchema = z.object({
  passwordAdmin: z.string().min(1, "Escriba su contraseña para confirmar").max(200),
  password:      UsuarioSchema.shape.password,
});

/** Cada usuario cambia la suya: debe conocer la actual. */
export const CambiarPasswordSchema = z.object({
  actual: z.string().min(1, "Escriba su contraseña actual").max(200),
  nueva:  UsuarioSchema.shape.password,
}).refine((d) => d.actual !== d.nueva, { message: "La contraseña nueva debe ser distinta de la actual", path: ["nueva"] });

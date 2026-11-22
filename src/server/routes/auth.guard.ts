// ============================================================
// src/server/routes/auth.guard.ts — Autenticación Bearer y permisos RBAC
// ============================================================
import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import type { Servicios } from "../services/container.factory";
import type { UsuarioPublico } from "../services/usuario.service";

declare module "fastify" {
  interface FastifyRequest {
    /** Usuario autenticado (null en rutas públicas o antes del guard) */
    usuario: UsuarioPublico | null;
    /** Token Bearer de la sesión actual */
    token: string | null;
  }
}

function extraerToken(req: FastifyRequest): string | null {
  const cabecera = req.headers.authorization;
  if (cabecera === undefined) return null;
  const [esquema, token] = cabecera.split(" ");
  return esquema?.toLowerCase() === "bearer" && token !== undefined && token !== "" ? token : null;
}

function rechazar(reply: FastifyReply, status: 401 | 403, error: string, mensaje: string): FastifyReply {
  return reply.status(status).send({ error, mensaje });
}

/** Exige sesión válida y, si se indica, el permiso `modulo:accion`. */
export function requerirSesion(
  servicios: Servicios,
  permiso?: { modulo: string; accion: string }
): preHandlerAsyncHookHandler {
  return async (req, reply) => {
    const token = extraerToken(req);
    const usuario = token !== null ? servicios.sesiones.obtener(token) : null;
    if (token === null || usuario === null) {
      return rechazar(reply, 401, "NO_AUTENTICADO", "Sesión requerida o expirada");
    }
    if (permiso !== undefined && !servicios.usuarios.tienePermiso(usuario, permiso.modulo, permiso.accion)) {
      return rechazar(reply, 403, "SIN_PERMISO", `Permiso requerido: ${permiso.modulo}:${permiso.accion}`);
    }
    req.usuario = usuario;
    req.token = token;
  };
}

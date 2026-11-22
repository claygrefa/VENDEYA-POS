// ============================================================
// src/server/controllers/actor.util.ts — Usuario de la sesión como actor de los servicios
// ============================================================
import type { FastifyRequest } from "fastify";
import { AppError } from "../services/appError.util";
import type { ActorCaja } from "../services/turno.service";

export function actorDe(req: FastifyRequest): ActorCaja {
  if (req.usuario === null) throw new AppError("CREDENCIALES_INVALIDAS", "Sesión requerida");
  return { id: req.usuario.id, empresaId: req.usuario.empresaId, permisos: req.usuario.permisos };
}

// ============================================================
// src/server/controllers/usuario.controller.ts — Gestión de usuarios (administrador) y cambio de la propia contraseña
// ============================================================
import type { FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "../services/appError.util";
import type { Servicios } from "../services/container.factory";
import type { ActorUsuarios } from "../services/usuarioAdmin.service";

type ConId = FastifyRequest<{ Params: { id: string } }>;

function actorUsuarios(req: FastifyRequest): ActorUsuarios {
  if (req.usuario === null) throw new AppError("CREDENCIALES_INVALIDAS", "Sesión requerida");
  return { id: req.usuario.id, empresaId: req.usuario.empresaId, username: req.usuario.username };
}

export function crearUsuarioController(servicios: Servicios) {
  const admin = servicios.usuariosAdmin;
  return {
    listar: async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => reply.send(await admin.listar(actorUsuarios(req), req.query)),

    roles: async (_req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => reply.send(await admin.roles()),

    crear: async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => reply.status(201).send(await admin.crear(actorUsuarios(req), req.body)),

    actualizar: async (req: ConId, reply: FastifyReply): Promise<FastifyReply> => reply.send(await admin.actualizar(actorUsuarios(req), req.params.id, req.body)),

    estado: async (req: ConId, reply: FastifyReply): Promise<FastifyReply> => reply.send(await admin.cambiarEstado(actorUsuarios(req), req.params.id, req.body)),

    restablecerPassword: async (req: ConId, reply: FastifyReply): Promise<FastifyReply> =>
      reply.send(await admin.restablecerPassword(actorUsuarios(req), req.params.id, req.body, req.ip)),

    /** Cada usuario, la suya (cualquier rol). Una contraseña actual equivocada es 400, no 401: no es una sesión inválida. */
    cambiarMiPassword: async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> =>
      reply.send(await admin.cambiarMiPassword(actorUsuarios(req), req.token, req.body, req.ip)),
  };
}

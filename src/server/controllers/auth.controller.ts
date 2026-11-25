// ============================================================
// src/server/controllers/auth.controller.ts
// ============================================================
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Servicios } from "../services/container.factory";

export function crearAuthController(servicios: Servicios) {
  return {
    login: async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      const usuario = await servicios.usuarios.autenticar(req.body, req.ip);
      const token = servicios.sesiones.crear(usuario);
      return reply.send({ token, usuario });
    },

    logout: async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      if (req.token !== null) servicios.sesiones.revocar(req.token);
      return reply.status(204).send();
    },

    yo: async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      return reply.send({ usuario: req.usuario });
    },
  };
}

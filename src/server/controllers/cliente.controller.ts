// ============================================================
// src/server/controllers/cliente.controller.ts
// ============================================================
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Servicios } from "../services/container.factory";

export function crearClienteController(servicios: Servicios) {
  return {
    buscar: async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      return reply.send(await servicios.clientes.buscar(req.query));
    },

    consumidorFinal: async (_req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      return reply.send(await servicios.clientes.consumidorFinal());
    },

    obtener: async (
      req: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply
    ): Promise<FastifyReply> => {
      return reply.send(await servicios.clientes.obtener(req.params.id));
    },
  };
}

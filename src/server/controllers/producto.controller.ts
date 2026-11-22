// ============================================================
// src/server/controllers/producto.controller.ts
// ============================================================
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Servicios } from "../services/container.factory";

export function crearProductoController(servicios: Servicios) {
  return {
    buscar: async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      return reply.send(await servicios.productos.buscar(req.query));
    },

    porCodigoBarras: async (
      req: FastifyRequest<{ Params: { codigo: string } }>,
      reply: FastifyReply
    ): Promise<FastifyReply> => {
      return reply.send(await servicios.productos.porCodigoBarras(req.params.codigo));
    },

    obtener: async (
      req: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply
    ): Promise<FastifyReply> => {
      return reply.send(await servicios.productos.obtener(req.params.id));
    },
  };
}

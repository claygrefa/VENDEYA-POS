// ============================================================
// src/server/controllers/venta.controller.ts
// ============================================================
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Servicios } from "../services/container.factory";
import { actorDe } from "./actor.util";

export function crearVentaController(servicios: Servicios) {
  return {
    crear: async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      const actor = actorDe(req);
      const venta = await servicios.ventas.crear(req.body, actor);
      // El ticket y la gaveta se atienden aparte: la respuesta de la venta no espera a la impresora ni depende de ella
      void servicios.impresion.alCobrar(venta.id, actor);
      return reply.status(201).send(venta);
    },

    anular: async (
      req: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply
    ): Promise<FastifyReply> => {
      return reply.send(await servicios.ventas.anular(req.params.id, req.body, actorDe(req)));
    },

    obtener: async (
      req: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply
    ): Promise<FastifyReply> => {
      return reply.send(await servicios.ventas.obtener(req.params.id, actorDe(req)));
    },
  };
}

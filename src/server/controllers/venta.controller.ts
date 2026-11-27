// ============================================================
// src/server/controllers/venta.controller.ts
// ============================================================
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Servicios } from "../services/container.factory";
import { descartarIntento } from "../services/intentoCobro.service";
import { actorDe } from "./actor.util";

export function crearVentaController(servicios: Servicios) {
  return {
    crear: async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      const actor = actorDe(req);
      const resultado = await servicios.ventas.registrarCobro(req.body, actor, (tx) =>
        servicios.licencia.exigirVigente(actor.empresaId, tx));
      // El ticket y la gaveta se atienden aparte: la respuesta de la venta no espera a la impresora ni depende de ella
      if (!resultado.repetido) void servicios.impresion.alCobrar(resultado.valor.id, actor);
      return reply.status(201).send(resultado.valor);
    },

    /** La caja descarta un cobro que no logra confirmar. 409 si el servidor ya lo había registrado (hay que recuperarlo). */
    descartarCobro: async (
      req: FastifyRequest<{ Params: { intentoId: string } }>,
      reply: FastifyReply
    ): Promise<FastifyReply> => {
      await descartarIntento(servicios.prisma, actorDe(req), req.params.intentoId);
      return reply.send({ estado: "DESCARTADO" });
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

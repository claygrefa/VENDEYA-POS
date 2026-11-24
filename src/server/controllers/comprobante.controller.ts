// ============================================================
// src/server/controllers/comprobante.controller.ts — Comprobantes electrónicos SRI
// ============================================================
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Servicios } from "../services/container.factory";
import { actorDe } from "./actor.util";

type ConId = FastifyRequest<{ Params: { id: string } }>;

export function crearComprobanteController(servicios: Servicios) {
  return {
    listar: async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> =>
      reply.send(await servicios.comprobantes.listar(req.query, actorDe(req))),

    obtener: async (req: ConId, reply: FastifyReply): Promise<FastifyReply> =>
      reply.send(await servicios.comprobantes.obtener(req.params.id, actorDe(req))),

    /** 201 si se generó la factura; 200 si la venta ya la tenía (idempotente). */
    emitirFactura: async (req: ConId, reply: FastifyReply): Promise<FastifyReply> => {
      const r = await servicios.comprobantes.emitirFactura(req.params.id, req.body, actorDe(req));
      return reply.status(r.creado ? 201 : 200).send(r);
    },
  };
}

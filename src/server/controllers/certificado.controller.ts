// ============================================================
// src/server/controllers/certificado.controller.ts — Certificado digital y firma de comprobantes
// ============================================================
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Servicios } from "../services/container.factory";
import { actorDe } from "./actor.util";

type ConId = FastifyRequest<{ Params: { id: string } }>;

export function crearCertificadoController(servicios: Servicios) {
  return {
    guardar: async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> =>
      reply.send(await servicios.certificados.guardar(req.body, actorDe(req))),

    informacion: async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> =>
      reply.send(await servicios.certificados.informacion(actorDe(req))),

    eliminar: async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      await servicios.certificados.eliminar(actorDe(req));
      return reply.status(204).send();
    },

    rotarClave: async (_req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> =>
      reply.send(await servicios.certificados.rotarClaveMaestra()),

    firmar: async (req: ConId, reply: FastifyReply): Promise<FastifyReply> =>
      reply.send(await servicios.firma.firmarComprobante(req.params.id, actorDe(req))),
  };
}

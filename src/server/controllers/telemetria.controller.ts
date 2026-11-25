// ============================================================
// src/server/controllers/telemetria.controller.ts — Telemetría opcional de errores
// ============================================================
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Servicios } from "../services/container.factory";

export function crearTelemetriaController(servicios: Servicios) {
  return {
    /** Cualquier usuario con sesión: la interfaz necesita saber si debe reportar */
    estado: async (_req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => reply.send(servicios.telemetria.estado()),

    /** La interfaz informa un error; sin consentimiento el servidor lo descarta (204 igualmente: la interfaz no necesita saberlo) */
    registrar: async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      servicios.telemetria.registrar(req.body);
      return reply.status(204).send();
    },

    configurar: async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => reply.send(servicios.telemetria.configurar(req.body)),

    pendientes: async (_req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> =>
      reply.send({ reportes: servicios.telemetria.pendientes(), estado: servicios.telemetria.estado() }),

    descartar: async (_req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> =>
      reply.send({ descartados: servicios.telemetria.descartar(), estado: servicios.telemetria.estado() }),

    enviar: async (_req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      const enviados = await servicios.telemetria.enviar();
      return reply.send({ enviados, estado: servicios.telemetria.estado() });
    },
  };
}

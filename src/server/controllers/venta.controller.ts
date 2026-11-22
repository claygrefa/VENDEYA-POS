// ============================================================
// src/server/controllers/venta.controller.ts
// ============================================================
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Servicios } from "../services/container.factory";
import { AppError } from "../services/appError.util";
import type { ActorVenta } from "../services/venta.service";

function actorDe(req: FastifyRequest): ActorVenta {
  if (req.usuario === null) throw new AppError("CREDENCIALES_INVALIDAS", "Sesión requerida");
  return { id: req.usuario.id, empresaId: req.usuario.empresaId };
}

export function crearVentaController(servicios: Servicios) {
  return {
    crear: async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      const venta = await servicios.ventas.crear(req.body, actorDe(req));
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

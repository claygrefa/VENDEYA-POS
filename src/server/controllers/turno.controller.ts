// ============================================================
// src/server/controllers/turno.controller.ts
// ============================================================
import type { FastifyReply, FastifyRequest } from "fastify";
import { TurnoActualQuerySchema } from "../../shared/schemas/turno.schema";
import type { Servicios } from "../services/container.factory";
import { parsear } from "../services/validation.util";
import { actorDe } from "./actor.util";

type ConId = FastifyRequest<{ Params: { id: string } }>;

export function crearTurnoController(servicios: Servicios) {
  return {
    abrir: async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> =>
      reply.status(201).send(await servicios.turnos.abrir(req.body, actorDe(req))),

    actual: async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      const { sucursalId } = parsear(TurnoActualQuerySchema, req.query ?? {});
      return reply.send(await servicios.turnos.actual(actorDe(req), sucursalId));
    },

    movimiento: async (req: ConId, reply: FastifyReply): Promise<FastifyReply> =>
      reply.status(201).send(await servicios.turnos.registrarMovimiento(req.params.id, req.body, actorDe(req))),

    cerrar: async (req: ConId, reply: FastifyReply): Promise<FastifyReply> =>
      reply.send(await servicios.turnos.cerrar(req.params.id, req.body, actorDe(req))),

    reporte: async (req: ConId, reply: FastifyReply): Promise<FastifyReply> =>
      reply.send(await servicios.turnos.reporte(req.params.id, actorDe(req))),
  };
}

// ============================================================
// src/server/controllers/licencia.controller.ts — Estado y gestión de la licencia
// ============================================================
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Servicios } from "../services/container.factory";
import { actorDe } from "./actor.util";

export function crearLicenciaController(servicios: Servicios) {
  return {
    estado: async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => reply.send(await servicios.licencia.estado(actorDe(req).empresaId)),

    activar: async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => reply.send(await servicios.licencia.activar(req.body, actorDe(req))),

    /** Valida ahora en línea (el botón «Validar ahora»). Si no hay conexión responde 200 con el estado y el motivo en `error`. */
    validar: async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => reply.send(await servicios.licencia.validarEnLinea(actorDe(req).empresaId)),

    desactivar: async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => reply.send(await servicios.licencia.desactivar(actorDe(req))),

    dispositivos: async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => reply.send(await servicios.licencia.dispositivos(actorDe(req))),

    liberar: async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply): Promise<FastifyReply> =>
      reply.send(await servicios.licencia.liberar(req.params.id, actorDe(req))),
  };
}

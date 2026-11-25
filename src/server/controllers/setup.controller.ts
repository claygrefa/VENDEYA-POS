// ============================================================
// src/server/controllers/setup.controller.ts — Asistente de configuración inicial y ajustes del negocio
// ============================================================
import type { FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "../services/appError.util";
import type { Servicios } from "../services/container.factory";
import { actorDe } from "./actor.util";

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/**
 * El alta inicial no tiene sesión (todavía no hay usuarios): solo se acepta desde este mismo equipo, así nadie en la red
 * local puede adelantarse al dueño y configurar el sistema si el servidor escucha en toda la red.
 */
function exigirEquipoLocal(req: FastifyRequest): void {
  if (!LOOPBACK.has(req.ip)) throw new AppError("SIN_PERMISO", "El asistente de configuración solo se puede usar desde este equipo");
}

export function crearSetupController(servicios: Servicios) {
  return {
    estado: async (_req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => reply.send(await servicios.setup.estado()),

    inicializar: async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      exigirEquipoLocal(req);
      return reply.status(201).send(await servicios.setup.inicializar(req.body));
    },

    validarCertificado: async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      exigirEquipoLocal(req);
      return reply.send(await servicios.setup.validarCertificado(req.body));
    },

    ajustes: async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => reply.send(await servicios.configuracion.obtener(actorDe(req))),
    actualizarEmpresa: async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => reply.send(await servicios.configuracion.actualizarEmpresa(req.body, actorDe(req))),
    actualizarModulos: async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => reply.send(await servicios.configuracion.actualizarModulos(req.body, actorDe(req))),
    aplicarGiro: async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => reply.send(await servicios.configuracion.aplicarGiro(req.body, actorDe(req))),
  };
}

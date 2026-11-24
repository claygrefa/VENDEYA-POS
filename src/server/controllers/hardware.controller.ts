// ============================================================
// src/server/controllers/hardware.controller.ts — Escaneo de códigos, balanza serial y cajas conectadas
// ============================================================
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Servicios } from "../services/container.factory";
import { actorDe } from "./actor.util";

export function crearHardwareController(servicios: Servicios) {
  return {
    /** Qué producto y cuánta cantidad representa un código escaneado (producto, presentación o etiqueta de balanza). */
    escanear: async (req: FastifyRequest<{ Params: { codigo: string } }>, reply: FastifyReply): Promise<FastifyReply> =>
      reply.send(await servicios.escaneo.resolver(req.params.codigo, actorDe(req))),

    balanza: async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> =>
      reply.send(await servicios.balanza.obtenerConfiguracion(actorDe(req))),

    configurarBalanza: async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> =>
      reply.send(await servicios.balanza.configurar(req.body, actorDe(req))),

    peso: async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> =>
      reply.send(await servicios.balanza.leerPeso(req.query, actorDe(req))),

    /** Sucursales y puntos de emisión donde esta caja puede abrir turno y vender. */
    puntosEmision: async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> =>
      reply.send({ items: await servicios.empresas.puntosEmision(actorDe(req).empresaId) }),

    cajasConectadas: async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> =>
      reply.send({ cajas: servicios.sync.cajasConectadas(actorDe(req).empresaId) }),
  };
}

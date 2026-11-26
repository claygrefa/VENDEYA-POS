// ============================================================
// src/server/controllers/sucursal.controller.ts — Sucursales y puntos de emisión (administrador)
// ============================================================
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Servicios } from "../services/container.factory";
import { actorDe } from "./actor.util";

type ConId = FastifyRequest<{ Params: { id: string } }>;

export function crearSucursalController(servicios: Servicios) {
  const sucursales = servicios.sucursales;
  const empresa = (req: FastifyRequest): { empresaId: string } => ({ empresaId: actorDe(req).empresaId });
  return {
    listar: async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => reply.send(await sucursales.listar(empresa(req))),

    crear: async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => reply.status(201).send(await sucursales.crear(empresa(req), req.body)),

    actualizar: async (req: ConId, reply: FastifyReply): Promise<FastifyReply> => reply.send(await sucursales.actualizar(empresa(req), req.params.id, req.body)),

    estado: async (req: ConId, reply: FastifyReply): Promise<FastifyReply> => reply.send(await sucursales.cambiarEstado(empresa(req), req.params.id, req.body)),

    crearPunto: async (req: ConId, reply: FastifyReply): Promise<FastifyReply> => reply.status(201).send(await sucursales.crearPunto(empresa(req), req.params.id, req.body)),

    actualizarPunto: async (req: ConId, reply: FastifyReply): Promise<FastifyReply> => reply.send(await sucursales.actualizarPunto(empresa(req), req.params.id, req.body)),
  };
}

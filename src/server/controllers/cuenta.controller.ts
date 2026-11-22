// ============================================================
// src/server/controllers/cuenta.controller.ts — Compras y cuentas por cobrar / pagar
// ============================================================
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Servicios } from "../services/container.factory";
import { actorDe } from "./actor.util";

type ConId = FastifyRequest<{ Params: { id: string } }>;

export function crearCuentaController(servicios: Servicios) {
  return {
    // ── Compras ──────────────────────────────────────────────
    crearCompra: async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> =>
      reply.status(201).send(await servicios.compras.crear(req.body, actorDe(req))),

    obtenerCompra: async (req: ConId, reply: FastifyReply): Promise<FastifyReply> =>
      reply.send(await servicios.compras.obtener(req.params.id, actorDe(req))),

    // ── Por cobrar ───────────────────────────────────────────
    listarCxC: async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> =>
      reply.send(await servicios.cuentasPorCobrar.listar(req.query, actorDe(req))),

    obtenerCxC: async (req: ConId, reply: FastifyReply): Promise<FastifyReply> =>
      reply.send(await servicios.cuentasPorCobrar.obtener(req.params.id, actorDe(req))),

    abonarCxC: async (req: ConId, reply: FastifyReply): Promise<FastifyReply> =>
      reply.status(201).send(await servicios.cuentasPorCobrar.registrarAbono(req.params.id, req.body, actorDe(req))),

    // ── Por pagar ────────────────────────────────────────────
    listarCxP: async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> =>
      reply.send(await servicios.cuentasPorPagar.listar(req.query, actorDe(req))),

    obtenerCxP: async (req: ConId, reply: FastifyReply): Promise<FastifyReply> =>
      reply.send(await servicios.cuentasPorPagar.obtener(req.params.id, actorDe(req))),

    pagarCxP: async (req: ConId, reply: FastifyReply): Promise<FastifyReply> =>
      reply.status(201).send(await servicios.cuentasPorPagar.registrarPago(req.params.id, req.body, actorDe(req))),
  };
}

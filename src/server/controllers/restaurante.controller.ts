// ============================================================
// src/server/controllers/restaurante.controller.ts — Mesas, comandas, cocina y cobro
// ============================================================
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Servicios } from "../services/container.factory";
import { actorDe } from "./actor.util";

type ConId = FastifyRequest<{ Params: { id: string } }>;
type ConItem = FastifyRequest<{ Params: { id: string; itemId: string } }>;

export function crearRestauranteController(servicios: Servicios) {
  return {
    // ── Mesas ────────────────────────────────────────────────
    listarMesas: async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> =>
      reply.send(await servicios.mesas.listar(req.query, actorDe(req))),

    crearMesa: async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> =>
      reply.status(201).send(await servicios.mesas.crear(req.body, actorDe(req))),

    actualizarMesa: async (req: ConId, reply: FastifyReply): Promise<FastifyReply> =>
      reply.send(await servicios.mesas.actualizar(req.params.id, req.body, actorDe(req))),

    estadoMesa: async (req: ConId, reply: FastifyReply): Promise<FastifyReply> =>
      reply.send(await servicios.mesas.cambiarEstado(req.params.id, req.body, actorDe(req))),

    // ── Comandas ─────────────────────────────────────────────
    abrirComanda: async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> =>
      reply.status(201).send(await servicios.comandas.abrir(req.body, actorDe(req))),

    listarComandas: async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> =>
      reply.send(await servicios.comandas.listar(req.query, actorDe(req))),

    obtenerComanda: async (req: ConId, reply: FastifyReply): Promise<FastifyReply> =>
      reply.send(await servicios.comandas.obtener(req.params.id, actorDe(req))),

    agregarItems: async (req: ConId, reply: FastifyReply): Promise<FastifyReply> =>
      reply.status(201).send(await servicios.comandas.agregarItems(req.params.id, req.body, actorDe(req))),

    cancelarItem: async (req: ConItem, reply: FastifyReply): Promise<FastifyReply> =>
      reply.send(await servicios.comandas.cancelarItem(req.params.id, req.params.itemId, req.body, actorDe(req))),

    estadoItem: async (req: ConItem, reply: FastifyReply): Promise<FastifyReply> =>
      reply.send(await servicios.comandas.cambiarEstadoItem(req.params.id, req.params.itemId, req.body, actorDe(req))),

    enviar: async (req: ConId, reply: FastifyReply): Promise<FastifyReply> =>
      reply.status(201).send(await servicios.comandas.enviar(req.params.id, actorDe(req))),

    mover: async (req: ConId, reply: FastifyReply): Promise<FastifyReply> =>
      reply.send(await servicios.comandas.mover(req.params.id, req.body, actorDe(req))),

    unir: async (req: ConId, reply: FastifyReply): Promise<FastifyReply> =>
      reply.send(await servicios.comandas.unir(req.params.id, req.body, actorDe(req))),

    preCuenta: async (req: ConId, reply: FastifyReply): Promise<FastifyReply> =>
      reply.send(await servicios.comandas.preCuenta(req.params.id, req.query, actorDe(req))),

    cobrar: async (req: ConId, reply: FastifyReply): Promise<FastifyReply> =>
      reply.status(201).send(await servicios.comandas.cobrar(req.params.id, req.body, actorDe(req))),

    anularComanda: async (req: ConId, reply: FastifyReply): Promise<FastifyReply> =>
      reply.send(await servicios.comandas.anular(req.params.id, req.body, actorDe(req))),

    // ── Cocina ───────────────────────────────────────────────
    pendientesCocina: async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> =>
      reply.send(await servicios.comandas.pendientesCocina(req.query, actorDe(req))),
  };
}

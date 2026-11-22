// ============================================================
// src/server/controllers/inventario.controller.ts
// Catálogo, presentaciones, listas de precios, lotes, ajustes, Kardex y alertas
// ============================================================
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Servicios } from "../services/container.factory";
import { actorDe } from "./actor.util";

type ConId = FastifyRequest<{ Params: { id: string } }>;
type ConIdYPrecio = FastifyRequest<{ Params: { id: string; precioId: string } }>;

export function crearInventarioController(servicios: Servicios) {
  return {
    // ── Catálogo ─────────────────────────────────────────────
    crearProducto: async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> =>
      reply.status(201).send(await servicios.inventario.crearProducto(req.body, actorDe(req))),

    actualizarProducto: async (req: ConId, reply: FastifyReply): Promise<FastifyReply> =>
      reply.send(await servicios.inventario.actualizarProducto(req.params.id, req.body, actorDe(req))),

    // ── Presentaciones ───────────────────────────────────────
    listarPresentaciones: async (req: ConId, reply: FastifyReply): Promise<FastifyReply> =>
      reply.send(await servicios.presentaciones.listar(req.params.id)),

    crearPresentacion: async (req: ConId, reply: FastifyReply): Promise<FastifyReply> =>
      reply.status(201).send(await servicios.presentaciones.crear(req.params.id, req.body)),

    actualizarPresentacion: async (req: ConId, reply: FastifyReply): Promise<FastifyReply> =>
      reply.send(await servicios.presentaciones.actualizar(req.params.id, req.body)),

    // ── Listas de precios ────────────────────────────────────
    listarListas: async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> =>
      reply.send(await servicios.listasPrecio.listar(actorDe(req))),

    crearLista: async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> =>
      reply.status(201).send(await servicios.listasPrecio.crear(req.body, actorDe(req))),

    actualizarLista: async (req: ConId, reply: FastifyReply): Promise<FastifyReply> =>
      reply.send(await servicios.listasPrecio.actualizar(req.params.id, req.body, actorDe(req))),

    listarPrecios: async (req: ConId, reply: FastifyReply): Promise<FastifyReply> =>
      reply.send(await servicios.listasPrecio.precios(req.params.id, actorDe(req))),

    fijarPrecio: async (req: ConId, reply: FastifyReply): Promise<FastifyReply> =>
      reply.send(await servicios.listasPrecio.fijarPrecio(req.params.id, req.body, actorDe(req))),

    quitarPrecio: async (req: ConIdYPrecio, reply: FastifyReply): Promise<FastifyReply> => {
      await servicios.listasPrecio.quitarPrecio(req.params.id, req.params.precioId, actorDe(req));
      return reply.status(204).send();
    },

    asignarListaACliente: async (req: ConId, reply: FastifyReply): Promise<FastifyReply> =>
      reply.send(await servicios.listasPrecio.asignarACliente(req.params.id, req.body, actorDe(req))),

    // ── Lotes ────────────────────────────────────────────────
    listarLotes: async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> =>
      reply.send(await servicios.lotes.listar(req.query, actorDe(req))),

    crearLote: async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> =>
      reply.status(201).send(await servicios.lotes.crear(req.body, actorDe(req))),

    obtenerLote: async (req: ConId, reply: FastifyReply): Promise<FastifyReply> =>
      reply.send(await servicios.lotes.obtener(req.params.id, actorDe(req))),

    actualizarLote: async (req: ConId, reply: FastifyReply): Promise<FastifyReply> =>
      reply.send(await servicios.lotes.actualizar(req.params.id, req.body, actorDe(req))),

    // ── Ajustes, Kardex y alertas ────────────────────────────
    ajustar: async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> =>
      reply.status(201).send(await servicios.inventario.ajustar(req.body, actorDe(req))),

    kardex: async (req: ConId, reply: FastifyReply): Promise<FastifyReply> =>
      reply.send(await servicios.inventario.kardexDe(req.params.id, req.query)),

    alertasVencimiento: async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> =>
      reply.send(await servicios.inventario.alertasVencimiento(req.query, actorDe(req))),

    alertasStock: async (_req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> =>
      reply.send(await servicios.inventario.alertasStock()),
  };
}

// ============================================================
// src/server/controllers/comprobante.controller.ts — Comprobantes electrónicos SRI
// ============================================================
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Servicios } from "../services/container.factory";
import { actorDe } from "./actor.util";

type ConId = FastifyRequest<{ Params: { id: string } }>;

export function crearComprobanteController(servicios: Servicios) {
  return {
    listar: async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> =>
      reply.send(await servicios.comprobantes.listar(req.query, actorDe(req))),

    obtener: async (req: ConId, reply: FastifyReply): Promise<FastifyReply> =>
      reply.send(await servicios.comprobantes.obtener(req.params.id, actorDe(req))),

    /** 201 si se generó la factura; 200 si la venta ya la tenía (idempotente). */
    emitirFactura: async (req: ConId, reply: FastifyReply): Promise<FastifyReply> => {
      const r = await servicios.comprobantes.emitirFactura(req.params.id, req.body, actorDe(req));
      return reply.status(r.creado ? 201 : 200).send(r);
    },

    /** 201 si se generó la retención; 200 si la compra ya la tenía. */
    emitirRetencion: async (req: ConId, reply: FastifyReply): Promise<FastifyReply> => {
      const r = await servicios.documentosSri.emitirRetencion(req.params.id, req.body, actorDe(req));
      return reply.status(r.creado ? 201 : 200).send(r);
    },

    /** 201 si se generó la liquidación; 200 si la compra ya la tenía. */
    emitirLiquidacion: async (req: ConId, reply: FastifyReply): Promise<FastifyReply> => {
      const r = await servicios.documentosSri.emitirLiquidacion(req.params.id, req.body, actorDe(req));
      return reply.status(r.creado ? 201 : 200).send(r);
    },

    emitirGuiaRemision: async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      const r = await servicios.documentosSri.emitirGuiaRemision(req.body, actorDe(req));
      return reply.status(201).send(r);
    },

    /** ATS del periodo: el XML como descarga, o `?formato=json` con el resumen. */
    ats: async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      const r = await servicios.ats.generar(req.query, actorDe(req));
      if ((req.query as { formato?: string } | undefined)?.formato === "json") return reply.send(r);
      const nombre = `ATS-${r.resumen.anio}-${String(r.resumen.mes).padStart(2, "0")}.xml`;
      return reply
        .header("Content-Type", "application/xml; charset=utf-8")
        .header("Content-Disposition", `attachment; filename="${nombre}"`)
        .send(r.xml);
    },

    /** Estado de la cola de envíos al SRI de la empresa. */
    estadoCola: async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> =>
      reply.send(await servicios.envioSri.estadoCola(actorDe(req))),

    /** Fuerza un nuevo envío al SRI del comprobante (PENDIENTE, RECHAZADO o DEVUELTO). */
    reintentar: async (req: ConId, reply: FastifyReply): Promise<FastifyReply> =>
      reply.send(await servicios.envioSri.reintentar(req.params.id, actorDe(req))),
  };
}

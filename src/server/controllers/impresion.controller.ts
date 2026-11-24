// ============================================================
// src/server/controllers/impresion.controller.ts — Impresora térmica, gaveta y RIDE
// ============================================================
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Servicios } from "../services/container.factory";
import { actorDe } from "./actor.util";

type ConId = FastifyRequest<{ Params: { id: string } }>;

export function crearImpresionController(servicios: Servicios) {
  return {
    configuracion: async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> =>
      reply.send(await servicios.impresion.obtenerConfiguracion(actorDe(req))),

    configurar: async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> =>
      reply.send(await servicios.impresion.configurar(req.body, actorDe(req))),

    probar: async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      await servicios.impresion.probar(actorDe(req));
      return reply.status(204).send();
    },

    gaveta: async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      await servicios.impresion.abrirGaveta(actorDe(req));
      return reply.status(204).send();
    },

    reimprimirVenta: async (req: ConId, reply: FastifyReply): Promise<FastifyReply> => {
      await servicios.impresion.reimprimirVenta(req.params.id, actorDe(req));
      return reply.status(204).send();
    },

    imprimirArqueo: async (req: ConId, reply: FastifyReply): Promise<FastifyReply> => {
      await servicios.impresion.imprimirArqueo(req.params.id, actorDe(req));
      return reply.status(204).send();
    },

    /** RIDE en PDF: en línea para verlo en pantalla, o `?descargar=1` como archivo. */
    ride: async (req: FastifyRequest<{ Params: { id: string }; Querystring: { descargar?: string } }>, reply: FastifyReply): Promise<FastifyReply> => {
      const r = await servicios.ride.generar(req.params.id, actorDe(req));
      const modo = req.query.descargar === "1" ? "attachment" : "inline";
      return reply
        .header("Content-Type", "application/pdf")
        .header("Content-Disposition", `${modo}; filename="${r.nombreArchivo}"`)
        .header("X-Comprobante-Autorizado", r.autorizado ? "SI" : "NO")
        .send(r.pdf);
    },
  };
}

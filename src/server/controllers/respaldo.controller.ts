// ============================================================
// src/server/controllers/respaldo.controller.ts — Respaldos locales y copia cifrada en la nube (solo administrador)
// ============================================================
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Servicios } from "../services/container.factory";

export function crearRespaldoController(servicios: Servicios) {
  const resumen = () => ({
    locales: servicios.respaldos.listar().map((r) => ({ archivo: r.archivo, motivo: r.motivo, creado: r.creado.toISOString(), bytes: r.bytes })),
    nube: servicios.respaldoNube.estado(),
  });

  return {
    estado: async (_req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => reply.send(resumen()),

    crear: async (_req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      const ruta = await servicios.respaldos.crear("manual");
      return reply.status(201).send({ archivo: ruta.split(/[\\/]/).pop(), ...resumen() });
    },

    configurarNube: async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> =>
      reply.send(servicios.respaldoNube.configurar(req.body)),

    quitarNube: async (_req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => reply.send(servicios.respaldoNube.quitar()),

    exportarNube: async (_req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      const r = await servicios.respaldoNube.exportar();
      return reply.status(201).send({ archivo: r.archivo, bytes: r.bytes, nube: servicios.respaldoNube.estado() });
    },
  };
}

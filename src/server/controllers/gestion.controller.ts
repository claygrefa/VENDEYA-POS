// ============================================================
// src/server/controllers/gestion.controller.ts — Proveedores, listados, catálogos y reportes de las vistas de gestión
// ============================================================
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Servicios } from "../services/container.factory";
import { reporteACsv } from "../services/reporte.service";
import { actorDe } from "./actor.util";

type ConId = FastifyRequest<{ Params: { id: string } }>;

export function crearGestionController(servicios: Servicios) {
  return {
    // ── Clientes (alta y edición) ──
    crearCliente: async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => reply.status(201).send(await servicios.clientes.crear(req.body)),
    actualizarCliente: async (req: ConId, reply: FastifyReply): Promise<FastifyReply> => reply.send(await servicios.clientes.actualizar(req.params.id, req.body)),

    // ── Proveedores ──
    buscarProveedores: async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => reply.send(await servicios.proveedores.buscar(req.query)),
    crearProveedor: async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => reply.status(201).send(await servicios.proveedores.crear(req.body)),
    actualizarProveedor: async (req: ConId, reply: FastifyReply): Promise<FastifyReply> => reply.send(await servicios.proveedores.actualizar(req.params.id, req.body)),

    // ── Listados y catálogos ──
    listarVentas: async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => reply.send(await servicios.consultas.ventas(req.query, actorDe(req))),
    listarCompras: async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => reply.send(await servicios.consultas.compras(req.query, actorDe(req))),
    catalogos: async (_req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => reply.send(await servicios.consultas.catalogos()),

    /** Reporte en JSON o, con `?formato=csv`, como archivo CSV (exige reportes:exportar). */
    reporte: async (req: FastifyRequest<{ Params: { tipo: string } }>, reply: FastifyReply): Promise<FastifyReply> => {
      const r = await servicios.reportes.generar(req.params.tipo, req.query, actorDe(req));
      if ((req.query as { formato?: string } | undefined)?.formato !== "csv") return reply.send(r);
      const nombre = `reporte-${r.tipo}${r.desde !== null ? `-${r.desde}` : ""}${r.hasta !== null ? `_${r.hasta}` : ""}.csv`;
      return reply.header("Content-Type", "text/csv; charset=utf-8").header("Content-Disposition", `attachment; filename="${nombre}"`).send(reporteACsv(r));
    },
  };
}

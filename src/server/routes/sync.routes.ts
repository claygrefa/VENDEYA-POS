// ============================================================
// src/server/routes/sync.routes.ts — WebSocket de sincronización entre cajas y difusión de los cambios
//
//   GET /api/sync?token=<sesión>&cajaId=<nombre>&desde=<último seq>   (WebSocket)
// El navegador/renderer no puede poner cabeceras en un WebSocket, por eso el token viaja en la URL (red local).
// ============================================================
import fastifyWebsocket from "@fastify/websocket";
import type { FastifyInstance } from "fastify";
import type { Servicios } from "../services/container.factory";
import { limpiarCajaId } from "../services/sync/sync.service";

const METODOS_QUE_CAMBIAN = new Set(["POST", "PUT", "PATCH", "DELETE"]);
/** Módulos cuyas operaciones no cambian datos compartidos entre cajas. */
const MODULOS_SIN_EVENTO = new Set(["auth", "sync", "impresora", "balanza", "escaneo", "reportes", "health", "respaldos", "telemetria", "cobros"]);

export async function registrarSync(server: FastifyInstance, servicios: Servicios): Promise<void> {
  await server.register(fastifyWebsocket, { options: { maxPayload: 16 * 1024 } });

  server.get("/api/sync", { websocket: true }, (socket, req) => {
    const q = req.query as { token?: string; cajaId?: string; desde?: string };
    const token = typeof q.token === "string" && q.token !== "" ? q.token : null;
    void servicios.sync.conectar(socket, { token, cajaId: q.cajaId ?? req.headers["x-caja-id"], desde: q.desde }).catch(() => {
      socket.close(1011, "Error interno");
    });
  });

  // Cada operación que modifica datos (y termina bien) se anuncia a las demás cajas
  server.addHook("onResponse", async (req, reply) => {
    if (reply.statusCode >= 400 || !METODOS_QUE_CAMBIAN.has(req.method) || req.usuario === null) return;
    const patron = req.routeOptions.url ?? "";
    const modulo = patron.split("/")[2];
    if (modulo === undefined || modulo === "" || MODULOS_SIN_EVENTO.has(modulo)) return;
    const params = (req.params ?? {}) as Record<string, unknown>;
    const ids: Record<string, string> = {};
    for (const [k, v] of Object.entries(params)) if (typeof v === "string") ids[k] = v;
    await servicios.sync.publicar({
      empresaId: req.usuario.empresaId,
      modulo,
      accion: req.method,
      ruta: patron,
      ids,
      usuarioId: req.usuario.id,
      cajaId: limpiarCajaId(req.headers["x-caja-id"]),
    });
  });

  server.addHook("onClose", async () => {
    servicios.sync.detener();
  });
}

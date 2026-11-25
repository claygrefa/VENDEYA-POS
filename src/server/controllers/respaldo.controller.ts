// ============================================================
// src/server/controllers/respaldo.controller.ts — Respaldos locales, copia cifrada en la nube y restauración (solo administrador)
// ============================================================
import type { FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "../services/appError.util";
import type { Servicios } from "../services/container.factory";

export function crearRespaldoController(servicios: Servicios) {
  const resumen = () => ({
    locales: servicios.respaldos.listar().map((r) => ({ archivo: r.archivo, motivo: r.motivo, creado: r.creado.toISOString(), bytes: r.bytes })),
    nube: servicios.respaldoNube.estado(),
    restauracionPendiente: servicios.restauracion.pendiente(),
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

    /**
     * Prepara la restauración. Es una operación que reemplaza TODOS los datos del negocio: además de ser administrador se exige volver a
     * escribir su contraseña (con el mismo freno de intentos del inicio de sesión), por si alguien deja la sesión abierta.
     */
    prepararRestauracion: async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      const cuerpo = (req.body ?? {}) as { password?: unknown };
      if (req.usuario === null) throw new AppError("CREDENCIALES_INVALIDAS", "Sesión requerida");
      if (typeof cuerpo.password !== "string" || cuerpo.password === "") throw new AppError("VALIDACION", "Escriba su contraseña para confirmar la restauración");
      try {
        await servicios.usuarios.autenticar({ username: req.usuario.username, password: cuerpo.password }, req.ip);
      } catch (e) {
        // Un 401 haría que la interfaz cierre la sesión: una contraseña mal escrita al confirmar no es una sesión inválida
        if (e instanceof AppError && e.codigo === "CREDENCIALES_INVALIDAS") throw new AppError("VALIDACION", "La contraseña no es correcta");
        throw e;
      }
      const pendiente = await servicios.restauracion.preparar(req.body);
      return reply.status(202).send({ pendiente, ...resumen() });
    },

    cancelarRestauracion: async (_req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      servicios.restauracion.cancelar();
      return reply.send(resumen());
    },
  };
}

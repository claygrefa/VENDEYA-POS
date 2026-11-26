import { createHash, randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { AppError, type CodigoError } from "./appError.util";

const TX_OPCIONES = { maxWait: 30_000, timeout: 60_000 };
export type ResultadoIntento<T> =
  | { repetido: false; valor: T }
  | { repetido: true; valor: unknown };

export async function confirmarIntento<T>(
  prisma: PrismaClient,
  actor: { id: string; empresaId: string },
  intentoId: string | undefined,
  contenido: unknown,
  ejecutar: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<ResultadoIntento<T>> {
  const id = intentoId ?? randomUUID();
  const huella = createHash("sha256").update(JSON.stringify(contenido)).digest("hex");
  const resultado = await prisma.$transaction(async (tx) => {
    // La primera escritura serializa reintentos concurrentes incluso desde otras conexiones.
    await tx.$executeRaw`INSERT INTO "IntentoCobro" ("id", "empresaId", "cajeroId", "huella", "estado")
      VALUES (${id}, ${actor.empresaId}, ${actor.id}, ${huella}, 'PENDING') ON CONFLICT ("id") DO NOTHING`;
    const intento = await tx.intentoCobro.findUniqueOrThrow({ where: { id } });
    if (intento.empresaId !== actor.empresaId || intento.cajeroId !== actor.id || intento.huella !== huella) {
      throw new AppError("DUPLICADO", "La clave de cobro ya está asociada a otra solicitud");
    }
    if (intento.estado === "CONFIRMED" && intento.respuesta !== null) {
      return { repetido: true, valor: JSON.parse(intento.respuesta) as unknown } as const;
    }
    if (intento.estado === "FAILED" && intento.errorCodigo !== null && intento.errorMensaje !== null) {
      return new AppError(intento.errorCodigo as CodigoError, intento.errorMensaje);
    }
    if (intento.estado !== "PENDING") throw new Error("Resultado del cobro incompleto");

    // Un rechazo de negocio conserva su resultado y revierte cualquier efecto de la venta.
    await tx.$executeRaw`SAVEPOINT venta`;
    let valor: T;
    try {
      valor = await ejecutar(tx);
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      await tx.$executeRaw`ROLLBACK TO SAVEPOINT venta`;
      await tx.$executeRaw`RELEASE SAVEPOINT venta`;
      await tx.intentoCobro.update({
        where: { id },
        data: { estado: "FAILED", errorCodigo: error.codigo, errorMensaje: error.message },
      });
      return error;
    }
    await tx.$executeRaw`RELEASE SAVEPOINT venta`;
    await tx.intentoCobro.update({ where: { id }, data: { estado: "CONFIRMED", respuesta: JSON.stringify(valor) } });
    return { repetido: false, valor } as const;
  }, TX_OPCIONES);
  if (resultado instanceof AppError) throw resultado;
  return resultado;
}

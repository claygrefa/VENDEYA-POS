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

/** Un intento solo se vuelve a ofrecer a la caja durante unas horas; pasado este plazo (en días) la fila ya no sirve para nada. */
export const DIAS_RETENCION_INTENTOS = 30;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Cierra para siempre un cobro que la caja no logra confirmar, SIN riesgo de dejar una venta duplicada o perdida:
 *  - Si el servidor ya lo había registrado (CONFIRMED) se rechaza: la venta existe y hay que recuperarla, no descartarla.
 *  - Si no existía o ya había fallado, queda una «lápida» FAILED/COBRO_DESCARTADO con el mismo UUID: aunque un reintento
 *    rezagado llegue después, no podrá registrar la venta (se rechaza como DUPLICADO), y la fila deja constancia de quién y cuándo.
 * La fila de intento se escribe en la misma transacción que la venta, así que «no hay fila» equivale a «no hay venta».
 */
export async function descartarIntento(prisma: PrismaClient, actor: { id: string; empresaId: string }, intentoId: string): Promise<void> {
  const id = intentoId.toLowerCase();
  if (!UUID.test(id)) throw new AppError("VALIDACION", "La clave del cobro no es válida");
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`INSERT INTO "IntentoCobro" ("id", "empresaId", "cajeroId", "huella", "estado", "errorCodigo", "errorMensaje")
      VALUES (${id}, ${actor.empresaId}, ${actor.id}, 'descartado', 'FAILED', 'COBRO_DESCARTADO', 'El cobro fue descartado en la caja antes de registrarse')
      ON CONFLICT ("id") DO NOTHING`;
    const intento = await tx.intentoCobro.findUniqueOrThrow({ where: { id } });
    if (intento.empresaId !== actor.empresaId || intento.cajeroId !== actor.id) throw new AppError("NO_ENCONTRADO", "Cobro no encontrado");
    if (intento.estado === "CONFIRMED") {
      throw new AppError("ESTADO_INVALIDO", "Este cobro ya se registró en el servidor: use «Recuperar cobro» para obtener la venta");
    }
  }, TX_OPCIONES);
}

/**
 * Borra los intentos resueltos (CONFIRMED o FAILED) con más de `dias` días: guardan la respuesta completa de cada venta y no deben crecer sin límite.
 * Se compara dentro de SQLite: estas filas se insertan con SQL directo y su fecha queda como texto (`CURRENT_TIMESTAMP`), y Prisma compara las
 * fechas como números, por lo que un `deleteMany` con `creadoEn < límite` nunca encontraría nada.
 */
export async function purgarIntentosCobro(prisma: PrismaClient, ahora: Date = new Date(), dias: number = DIAS_RETENCION_INTENTOS): Promise<number> {
  const limite = new Date(ahora.getTime() - dias * 86_400_000).toISOString();
  return prisma.$executeRaw`DELETE FROM "IntentoCobro"
    WHERE "estado" IN ('CONFIRMED', 'FAILED')
      AND (CASE WHEN typeof("creadoEn") = 'integer' THEN datetime("creadoEn" / 1000, 'unixepoch') ELSE datetime("creadoEn") END) < datetime(${limite})`;
}

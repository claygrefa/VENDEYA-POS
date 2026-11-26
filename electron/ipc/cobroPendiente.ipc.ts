import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { CobroPendienteSchema, type CobroPendiente } from "../../src/shared/schemas/venta.schema";
import { renombrarConReintento } from "../../src/server/services/archivo.util";

const Actor = z.object({ empresaId: z.uuid(), cajeroId: z.uuid() });
const Operacion = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("leer"), actor: Actor }),
  z.object({ tipo: z.literal("guardar"), actor: Actor, cobro: CobroPendienteSchema }),
  z.object({ tipo: z.literal("retirar"), actor: Actor, intentoId: z.uuid() }),
]);

/** Borra solo el UUID ya resuelto. La escritura con flush precede a la confirmación hacia el renderer. */
export function operarCobroPendiente(userData: string, entrada: unknown): CobroPendiente | null {
  const operacion = Operacion.parse(entrada);
  const dir = path.join(userData, "cobros-pendientes");
  const { empresaId, cajeroId } = operacion.actor;
  const archivo = path.join(dir, `${empresaId.toLowerCase()}.${cajeroId.toLowerCase()}.json`);
  const previo = existsSync(archivo)
    ? CobroPendienteSchema.parse(JSON.parse(readFileSync(archivo, "utf8")))
    : null;
  if (operacion.tipo === "leer") return previo;
  if (operacion.tipo === "retirar") {
    if (previo?.intentoId === operacion.intentoId) rmSync(archivo);
    return null;
  }
  if (previo !== null) throw new Error("Ya existe un cobro pendiente de recuperar");
  const datos = JSON.stringify(operacion.cobro);
  if (Buffer.byteLength(datos) > 1024 * 1024) throw new Error("El intento de cobro supera el tamaño admitido");
  mkdirSync(dir, { recursive: true });
  const temporal = `${archivo}.tmp`;
  writeFileSync(temporal, datos, { mode: 0o600, flush: true });
  renombrarConReintento(temporal, archivo);
  return operacion.cobro;
}

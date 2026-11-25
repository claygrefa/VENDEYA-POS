// ============================================================
// src/server/services/restauracion.service.ts — Restaurar la base de datos desde un respaldo (local o copia cifrada de la nube)
//
// Con la aplicación abierta la base está en uso, así que la restauración es en DOS tiempos:
//   1. «Preparar» (administrador, con su contraseña): el respaldo elegido se descifra (si hace falta), se VERIFICA como base válida y se
//      deja en `restauracion-pendiente.db` junto a la base, con una nota `restauracion-pendiente.json`. No se toca la base actual.
//   2. Al abrir la aplicación la próxima vez, ANTES de abrir la base, `aplicarRestauracionPendiente` guarda la base actual como
//      `<base>.antes-de-restaurar-<fecha>` (con su WAL), pone la restaurada y continúa el arranque normal (que aplica las migraciones
//      que le falten, con su respaldo previo habitual).
// La frase de la copia cifrada solo se usa en el paso 1 y no se guarda. Sólo se aceptan nombres que existan en la lista de respaldos
// (nada de rutas libres): no hay forma de apuntar a otro archivo del equipo.
// ============================================================
import { copyFileSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import path from "path";
import { z } from "zod";
import { AppError } from "./appError.util";
import type { RespaldoService } from "./respaldo.service";
import { protegerRuta, restaurarRespaldo, verificarRespaldo } from "./respaldo.service";
import type { RespaldoNubeService } from "./respaldoNube.service";
import { parsear } from "./validation.util";

const BASE_PENDIENTE = "restauracion-pendiente.db";
const NOTA_PENDIENTE = "restauracion-pendiente.json";

export const RestaurarSchema = z.discriminatedUnion("origen", [
  z.object({ origen: z.literal("local"), archivo: z.string().min(1).max(200), password: z.string().min(1).max(200) }),
  z.object({ origen: z.literal("nube"), archivo: z.string().min(1).max(200), frase: z.string().min(1).max(200), password: z.string().min(1).max(200) }),
]);

export interface RestauracionPendiente {
  origen: "local" | "nube";
  archivo: string;
  preparada: string;
}

export class RestauracionService {
  constructor(
    private readonly directorioDatos: string,
    private readonly respaldos: RespaldoService,
    private readonly nube: RespaldoNubeService,
    private readonly ahora: () => Date = () => new Date()
  ) {}

  pendiente(): RestauracionPendiente | null {
    try {
      const n = JSON.parse(readFileSync(path.join(this.directorioDatos, NOTA_PENDIENTE), "utf8")) as Partial<RestauracionPendiente>;
      return existsSync(path.join(this.directorioDatos, BASE_PENDIENTE)) && typeof n.archivo === "string" && (n.origen === "local" || n.origen === "nube")
        ? { origen: n.origen, archivo: n.archivo, preparada: String(n.preparada ?? "") }
        : null;
    } catch {
      return null;
    }
  }

  /**
   * Deja lista la restauración. `entrada` ya lleva la contraseña del administrador; QUIEN LLAMA debe haberla verificado antes
   * (el controlador la comprueba con la autenticación normal, con su freno de intentos) y quitarla de lo que pase aquí.
   */
  async preparar(entrada: unknown): Promise<RestauracionPendiente> {
    const datos = parsear(RestaurarSchema, entrada);
    const staging = path.join(this.directorioDatos, BASE_PENDIENTE);
    const temporal = `${staging}.preparando`;
    rmSync(temporal, { force: true });
    try {
      if (datos.origen === "local") {
        const origen = this.respaldos.rutaDe(datos.archivo);
        await verificarRespaldo(origen);
        copyFileSync(origen, temporal);
      } else {
        await this.nube.descifrarCopia(datos.archivo, datos.frase, temporal);
        await verificarRespaldo(temporal);
      }
    } catch (e) {
      rmSync(temporal, { force: true });
      if (e instanceof AppError) throw e;
      throw new AppError("ESTADO_INVALIDO", `El respaldo no es válido: ${e instanceof Error ? e.message : String(e)}`);
    }
    rmSync(staging, { force: true });
    renameSync(temporal, staging);
    protegerRuta(staging, false);
    const nota: RestauracionPendiente = { origen: datos.origen, archivo: datos.archivo, preparada: this.ahora().toISOString() };
    writeFileSync(path.join(this.directorioDatos, NOTA_PENDIENTE), JSON.stringify(nota), { mode: 0o600 });
    return nota;
  }

  cancelar(): boolean {
    const habia = this.pendiente() !== null;
    rmSync(path.join(this.directorioDatos, BASE_PENDIENTE), { force: true });
    rmSync(path.join(this.directorioDatos, NOTA_PENDIENTE), { force: true });
    return habia;
  }
}

/**
 * Se llama al arrancar, con la base CERRADA. Si hay una restauración preparada la aplica y devuelve cuál; si no, null.
 * La base anterior no se borra: queda como `<base>.antes-de-restaurar-<fecha>`.
 */
export function aplicarRestauracionPendiente(dbPath: string, ahora: () => Date = () => new Date()): { archivo: string; copiaAnterior: string | null } | null {
  const dir = path.dirname(dbPath);
  const staging = path.join(dir, BASE_PENDIENTE);
  const notaRuta = path.join(dir, NOTA_PENDIENTE);
  if (!existsSync(staging)) {
    rmSync(notaRuta, { force: true });
    return null;
  }
  let archivo = "(desconocido)";
  try {
    archivo = String((JSON.parse(readFileSync(notaRuta, "utf8")) as { archivo?: string }).archivo ?? archivo);
  } catch {
    /* sin nota legible: se restaura igual, solo se pierde el nombre en el aviso */
  }
  const sello = ahora().toISOString().replace(/[:.]/g, "-");
  let copiaAnterior: string | null = null;
  if (existsSync(dbPath)) {
    copiaAnterior = `${dbPath}.antes-de-restaurar-${sello}`;
    renameSync(dbPath, copiaAnterior);
    for (const sufijo of ["-wal", "-shm"]) if (existsSync(`${dbPath}${sufijo}`)) renameSync(`${dbPath}${sufijo}`, `${copiaAnterior}${sufijo}`);
  }
  rmSync(`${dbPath}-journal`, { force: true });
  restaurarRespaldo(dbPath, staging);
  rmSync(staging, { force: true });
  rmSync(notaRuta, { force: true });
  return { archivo, copiaAnterior };
}

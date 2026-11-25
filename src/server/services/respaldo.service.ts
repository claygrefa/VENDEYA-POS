// ============================================================
// src/server/services/respaldo.service.ts — Respaldos de la base de datos SQLite
//
// Copia consistente con `VACUUM INTO` (incluye lo que aún está en el WAL), verificada con `PRAGMA integrity_check` antes de
// darla por buena, y rotación independiente por motivo (los de migración no desplazan a los de actualización).
// Se usan antes de aplicar migraciones y antes de instalar una actualización de la aplicación.
// ============================================================
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "fs";
import path from "path";
import { crearPrismaPara } from "../config/database.config";

export type MotivoRespaldo = "pre-migracion" | "pre-actualizacion";

export interface Respaldo {
  archivo: string;
  ruta: string;
  motivo: MotivoRespaldo;
  creado: Date;
  bytes: number;
}

const MOTIVOS: ReadonlyArray<MotivoRespaldo> = ["pre-migracion", "pre-actualizacion"];
const prefijoDe = (motivo: MotivoRespaldo): string => `vendeya-${motivo}-`;

/** Lo único que se necesita de la base de datos: ejecutar `VACUUM INTO` */
export interface EjecutorSql {
  $executeRawUnsafe(consulta: string): PromiseLike<unknown>;
}

export class RespaldoService {
  constructor(
    private readonly prisma: EjecutorSql,
    private readonly carpeta: string,
    private readonly maxPorMotivo = 5
  ) {}

  /**
   * Crea y verifica un respaldo. Si la copia no pasa la verificación se borra y se lanza el error: nunca se conserva un
   * respaldo que no sirva (daría una falsa sensación de seguridad). `etiqueta` (p. ej. la versión que se va a instalar) queda en el nombre.
   */
  async crear(motivo: MotivoRespaldo, etiqueta?: string): Promise<string> {
    mkdirSync(this.carpeta, { recursive: true });
    const sello = new Date().toISOString().replace(/[:.]/g, "-");
    const sufijo = etiqueta === undefined ? "" : `-v${etiqueta.replace(/[^0-9A-Za-z.+-]/g, "_")}`;
    const destino = path.join(this.carpeta, `${prefijoDe(motivo)}${sello}${sufijo}.db`);
    await this.prisma.$executeRawUnsafe(`VACUUM INTO '${destino.replace(/\\/g, "/").replace(/'/g, "''")}'`);
    try {
      await verificarRespaldo(destino);
    } catch (e) {
      rmSync(destino, { force: true });
      throw e;
    }
    this.rotar(motivo);
    return destino;
  }

  /** Respaldos existentes, del más reciente al más antiguo. */
  listar(): Respaldo[] {
    if (!existsSync(this.carpeta)) return [];
    const resultado: Respaldo[] = [];
    for (const archivo of readdirSync(this.carpeta)) {
      const motivo = MOTIVOS.find((m) => archivo.startsWith(prefijoDe(m)));
      if (motivo === undefined || !archivo.endsWith(".db")) continue;
      const ruta = path.join(this.carpeta, archivo);
      const info = statSync(ruta);
      resultado.push({ archivo, ruta, motivo, creado: info.mtime, bytes: info.size });
    }
    return resultado.sort((a, b) => b.archivo.localeCompare(a.archivo));
  }

  private rotar(motivo: MotivoRespaldo): void {
    const prefijo = prefijoDe(motivo);
    const archivos = readdirSync(this.carpeta)
      .filter((f) => f.startsWith(prefijo) && f.endsWith(".db"))
      .sort(); // el sello ISO ordena cronológicamente
    for (const f of archivos.slice(0, Math.max(0, archivos.length - this.maxPorMotivo))) rmSync(path.join(this.carpeta, f), { force: true });
  }
}

/** Abre el respaldo como una base de datos aparte y comprueba su integridad y que contenga el esquema de la aplicación. */
export async function verificarRespaldo(ruta: string): Promise<void> {
  if (!existsSync(ruta) || statSync(ruta).size === 0) throw new Error("El respaldo no se generó o está vacío");
  const db = crearPrismaPara(ruta);
  try {
    const integridad = await db.$queryRawUnsafe<Array<{ integrity_check: string }>>("PRAGMA integrity_check");
    if (integridad.length !== 1 || integridad[0]?.integrity_check !== "ok") {
      throw new Error(`El respaldo está dañado: ${integridad.map((f) => f.integrity_check).join("; ")}`);
    }
    const tablas = await db.$queryRawUnsafe<Array<{ n: number | bigint }>>(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name IN ('_prisma_migrations','Empresa')`);
    if (Number(tablas[0]?.n ?? 0) < 2) throw new Error("El respaldo no contiene el esquema de la aplicación");
  } finally {
    await db.$disconnect();
  }
}

/**
 * Deja la base de datos tal como estaba en el respaldo. La conexión a la base debe estar cerrada. Se descartan los archivos
 * `-wal`/`-shm` de la base anterior: pertenecen a ella y, mezclados con la copia restaurada, la corromperían.
 */
export function restaurarRespaldo(dbPath: string, respaldo: string): void {
  if (!existsSync(respaldo)) throw new Error(`No existe el respaldo ${respaldo}`);
  for (const sufijo of ["-wal", "-shm", "-journal"]) rmSync(`${dbPath}${sufijo}`, { force: true });
  copyFileSync(respaldo, dbPath);
}

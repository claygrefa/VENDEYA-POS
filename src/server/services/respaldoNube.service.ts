// ============================================================
// src/server/services/respaldoNube.service.ts — Copia cifrada del respaldo en una carpeta externa (nube, disco externo o de red)
//
// No usa la API de ningún proveedor: copia el respaldo CIFRADO (.vdbk, AES-256-GCM con frase) a la carpeta que el cliente ya sincroniza
// con OneDrive, Google Drive, Dropbox, etc. (o a un disco externo / carpeta de red). Así el proveedor solo ve texto cifrado y no hay
// credenciales de nube que guardar. La frase se guarda cifrada con la clave maestra de la instalación (fuera de la base de datos) para
// que la copia diaria funcione sola; si la clave maestra se rota, hay que volver a configurarla (el estado lo indica).
// ============================================================
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "fs";
import path from "path";
import { ConfigurarNubeSchema } from "../../shared/schemas/respaldo.schema";
import { AppError } from "./appError.util";
import type { RespaldoService } from "./respaldo.service";
import { protegerRuta, restaurarRespaldo, verificarRespaldo } from "./respaldo.service";
import { cifrarArchivo, descifrarArchivo, EXTENSION_RESPALDO_CIFRADO } from "./respaldoCifrado.util";
import { cifrarSecreto, descifrarSecreto, type SecretoCifrado } from "./sri/firma/cifrado.util";
import type { ProveedorClaveMaestra } from "./sri/firma/claveMaestra.provider";
import { parsear } from "./validation.util";

const ARCHIVO_CONFIG = "respaldos.json";
const AAD_FRASE = "vendeya/respaldo-nube/frase";
const PREFIJO_NUBE = "vendeya-respaldo-";
/** Copias cifradas que se conservan en la carpeta externa */
const MAXIMO_EN_NUBE = 14;

interface ConfigNube {
  carpeta: string;
  frase: SecretoCifrado;
}

export interface EstadoNube {
  configurada: boolean;
  carpeta: string | null;
  /** La frase guardada ya no se puede leer (se rotó la clave maestra): hay que configurarla de nuevo */
  requiereReconfigurar: boolean;
  ultima: { archivo: string; creado: string; bytes: number } | null;
  /** Copias cifradas disponibles en la carpeta, de la más reciente a la más antigua */
  copias: string[];
}

export class RespaldoNubeService {
  constructor(
    private readonly respaldos: RespaldoService,
    private readonly claveMaestra: ProveedorClaveMaestra,
    private readonly directorioConfig: string,
    private readonly ahora: () => Date = () => new Date()
  ) {}

  private get rutaConfig(): string {
    return path.join(this.directorioConfig, ARCHIVO_CONFIG);
  }

  private leerConfig(): ConfigNube | null {
    if (!existsSync(this.rutaConfig)) return null;
    try {
      const c = JSON.parse(readFileSync(this.rutaConfig, "utf8")) as Partial<ConfigNube>;
      return typeof c.carpeta === "string" && c.frase !== undefined ? (c as ConfigNube) : null;
    } catch {
      return null;
    }
  }

  /** Guarda carpeta y frase tras comprobar que se puede escribir en la carpeta. */
  configurar(entrada: unknown): EstadoNube {
    const { carpeta, frase } = parsear(ConfigurarNubeSchema, entrada);
    if (!path.isAbsolute(carpeta)) throw new AppError("VALIDACION", "La carpeta debe ser una ruta absoluta");
    try {
      mkdirSync(carpeta, { recursive: true });
      const prueba = path.join(carpeta, `.vendeya-prueba-${process.pid}`);
      writeFileSync(prueba, "ok");
      rmSync(prueba, { force: true });
    } catch {
      throw new AppError("VALIDACION", "No se puede escribir en esa carpeta: compruebe que existe y que el programa tiene permiso");
    }
    const config: ConfigNube = { carpeta: path.resolve(carpeta), frase: cifrarSecreto(frase, this.claveMaestra.obtener(), AAD_FRASE) };
    mkdirSync(this.directorioConfig, { recursive: true });
    protegerRuta(this.directorioConfig, true);
    // Se escribe a un temporal y se renombra: un corte a mitad no deja la configuración truncada
    const temporal = `${this.rutaConfig}.tmp`;
    writeFileSync(temporal, JSON.stringify(config), { mode: 0o600 });
    renameSync(temporal, this.rutaConfig);
    try {
      chmodSync(this.rutaConfig, 0o600);
    } catch {
      /* Windows: lo cubre la carpeta del perfil */
    }
    return this.estado();
  }

  quitar(): EstadoNube {
    rmSync(this.rutaConfig, { force: true });
    return this.estado();
  }

  estado(): EstadoNube {
    const config = this.leerConfig();
    if (config === null) return { configurada: false, carpeta: null, requiereReconfigurar: false, ultima: null, copias: [] };
    let requiereReconfigurar = false;
    try {
      this.frase(config);
    } catch {
      requiereReconfigurar = true;
    }
    return { configurada: true, carpeta: config.carpeta, requiereReconfigurar, ultima: this.ultimaEn(config.carpeta), copias: this.copiasEn(config.carpeta).reverse() };
  }

  /**
   * Toma un respaldo verificado de la base, lo cifra y lo deja en la carpeta externa; conserva las últimas 14 copias.
   * El archivo intermedio sin cifrar es un respaldo local normal (queda en la carpeta de respaldos del equipo, no en la nube).
   */
  async exportar(): Promise<{ archivo: string; ruta: string; bytes: number }> {
    const config = this.leerConfig();
    if (config === null) throw new AppError("ESTADO_INVALIDO", "La copia en la nube no está configurada");
    const frase = this.frase(config);
    if (!existsSync(config.carpeta)) throw new AppError("ESTADO_INVALIDO", "La carpeta de la copia en la nube no está disponible (¿disco externo desconectado?)");
    const origen = await this.respaldos.crear("automatico");
    const sello = this.ahora().toISOString().replace(/[:.]/g, "-");
    const archivo = `${PREFIJO_NUBE}${sello}${EXTENSION_RESPALDO_CIFRADO}`;
    const destino = path.join(config.carpeta, archivo);
    // Primero a un temporal: un archivo a medias nunca tiene el nombre de una copia válida
    const temporal = `${destino}.parcial`;
    try {
      await cifrarArchivo(origen, temporal, frase);
      renameSync(temporal, destino);
    } catch (e) {
      rmSync(temporal, { force: true });
      throw e;
    }
    this.rotar(config.carpeta);
    return { archivo, ruta: destino, bytes: statSync(destino).size };
  }

  /** Descifra una copia de la carpeta configurada (por nombre exacto) en `destino`. La frase la da quien restaura; no se guarda. */
  async descifrarCopia(archivo: string, frase: string, destino: string): Promise<void> {
    const config = this.leerConfig();
    if (config === null) throw new AppError("ESTADO_INVALIDO", "La copia en la nube no está configurada: indique primero la carpeta");
    if (!this.copiasEn(config.carpeta).includes(archivo)) throw new AppError("NO_ENCONTRADO", "Esa copia no está en la carpeta configurada");
    await descifrarArchivo(path.join(config.carpeta, archivo), destino, frase);
  }

  private frase(config: ConfigNube): string {
    try {
      return descifrarSecreto(config.frase, this.claveMaestra.obtener(), AAD_FRASE);
    } catch {
      throw new AppError("ESTADO_INVALIDO", "No se puede leer la frase guardada del respaldo en la nube: configúrela de nuevo");
    }
  }

  private copiasEn(carpeta: string): string[] {
    if (!existsSync(carpeta)) return [];
    return readdirSync(carpeta)
      .filter((f) => f.startsWith(PREFIJO_NUBE) && f.endsWith(EXTENSION_RESPALDO_CIFRADO))
      .sort();
  }

  private ultimaEn(carpeta: string): EstadoNube["ultima"] {
    const ultimo = this.copiasEn(carpeta).at(-1);
    if (ultimo === undefined) return null;
    const info = statSync(path.join(carpeta, ultimo));
    return { archivo: ultimo, creado: info.mtime.toISOString(), bytes: info.size };
  }

  private rotar(carpeta: string): void {
    const copias = this.copiasEn(carpeta);
    for (const f of copias.slice(0, Math.max(0, copias.length - MAXIMO_EN_NUBE))) rmSync(path.join(carpeta, f), { force: true });
  }
}

/**
 * Restaura la base de datos desde una copia cifrada (.vdbk). Operación para hacer con la aplicación CERRADA (la conexión a la base debe
 * estar cerrada). Descifra a un temporal, comprueba que sea una base válida y recién entonces reemplaza `dbPath`; con frase equivocada o
 * archivo alterado no se toca nada. Devuelve la ruta de una copia de la base anterior (por si la restauración no era la deseada).
 */
export async function restaurarRespaldoCifrado(archivo: string, frase: string, dbPath: string): Promise<{ copiaAnterior: string | null }> {
  if (!existsSync(archivo)) throw new AppError("NO_ENCONTRADO", "No existe el archivo de respaldo");
  const temporal = `${dbPath}.restaurando`;
  await descifrarArchivo(archivo, temporal, frase);
  try {
    await verificarRespaldo(temporal);
  } catch (e) {
    rmSync(temporal, { force: true });
    throw new AppError("ESTADO_INVALIDO", `El respaldo se descifró pero no es una base válida: ${e instanceof Error ? e.message : String(e)}`);
  }
  let copiaAnterior: string | null = null;
  if (existsSync(dbPath)) {
    copiaAnterior = `${dbPath}.antes-de-restaurar`;
    renameSync(dbPath, copiaAnterior);
  }
  try {
    restaurarRespaldo(dbPath, temporal);
  } finally {
    rmSync(temporal, { force: true });
  }
  return { copiaAnterior };
}

// ============================================================
// src/server/services/sri/firma/claveMaestra.provider.ts
// Clave maestra de la instalación (32 bytes) con la que se cifran los secretos locales.
//
// Origen, por prioridad:
//   1. Variable de entorno (base64 de 32 bytes): para servidores/CI; nunca se escribe en disco ni se rota desde la app.
//   2. Archivo `master.key` en la carpeta de secretos, FUERA de la base de datos y del repositorio. En la app de escritorio
//      se envuelve con la protección del sistema operativo (Electron `safeStorage`: DPAPI/Keychain) si está disponible.
//
// Rotación en dos fases (para que un corte a mitad no deje los secretos inaccesibles):
//   preparar → escribe `master.key.nueva`; (el llamador re-cifra y confirma en la BD) ; confirmar → promueve la nueva.
//   Si hay una clave pendiente, `candidatas()` la devuelve también para poder recuperarse.
// ============================================================
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import path from "path";
import { randomBytes } from "crypto";
import { AppError } from "../../appError.util";

export interface ProteccionClave {
  /** Envuelve la clave (base64) con el almacén seguro del sistema */
  proteger(claveBase64: string): string;
  /** Inversa de `proteger` */
  desproteger(protegido: string): string;
}

export interface OpcionesProveedorClave {
  directorio: string;
  /** Nombre de la variable de entorno que puede aportar la clave (default: VENDEYA_CLAVE_MAESTRA) */
  variableEntorno?: string;
  proteccion?: ProteccionClave;
}

interface ArchivoClave {
  version: 1;
  proteccion: "so" | "ninguna";
  clave: string;
}

const ARCHIVO = "master.key";
const ARCHIVO_NUEVA = "master.key.nueva";

export class ProveedorClaveMaestra {
  private readonly directorio: string;
  private readonly variable: string;
  private readonly proteccion: ProteccionClave | undefined;

  constructor(opciones: OpcionesProveedorClave) {
    this.directorio = opciones.directorio;
    this.variable = opciones.variableEntorno ?? "VENDEYA_CLAVE_MAESTRA";
    this.proteccion = opciones.proteccion;
  }

  /** ¿La clave viene del entorno (y por tanto no se puede rotar desde la aplicación)? */
  get desdeEntorno(): boolean {
    const v = process.env[this.variable];
    return v !== undefined && v !== "";
  }

  /** Clave vigente; si no existe ninguna, se genera y se guarda (primer uso). */
  obtener(): Buffer {
    if (this.desdeEntorno) return this.decodificar(process.env[this.variable] as string, `variable de entorno ${this.variable}`);
    const ruta = path.join(this.directorio, ARCHIVO);
    if (!existsSync(ruta)) {
      const nueva = randomBytes(32);
      this.escribir(ruta, nueva);
      return nueva;
    }
    return this.leer(ruta);
  }

  /** Claves que pueden descifrar datos existentes: la vigente y, si hay una rotación a medias, la pendiente. */
  candidatas(): Buffer[] {
    const claves = [this.obtener()];
    const pendiente = path.join(this.directorio, ARCHIVO_NUEVA);
    if (!this.desdeEntorno && existsSync(pendiente)) claves.push(this.leer(pendiente));
    return claves;
  }

  /** Fase 1: genera y guarda la clave nueva sin tocar la vigente. */
  prepararRotacion(): Buffer {
    if (this.desdeEntorno) throw new AppError("ESTADO_INVALIDO", "La clave maestra viene del entorno y no se puede rotar desde la aplicación");
    this.obtener(); // garantiza que existe la actual
    const nueva = randomBytes(32);
    this.escribir(path.join(this.directorio, ARCHIVO_NUEVA), nueva);
    return nueva;
  }

  /** Fase 2: la clave pendiente pasa a ser la vigente. */
  confirmarRotacion(): void {
    const pendiente = path.join(this.directorio, ARCHIVO_NUEVA);
    if (!existsSync(pendiente)) throw new AppError("ESTADO_INVALIDO", "No hay una rotación de clave pendiente");
    renameSync(pendiente, path.join(this.directorio, ARCHIVO));
  }

  /** Descarta una rotación que no llegó a confirmarse. */
  cancelarRotacion(): void {
    rmSync(path.join(this.directorio, ARCHIVO_NUEVA), { force: true });
  }

  get hayRotacionPendiente(): boolean {
    return !this.desdeEntorno && existsSync(path.join(this.directorio, ARCHIVO_NUEVA));
  }

  // ── Internos ───────────────────────────────────────────────

  private decodificar(base64: string, origen: string): Buffer {
    const clave = Buffer.from(base64.trim(), "base64");
    if (clave.length !== 32) throw new AppError("VALIDACION", `La clave maestra (${origen}) debe ser de 32 bytes en base64`);
    return clave;
  }

  private leer(ruta: string): Buffer {
    let archivo: ArchivoClave;
    try {
      archivo = JSON.parse(readFileSync(ruta, "utf8")) as ArchivoClave;
    } catch {
      throw new AppError("ESTADO_INVALIDO", "El archivo de la clave maestra está dañado");
    }
    let base64 = archivo.clave;
    if (archivo.proteccion === "so") {
      if (this.proteccion === undefined) throw new AppError("ESTADO_INVALIDO", "La clave maestra está protegida por el sistema operativo y no hay protección disponible");
      base64 = this.proteccion.desproteger(archivo.clave);
    }
    return this.decodificar(base64, "archivo de claves");
  }

  /** Escritura atómica (archivo temporal + renombrado) con permisos restringidos al usuario. */
  private escribir(ruta: string, clave: Buffer): void {
    mkdirSync(this.directorio, { recursive: true });
    const base64 = clave.toString("base64");
    const contenido: ArchivoClave =
      this.proteccion !== undefined
        ? { version: 1, proteccion: "so", clave: this.proteccion.proteger(base64) }
        : { version: 1, proteccion: "ninguna", clave: base64 };
    const temporal = `${ruta}.tmp`;
    writeFileSync(temporal, JSON.stringify(contenido), { mode: 0o600 });
    try {
      chmodSync(temporal, 0o600);
    } catch {
      /* Windows: los permisos POSIX no aplican; el acceso lo controla la carpeta del perfil de usuario */
    }
    renameSync(temporal, ruta);
  }
}

// ============================================================
// src/server/services/hardware/transporteImpresora.ts — Cómo llegan los bytes ESC/POS a la impresora
//
//   · RED     — socket TCP directo (puerto 9100 estándar en las impresoras de red).
//   · SISTEMA — cola de impresión del sistema operativo en modo RAW: sirve para las impresoras USB instaladas (Windows:
//               impresora compartida/local; Linux y macOS: CUPS). No requiere módulos nativos ni controladores USB propios.
// Ambos implementan `TransporteImpresora`, de modo que las pruebas y el resto del sistema no dependen del dispositivo.
// ============================================================
import { execFile } from "child_process";
import { mkdtemp, rm, writeFile } from "fs/promises";
import net from "net";
import os from "os";
import path from "path";

export interface TransporteImpresora {
  enviar(datos: Buffer): Promise<void>;
}

export class ImpresoraError extends Error {
  constructor(mensaje: string, readonly causa?: unknown) {
    super(mensaje);
    this.name = "ImpresoraError";
  }
}

/** Socket TCP: conecta, escribe todo y cierra. Tiempo máximo configurable. */
export class TransporteRed implements TransporteImpresora {
  constructor(private readonly host: string, private readonly puerto = 9100, private readonly timeoutMs = 4_000) {}

  enviar(datos: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.puerto });
      let terminado = false;
      const fin = (error?: Error): void => {
        if (terminado) return;
        terminado = true;
        socket.destroy();
        if (error === undefined) resolve();
        else reject(new ImpresoraError(`No se pudo imprimir en ${this.host}:${this.puerto}: ${error.message}`, error));
      };
      socket.setTimeout(this.timeoutMs, () => fin(new Error(`tiempo de espera agotado (${this.timeoutMs} ms)`)));
      socket.once("error", fin);
      socket.once("connect", () => {
        socket.end(datos, () => fin());
      });
    });
  }
}

/** Ejecuta un programa del sistema (inyectable en pruebas). */
export type EjecutarComando = (programa: string, argumentos: string[]) => Promise<void>;

const ejecutarReal: EjecutarComando = (programa, argumentos) =>
  new Promise((resolve, reject) => {
    execFile(programa, argumentos, { timeout: 15_000, windowsHide: true }, (error, _salida, errores) => {
      if (error !== null) reject(new Error(errores.trim() !== "" ? errores.trim() : error.message));
      else resolve();
    });
  });

/** Nombres de impresora aceptables: evita que un nombre manipulado se convierta en un argumento o una ruta arbitraria. */
export function nombreImpresoraValido(nombre: string): boolean {
  return /^[\p{L}\p{N} ._\-()]{1,100}$/u.test(nombre) && !nombre.startsWith("-");
}

export class TransporteSistema implements TransporteImpresora {
  constructor(
    private readonly impresora: string,
    private readonly plataforma: NodeJS.Platform = process.platform,
    private readonly ejecutar: EjecutarComando = ejecutarReal
  ) {}

  async enviar(datos: Buffer): Promise<void> {
    if (!nombreImpresoraValido(this.impresora)) throw new ImpresoraError("El nombre de la impresora no es válido");
    const carpeta = await mkdtemp(path.join(os.tmpdir(), "vendeya-ticket-"));
    const archivo = path.join(carpeta, "ticket.bin");
    try {
      await writeFile(archivo, datos, { mode: 0o600 });
      if (this.plataforma === "win32") {
        // `copy /b archivo \\localhost\impresora`: envía los bytes tal cual a la impresora local (debe estar compartida)
        await this.ejecutar("cmd.exe", ["/c", "copy", "/b", archivo, `\\\\localhost\\${this.impresora}`]);
      } else {
        await this.ejecutar("lp", ["-d", this.impresora, "-o", "raw", archivo]);
      }
    } catch (e) {
      throw new ImpresoraError(`No se pudo imprimir en "${this.impresora}": ${(e as Error).message}`, e);
    } finally {
      await rm(carpeta, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

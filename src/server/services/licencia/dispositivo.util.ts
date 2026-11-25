// ============================================================
// src/server/services/licencia/dispositivo.util.ts — Identificador estable de este equipo
//
// Se deriva del identificador de máquina del sistema operativo (MachineGuid en Windows, machine-id en Linux, IOPlatformUUID en macOS),
// con hash para no enviar el valor original. Si no se puede leer, se genera uno aleatorio y se guarda en la carpeta de secretos.
// Reinstalar la aplicación en el mismo equipo mantiene el identificador (no consume una plaza nueva del plan).
// ============================================================
import { createHash, randomUUID } from "crypto";
import { execFileSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import type { DatosDispositivo } from "./licencia.cliente";

/** Lee el identificador de máquina del sistema, o null si no se puede. */
export function leerIdMaquina(plataforma: NodeJS.Platform = process.platform): string | null {
  try {
    if (plataforma === "win32") {
      const salida = execFileSync("reg", ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"], { encoding: "utf8", timeout: 5000, windowsHide: true });
      return /MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]{16,})/.exec(salida)?.[1] ?? null;
    }
    if (plataforma === "linux") {
      for (const f of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) if (existsSync(f)) return readFileSync(f, "utf8").trim() || null;
      return null;
    }
    if (plataforma === "darwin") {
      const salida = execFileSync("ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"], { encoding: "utf8", timeout: 5000 });
      return /"IOPlatformUUID"\s*=\s*"([0-9A-Fa-f-]+)"/.exec(salida)?.[1] ?? null;
    }
  } catch {
    /* se usa el identificador guardado */
  }
  return null;
}

export interface OpcionesDispositivo {
  directorioSecretos: string;
  version: string;
  /** Sustituible en pruebas */
  leerIdMaquina?: () => string | null;
}

export function identificarDispositivo(o: OpcionesDispositivo): DatosDispositivo {
  const crudo = (o.leerIdMaquina ?? leerIdMaquina)() ?? idGuardado(o.directorioSecretos);
  return {
    id: createHash("sha256").update(`vendeya-dispositivo:${crudo.toLowerCase()}`).digest("hex").slice(0, 32),
    nombre: os.hostname(),
    plataforma: process.platform,
    version: o.version,
  };
}

function idGuardado(directorio: string): string {
  const archivo = path.join(directorio, "dispositivo.id");
  if (existsSync(archivo)) {
    const guardado = readFileSync(archivo, "utf8").trim();
    if (guardado !== "") return guardado;
  }
  mkdirSync(directorio, { recursive: true });
  const nuevo = randomUUID();
  writeFileSync(archivo, nuevo, { encoding: "utf8", mode: 0o600 });
  return nuevo;
}

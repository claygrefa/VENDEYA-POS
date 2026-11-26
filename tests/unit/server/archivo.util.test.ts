// Pruebas de archivo.util: renombrado con reintento ante bloqueos transitorios (EPERM/EBUSY/EACCES de Windows)
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { renombrarConReintento } from "../../../src/server/services/archivo.util";

const error = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code });

describe("renombrarConReintento", () => {
  it("renombra de verdad un archivo (sin reintentos si no hay bloqueo)", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "vendeya-ren-"));
    try {
      writeFileSync(path.join(dir, "a.tmp"), "contenido");
      renombrarConReintento(path.join(dir, "a.tmp"), path.join(dir, "a.json"));
      expect(readFileSync(path.join(dir, "a.json"), "utf8")).toBe("contenido");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reintenta ante un bloqueo transitorio, con esperas crecientes, y termina cuando se libera", () => {
    const esperas: number[] = [];
    let llamadas = 0;
    renombrarConReintento("a", "b", {
      renombrar: () => { llamadas += 1; if (llamadas <= 3) throw error(["EPERM", "EBUSY", "EACCES"][llamadas - 1] as string); },
      esperar: (ms) => esperas.push(ms),
      esperaMs: 10,
    });
    expect(llamadas).toBe(4);
    expect(esperas).toEqual([10, 20, 30]);
  });

  it("si el bloqueo no cede, falla con el error original tras los intentos indicados (no lo oculta)", () => {
    let llamadas = 0;
    expect(() => renombrarConReintento("a", "b", { intentos: 3, renombrar: () => { llamadas += 1; throw error("EPERM"); }, esperar: () => undefined })).toThrow("EPERM");
    expect(llamadas).toBe(3);
  });

  it("los demás errores (archivo inexistente, disco lleno…) se propagan al instante, sin reintentar", () => {
    for (const code of ["ENOENT", "ENOSPC", "EXDEV"]) {
      let llamadas = 0;
      expect(() => renombrarConReintento("a", "b", { renombrar: () => { llamadas += 1; throw error(code); }, esperar: () => undefined })).toThrow(code);
      expect(llamadas).toBe(1);
    }
  });
});

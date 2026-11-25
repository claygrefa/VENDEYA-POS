// ============================================================
// tests/unit/electron/updater.service.test.ts — Auto-actualización: búsqueda, descarga silenciosa, respaldo previo, venta en curso
// (autoUpdater simulado y temporizadores falsos: sin red ni Electron)
// ============================================================
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EstadoActualizacion } from "../../../src/shared/types/actualizacion.types";
import { ActualizadorApp, type AutoUpdaterLike } from "../../../electron/updater/updater.service";
import { liberarIpcUpdater, registrarIpcUpdater, type IpcMainLike } from "../../../electron/ipc/updater.ipc";

class UpdaterFalso implements AutoUpdaterLike {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  busquedas = 0;
  instalaciones: Array<[boolean | undefined, boolean | undefined]> = [];
  alBuscar: () => Promise<unknown> = async () => undefined;
  private readonly escuchas = new Map<string, Array<(...a: unknown[]) => void>>();
  checkForUpdates(): Promise<unknown> {
    this.busquedas += 1;
    return this.alBuscar();
  }
  quitAndInstall(silencioso?: boolean, despues?: boolean): void {
    this.instalaciones.push([silencioso, despues]);
  }
  on(evento: string, escucha: (...a: unknown[]) => void): this {
    this.escuchas.set(evento, [...(this.escuchas.get(evento) ?? []), escucha]);
    return this;
  }
  emitir(evento: string, ...args: unknown[]): void {
    for (const e of this.escuchas.get(evento) ?? []) e(...args);
  }
}

interface Montaje {
  u: UpdaterFalso;
  a: ActualizadorApp;
  estados: EstadoActualizacion[];
  respaldos: string[];
  eventos: string[];
  fallaRespaldo: { valor: Error | null };
}

function montar(opciones: { habilitado?: boolean } = {}): Montaje {
  const u = new UpdaterFalso();
  const estados: EstadoActualizacion[] = [];
  const respaldos: string[] = [];
  const eventos: string[] = [];
  const fallaRespaldo: { valor: Error | null } = { valor: null };
  const a = new ActualizadorApp({
    updater: u,
    publicar: (e) => estados.push(e),
    respaldar: async (version) => {
      eventos.push(`respaldo:${version}`);
      if (fallaRespaldo.valor !== null) throw fallaRespaldo.valor;
      respaldos.push(version);
      return `/respaldos/pre-actualizacion-${version}.db`;
    },
    habilitado: opciones.habilitado ?? true,
    motivoDeshabilitado: "Solo en la aplicación instalada",
    ahora: () => new Date("2026-11-24T12:00:00Z"),
  });
  const instalar = u.quitAndInstall.bind(u);
  u.quitAndInstall = (s, d) => {
    eventos.push("quitAndInstall");
    instalar(s, d);
  };
  return { u, a, estados, respaldos, eventos, fallaRespaldo };
}

/** Deja la actualización descargada y respaldada. */
async function dejarLista(m: Montaje, version = "1.2.0"): Promise<void> {
  m.a.iniciar();
  m.u.emitir("update-available", { version });
  m.u.emitir("update-downloaded", { version });
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("Desactivado (modo desarrollo o apagado)", () => {
  it("informa el motivo y no configura, ni programa ni busca nada", async () => {
    const m = montar({ habilitado: false });
    m.a.iniciar();
    expect(m.a.estado()).toEqual({ tipo: "desactivado", motivo: "Solo en la aplicación instalada" });
    expect(m.u.autoDownload).toBe(false);
    await vi.advanceTimersByTimeAsync(10 * 60 * 60 * 1000);
    expect(await m.a.buscar()).toMatchObject({ tipo: "desactivado" });
    expect(m.u.busquedas).toBe(0);
    expect(await m.a.instalar()).toMatchObject({ ok: false, motivo: "no-lista" });
  });
});

describe("Búsqueda y descarga silenciosa", () => {
  it("configura descarga automática e instalación al cerrar, busca a los 60 s y luego cada 4 horas", async () => {
    const m = montar();
    m.a.iniciar();
    m.a.iniciar(); // idempotente
    expect(m.u.autoDownload).toBe(true);
    expect(m.u.autoInstallOnAppQuit).toBe(true);
    expect(m.u.busquedas).toBe(0);
    await vi.advanceTimersByTimeAsync(59_000);
    expect(m.u.busquedas).toBe(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(m.u.busquedas).toBe(1);
    m.u.emitir("update-not-available");
    await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000);
    expect(m.u.busquedas).toBe(2);
    m.a.detener();
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(m.u.busquedas).toBe(2);
  });

  it("recorre buscando → descargando con porcentaje → lista, respaldando la base de datos al terminar de descargar", async () => {
    const m = montar();
    m.a.iniciar();
    const buscando = m.a.buscar();
    m.u.emitir("checking-for-update");
    m.u.emitir("update-available", { version: "1.2.0" });
    await buscando;
    m.u.emitir("download-progress", { percent: 41.6 });
    m.u.emitir("download-progress", { percent: 100 });
    m.u.emitir("update-downloaded", { version: "1.2.0" });
    await vi.advanceTimersByTimeAsync(0);

    expect(m.estados.map((e) => e.tipo)).toEqual(["buscando", "buscando", "descargando", "descargando", "descargando", "lista"]);
    expect(m.estados[3]).toEqual({ tipo: "descargando", version: "1.2.0", porcentaje: 42 });
    expect(m.a.estado()).toEqual({ tipo: "lista", version: "1.2.0", respaldo: "/respaldos/pre-actualizacion-1.2.0.db", aviso: null });
    expect(m.respaldos).toEqual(["1.2.0"]);
    expect(m.u.instalaciones).toHaveLength(0); // no reinicia por su cuenta
  });

  it("sin versión nueva queda «al día» con la hora de la revisión", async () => {
    const m = montar();
    m.a.iniciar();
    const p = m.a.buscar();
    m.u.emitir("update-not-available");
    await p;
    expect(m.a.estado()).toEqual({ tipo: "al-dia", revisado: "2026-11-24T12:00:00.000Z" });
  });

  it("un fallo de red se informa como error, no lanza, y se reintenta en la siguiente búsqueda", async () => {
    const m = montar();
    m.a.iniciar();
    m.u.alBuscar = async () => {
      throw new Error("getaddrinfo ENOTFOUND github.com");
    };
    expect(await m.a.buscar()).toMatchObject({ tipo: "error", mensaje: expect.stringContaining("ENOTFOUND") });
    expect(m.a.estado()).toMatchObject({ tipo: "error", mensaje: expect.stringContaining("Se reintentará más tarde") });
    // la red vuelve: la búsqueda periódica funciona
    m.u.alBuscar = async () => undefined;
    await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000);
    m.u.emitir("update-not-available");
    expect(m.a.estado().tipo).toBe("al-dia");
  });

  it("el evento de error del actualizador también se refleja, con el texto acotado", async () => {
    const m = montar();
    m.a.iniciar();
    m.u.emitir("error", new Error("x".repeat(500)));
    const e = m.a.estado();
    expect(e.tipo).toBe("error");
    expect(e.tipo === "error" && e.mensaje.length).toBeLessThan(300);
  });

  it("no vuelve a buscar mientras ya busca, descarga o tiene una actualización lista", async () => {
    const m = montar();
    m.a.iniciar();
    void m.a.buscar();
    await m.a.buscar(); // ya buscando
    expect(m.u.busquedas).toBe(1);
    m.u.emitir("update-available", { version: "1.2.0" });
    await m.a.buscar();
    expect(m.u.busquedas).toBe(1);
    m.u.emitir("update-downloaded", { version: "1.2.0" });
    await vi.advanceTimersByTimeAsync(0);
    await m.a.buscar();
    expect(m.u.busquedas).toBe(1);
  });

  it("un error posterior no descarta una actualización ya descargada y respaldada", async () => {
    const m = montar();
    await dejarLista(m);
    m.u.emitir("error", new Error("se cayó la red"));
    expect(m.a.estado()).toMatchObject({ tipo: "lista", version: "1.2.0" });
  });
});

describe("Respaldo de la base de datos", () => {
  it("si falla al descargar NO se instalará sola y se avisa; «Reiniciar e instalar» lo reintenta", async () => {
    const m = montar();
    m.fallaRespaldo.valor = new Error("disco lleno");
    await dejarLista(m);
    const e = m.a.estado();
    expect(e).toMatchObject({ tipo: "lista", respaldo: null });
    expect(e.tipo === "lista" && e.aviso).toContain("disco lleno");
    expect(m.u.autoInstallOnAppQuit).toBe(false);

    const r = await m.a.instalar();
    expect(r).toMatchObject({ ok: false, motivo: "respaldo", mensaje: expect.stringContaining("disco lleno") });
    expect(m.u.instalaciones).toHaveLength(0);

    m.fallaRespaldo.valor = null; // se liberó espacio
    expect(await m.a.instalar()).toEqual({ ok: true });
    expect(m.u.autoInstallOnAppQuit).toBe(true);
    expect(m.u.instalaciones).toEqual([[false, true]]);
  });

  it("al cerrar vuelve a respaldar (los datos cambiaron desde la descarga) y, si no puede, cancela la instalación automática", async () => {
    const m = montar();
    await dejarLista(m);
    expect(m.respaldos).toHaveLength(1);
    await m.a.antesDeCerrar();
    expect(m.respaldos).toHaveLength(2);
    expect(m.u.autoInstallOnAppQuit).toBe(true);

    m.fallaRespaldo.valor = new Error("sin espacio");
    await m.a.antesDeCerrar();
    expect(m.u.autoInstallOnAppQuit).toBe(false);
  });

  it("al cerrar sin actualización lista no respalda nada", async () => {
    const m = montar();
    m.a.iniciar();
    await m.a.antesDeCerrar();
    expect(m.eventos).toEqual([]);
  });

  it("tras «Reiniciar e instalar» el cierre no repite el respaldo", async () => {
    const m = montar();
    await dejarLista(m);
    await m.a.instalar();
    const antes = m.respaldos.length;
    await m.a.antesDeCerrar();
    expect(m.respaldos).toHaveLength(antes);
  });
});

describe("Reiniciar e instalar", () => {
  it("con una venta en curso se rechaza sin respaldar ni reiniciar; al terminar la venta se instala, respaldando antes de reiniciar", async () => {
    const m = montar();
    await dejarLista(m);
    m.eventos.length = 0;

    m.a.fijarOcupado(true);
    expect(await m.a.instalar()).toMatchObject({ ok: false, motivo: "ocupado" });
    expect(m.eventos).toEqual([]);
    expect(m.u.instalaciones).toHaveLength(0);

    m.a.fijarOcupado(false);
    expect(await m.a.instalar()).toEqual({ ok: true });
    expect(m.eventos).toEqual(["respaldo:1.2.0", "quitAndInstall"]); // primero el respaldo, después el reinicio
  });

  it("si empieza una venta mientras se respalda, no reinicia", async () => {
    const u = new UpdaterFalso();
    let ocupadaDuranteRespaldo = false;
    let a!: ActualizadorApp;
    a = new ActualizadorApp({
      updater: u,
      publicar: () => undefined,
      respaldar: async () => {
        if (ocupadaDuranteRespaldo) a.fijarOcupado(true);
        return "/r.db";
      },
      habilitado: true,
    });
    a.iniciar();
    u.emitir("update-downloaded", { version: "2.0.0" });
    await vi.advanceTimersByTimeAsync(0);
    ocupadaDuranteRespaldo = true;
    expect(await a.instalar()).toMatchObject({ ok: false, motivo: "ocupado" });
    expect(u.instalaciones).toHaveLength(0);
  });

  it("sin actualización lista no hace nada, y un segundo clic durante la instalación se ignora", async () => {
    const m = montar();
    m.a.iniciar();
    expect(await m.a.instalar()).toMatchObject({ ok: false, motivo: "no-lista" });
    await dejarLista(m);
    expect(await m.a.instalar()).toEqual({ ok: true });
    expect(await m.a.instalar()).toMatchObject({ ok: false });
    expect(m.u.instalaciones).toHaveLength(1);
  });
});

describe("IPC del actualizador", () => {
  function ipcFalso(): { ipc: IpcMainLike; llamar: (canal: string, ...args: unknown[]) => unknown; canales: () => string[] } {
    const manejadores = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
    return {
      ipc: { handle: (c, h) => void manejadores.set(c, h), removeHandler: (c) => void manejadores.delete(c) },
      llamar: (c, ...a) => manejadores.get(c)?.({}, ...a),
      canales: () => [...manejadores.keys()].sort(),
    };
  }

  it("expone buscar, estado, instalar y «ocupado»; un valor raro cuenta como ocupado; se liberan al cerrar", async () => {
    const m = montar();
    const f = ipcFalso();
    registrarIpcUpdater(m.a, f.ipc);
    expect(f.canales()).toEqual(["updater:check", "updater:get-status", "updater:install", "updater:set-busy"]);

    m.a.iniciar();
    expect(f.llamar("updater:get-status")).toEqual({ tipo: "inactivo" });
    const buscando = f.llamar("updater:check") as Promise<EstadoActualizacion>;
    m.u.emitir("update-not-available");
    expect((await buscando).tipo).toBe("al-dia");

    m.u.emitir("update-downloaded", { version: "3.0.0" });
    await vi.advanceTimersByTimeAsync(0);
    f.llamar("updater:set-busy", true);
    expect(await f.llamar("updater:install")).toMatchObject({ ok: false, motivo: "ocupado" });
    f.llamar("updater:set-busy", "basura"); // ante la duda, ocupado
    expect(await f.llamar("updater:install")).toMatchObject({ ok: false, motivo: "ocupado" });
    f.llamar("updater:set-busy", false);
    expect(await f.llamar("updater:install")).toEqual({ ok: true });

    liberarIpcUpdater(f.ipc);
    expect(f.canales()).toEqual([]);
  });
});

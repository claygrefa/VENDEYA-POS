// @vitest-environment jsdom
// ============================================================
// tests/unit/renderer/actualizacion.test.tsx — Banner de actualización, venta en curso y pestaña «Actualizaciones» de Ajustes
// (puente window.vendeya simulado: sin Electron)
// ============================================================
import { act, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { EstadoActualizacion } from "../../../src/shared/types/actualizacion.types";
import { useCarrito } from "../../../src/renderer/store/carrito.store";
import { ApiSimulada, CAFE, renderizarPos, servidorBasico, USUARIO } from "../../helpers/renderer/entorno";

const ADMIN = { ...USUARIO, id: "u-admin", username: "dueno", rol: "ADMIN", permisos: ["configuracion:leer", "configuracion:actualizar", "caja:crear", "caja:leer", "ventas:crear", "clientes:leer"] };

interface Puente {
  invocaciones: Array<{ canal: string; args: unknown[] }>;
  emitir: (e: EstadoActualizacion) => void;
  escuchas: () => number;
  respuestas: Record<string, unknown>;
}

function instalarPuente(inicial: EstadoActualizacion = { tipo: "inactivo" }): Puente {
  const escuchas = new Set<(...a: unknown[]) => void>();
  const p: Puente = {
    invocaciones: [],
    respuestas: { "updater:get-status": inicial, "app:get-version": "1.4.2", "updater:check": { tipo: "buscando" }, "updater:install": { ok: true } },
    emitir: (e) => act(() => escuchas.forEach((l) => l(e))),
    escuchas: () => escuchas.size,
  };
  (window as unknown as { vendeya: unknown }).vendeya = {
    version: "1.4.2",
    platform: "win32",
    invoke: async (canal: string, ...args: unknown[]) => {
      p.invocaciones.push({ canal, args });
      return p.respuestas[canal];
    },
    on: (canal: string, l: (...a: unknown[]) => void) => {
      if (canal === "updater:status") escuchas.add(l);
      return () => escuchas.delete(l);
    },
  };
  return p;
}

const ocupadoReportado = (p: Puente): unknown[] => p.invocaciones.filter((i) => i.canal === "updater:set-busy").map((i) => i.args[0]);

afterEach(() => {
  delete (window as unknown as { vendeya?: unknown }).vendeya;
  useCarrito.getState().vaciar();
});

describe("Banner de actualización", () => {
  it("fuera de Electron no hay banner ni puente", async () => {
    renderizarPos({ usuario: ADMIN });
    await screen.findByRole("navigation", { name: "Menú principal" });
    expect(screen.queryByRole("status", { name: "Actualización" })).toBeNull();
  });

  it("no molesta si no hay nada que decir (inactivo, buscando, al día, desactivado)", async () => {
    const p = instalarPuente();
    renderizarPos({ usuario: ADMIN });
    await screen.findByRole("navigation", { name: "Menú principal" });
    for (const e of [{ tipo: "buscando" }, { tipo: "al-dia", revisado: "2026-11-24T10:00:00Z" }, { tipo: "desactivado", motivo: "x" }] as EstadoActualizacion[]) {
      p.emitir(e);
      expect(screen.queryByLabelText("Actualización")).toBeNull();
    }
  });

  it("muestra el avance de la descarga silenciosa y, al terminar, ofrece reiniciar e instalar", async () => {
    const p = instalarPuente();
    const { usuario } = renderizarPos({ usuario: ADMIN });
    await screen.findByRole("navigation", { name: "Menú principal" });

    p.emitir({ tipo: "descargando", version: "1.5.0", porcentaje: 37 });
    expect(await screen.findByLabelText("Actualización")).toHaveTextContent("Descargando la versión 1.5.0 en segundo plano… 37%");

    p.emitir({ tipo: "lista", version: "1.5.0", respaldo: "/r.db", aviso: null });
    const banner = await screen.findByLabelText("Actualización");
    expect(banner).toHaveTextContent("La versión 1.5.0 está lista");
    expect(banner).toHaveTextContent("copia de seguridad");
    await usuario.click(within(banner).getByRole("button", { name: "Reiniciar e instalar" }));
    expect(p.invocaciones.filter((i) => i.canal === "updater:install")).toHaveLength(1);
    expect(within(banner).queryByRole("alert")).toBeNull();
  });

  it("si el respaldo falló muestra el aviso en lugar de prometer la instalación al cerrar; el rechazo de instalar se explica", async () => {
    const p = instalarPuente();
    p.respuestas["updater:install"] = { ok: false, motivo: "respaldo", mensaje: "No se instaló: falló el respaldo de la base de datos (disco lleno)" };
    const { usuario } = renderizarPos({ usuario: ADMIN });
    await screen.findByRole("navigation", { name: "Menú principal" });
    p.emitir({ tipo: "lista", version: "1.5.0", respaldo: null, aviso: "No se pudo respaldar la base de datos (disco lleno): la actualización no se instalará sola." });
    const banner = await screen.findByLabelText("Actualización");
    expect(banner).toHaveTextContent("no se instalará sola");
    expect(banner).not.toHaveTextContent("Se instalará al cerrar");
    await usuario.click(within(banner).getByRole("button", { name: "Reiniciar e instalar" }));
    expect(await within(banner).findByRole("alert")).toHaveTextContent("disco lleno");
  });

  it("un error se muestra con «Reintentar» (vuelve a buscar) y se puede cerrar", async () => {
    const p = instalarPuente();
    const { usuario } = renderizarPos({ usuario: ADMIN });
    await screen.findByRole("navigation", { name: "Menú principal" });
    p.emitir({ tipo: "error", mensaje: "No se pudo comprobar las actualizaciones (sin red). Se reintentará más tarde." });
    const banner = await screen.findByRole("alert", { name: "Actualización" });
    expect(banner).toHaveTextContent("sin red");
    await usuario.click(within(banner).getByRole("button", { name: "Reintentar" }));
    expect(p.invocaciones.filter((i) => i.canal === "updater:check")).toHaveLength(1);
    await usuario.click(within(banner).getByRole("button", { name: "Cerrar" }));
    expect(screen.queryByRole("alert", { name: "Actualización" })).toBeNull();
  });
});

describe("Venta en curso", () => {
  it("informa a Electron cuando hay líneas en el carrito y bloquea «Reiniciar e instalar» hasta terminarla", async () => {
    const p = instalarPuente({ tipo: "lista", version: "1.5.0", respaldo: "/r.db", aviso: null });
    renderizarPos({ usuario: ADMIN });
    const boton = await screen.findByRole("button", { name: "Reiniciar e instalar" });
    await waitFor(() => expect(ocupadoReportado(p)).toEqual([false]));
    expect(boton).toBeEnabled();

    act(() => void useCarrito.getState().agregar({ producto: CAFE }));
    await waitFor(() => expect(ocupadoReportado(p)).toEqual([false, true]));
    expect(screen.getByRole("button", { name: "Reiniciar e instalar" })).toBeDisabled();
    expect(screen.getByLabelText("Actualización")).toHaveTextContent("Termine la venta en curso");

    act(() => useCarrito.getState().vaciar());
    await waitFor(() => expect(ocupadoReportado(p)).toEqual([false, true, false]));
    expect(screen.getByRole("button", { name: "Reiniciar e instalar" })).toBeEnabled();
  });

  it("al salir de la sesión deja de estar «ocupado» y se quita la escucha de estados", async () => {
    const p = instalarPuente();
    const { unmount } = renderizarPos({ usuario: ADMIN });
    await screen.findByRole("navigation", { name: "Menú principal" });
    act(() => void useCarrito.getState().agregar({ producto: CAFE }));
    await waitFor(() => expect(ocupadoReportado(p).at(-1)).toBe(true));
    expect(p.escuchas()).toBe(1);
    unmount();
    await waitFor(() => expect(ocupadoReportado(p).at(-1)).toBe(false));
    expect(p.escuchas()).toBe(0);
  });
});

describe("Ajustes › Actualizaciones", () => {
  async function abrir(api: ApiSimulada = servidorBasico(new ApiSimulada())) {
    const r = renderizarPos({ api, usuario: ADMIN });
    await r.usuario.click(await screen.findByRole("button", { name: "Ajustes" }));
    await r.usuario.click(await screen.findByRole("tab", { name: "Actualizaciones" }));
    return r;
  }

  it("fuera de Electron lo explica y no deja buscar", async () => {
    await abrir();
    expect(await screen.findByText(/funcionan en la aplicación instalada/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Buscar actualizaciones" })).toBeDisabled();
  });

  it("muestra la versión instalada y el estado, y busca bajo demanda", async () => {
    const p = instalarPuente({ tipo: "al-dia", revisado: "2026-11-24T10:00:00Z" });
    const { usuario } = await abrir();
    expect(await screen.findByText("1.4.2")).toBeInTheDocument();
    expect(screen.getByLabelText("Estado de las actualizaciones")).toHaveTextContent("Tiene la última versión");
    await usuario.click(screen.getByRole("button", { name: "Buscar actualizaciones" }));
    expect(p.invocaciones.filter((i) => i.canal === "updater:check")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Buscar actualizaciones" })).toBeDisabled(); // «buscando»
    p.emitir({ tipo: "descargando", version: "1.5.0", porcentaje: 10 });
    expect(await screen.findByLabelText("Estado de las actualizaciones")).toHaveTextContent("Descargando la versión 1.5.0… 10%");
  });

  it("en una instalación sin actualizaciones (desarrollo) muestra el motivo y no deja buscar", async () => {
    instalarPuente({ tipo: "desactivado", motivo: "Solo se buscan actualizaciones en la aplicación instalada" });
    await abrir();
    expect(await screen.findByLabelText("Estado de las actualizaciones")).toHaveTextContent("Solo se buscan actualizaciones en la aplicación instalada");
    expect(screen.getByRole("button", { name: "Buscar actualizaciones" })).toBeDisabled();
  });

});

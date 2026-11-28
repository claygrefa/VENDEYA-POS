// @vitest-environment jsdom
// ============================================================
// tests/unit/renderer/menu-preferencias.test.tsx — Menú de preferencias de la cabecera y menú lateral contraíble
// ============================================================
import { screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { aplicarAlDocumento, usePreferencias } from "../../../src/renderer/store/preferencias.store";
import { renderizarPos } from "../../helpers/renderer/entorno";

beforeEach(() => {
  localStorage.clear();
  usePreferencias.setState({ tema: "oscuro", tamanoTexto: "normal", menuContraido: false, vistaProductos: "cuadricula" });
});
afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.fontSize = "";
});

describe("Menú de preferencias", () => {
  it("cambia el tema y el tamaño del texto, y se cierra con Escape", async () => {
    const { usuario } = renderizarPos();
    await usuario.click(await screen.findByRole("button", { name: "Preferencias" }));
    const panel = await screen.findByRole("group", { name: "Preferencias" });
    await usuario.click(within(panel).getByRole("radio", { name: "Claro" }));
    await usuario.click(within(panel).getByRole("radio", { name: "Texto grande" }));
    expect(usePreferencias.getState()).toMatchObject({ tema: "claro", tamanoTexto: "grande" });
    aplicarAlDocumento(usePreferencias.getState().tema, usePreferencias.getState().tamanoTexto);
    expect(document.documentElement.dataset["theme"]).toBe("light");
    expect(within(panel).getByRole("radio", { name: "Claro" })).toHaveAttribute("aria-checked", "true");
    await usuario.keyboard("{Escape}");
    expect(screen.queryByRole("group", { name: "Preferencias" })).not.toBeInTheDocument();
  });

  it("«Mi contraseña» abre el cambio de contraseña y cierra el menú; «Salir» sigue a la vista", async () => {
    const { usuario } = renderizarPos();
    await usuario.click(await screen.findByRole("button", { name: "Preferencias" }));
    await usuario.click(screen.getByRole("button", { name: "Mi contraseña" }));
    expect(await screen.findByRole("dialog", { name: "Cambiar mi contraseña" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Preferencias" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salir" })).toBeInTheDocument();
  });
});

describe("Menú lateral contraíble", () => {
  it("se contrae a íconos conservando la navegación, se recuerda y también se alterna con Ctrl+B", async () => {
    const { usuario } = renderizarPos();
    const menu = await screen.findByRole("navigation", { name: "Menú principal" });
    expect(within(menu).getByText("Clientes")).toBeInTheDocument();
    await usuario.click(screen.getByRole("button", { name: "Contraer menú" }));
    expect(usePreferencias.getState().menuContraido).toBe(true);
    expect(localStorage.getItem("vendeya.menuContraido")).toBe("1");
    expect(within(menu).queryByText("Clientes")).not.toBeInTheDocument(); // sin texto visible…
    expect(within(menu).getByRole("button", { name: "Clientes" })).toBeInTheDocument(); // …pero con nombre accesible
    await usuario.keyboard("{Control>}b{/Control}");
    expect(usePreferencias.getState().menuContraido).toBe(false);
    expect(within(menu).getByText("Clientes")).toBeInTheDocument();
  });
});

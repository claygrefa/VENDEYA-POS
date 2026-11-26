// @vitest-environment jsdom
// ============================================================
// tests/unit/renderer/ayuda-respaldos.test.tsx — Centro de ayuda, respaldos/restauración y reporte de errores (Semana 23)
// ============================================================
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "fs";
import path from "path";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { LimiteErrores } from "../../../src/renderer/components/LimiteErrores";
import { ARTICULOS, buscarArticulos, esParaRol, type RolAyuda } from "../../../src/renderer/pages/ayuda.contenido";
import { ApiSimulada, renderizarPos, servidorBasico, usuarioDe } from "../../helpers/renderer/entorno";

const ADMIN = { ...usuarioDe("SUPERVISOR"), rol: "ADMIN", permisos: [...usuarioDe("SUPERVISOR").permisos, "configuracion:leer", "configuracion:actualizar"] };

describe("Contenido de la ayuda", () => {
  it("cada artículo es útil: id único, pasos y palabras clave; y cada rol tiene su guía", () => {
    expect(new Set(ARTICULOS.map((a) => a.id)).size).toBe(ARTICULOS.length);
    for (const a of ARTICULOS) {
      expect(a.pasos.length, a.id).toBeGreaterThanOrEqual(2);
      expect(a.palabrasClave.length, a.id).toBeGreaterThan(0);
    }
    for (const rol of ["ADMIN", "SUPERVISOR", "CAJERO", "CONTADOR", "BODEGUERO"] as RolAyuda[]) {
      expect(ARTICULOS.filter((a) => esParaRol(a, rol)).length, rol).toBeGreaterThanOrEqual(3);
    }
  });

  it("la búsqueda ignora mayúsculas y tildes y exige todas las palabras", () => {
    expect(buscarArticulos(ARTICULOS, "CONTRASEÑA").length).toBeGreaterThan(0);
    expect(buscarArticulos(ARTICULOS, "contrasena").length).toBe(buscarArticulos(ARTICULOS, "contraseña").length);
    const uno = buscarArticulos(ARTICULOS, "cerrar turno").map((a) => a.id);
    expect(uno).toContain("cerrar-turno");
    expect(buscarArticulos(ARTICULOS, "cerrar turno zzzinexistente")).toEqual([]);
    expect(buscarArticulos(ARTICULOS, "   ")).toHaveLength(ARTICULOS.length);
  });

  it("los atajos y botones que describe la ayuda existen en las pantallas", () => {
    const leer = (r: string): string => readFileSync(path.resolve(__dirname, "../../..", r), "utf8");
    const pos = leer("src/renderer/pages/PosScreen.tsx");
    for (const tecla of ["F2", "F4", "F8"]) expect(pos).toContain(tecla);
    const caja = leer("src/renderer/pages/CajaPage.tsx");
    for (const boton of ["Ingreso / egreso", "Cerrar turno", "Imprimir arqueo", "Anular venta"]) expect(caja).toContain(boton);
    expect(leer("src/renderer/pages/AjustesPage.tsx")).toContain("Imprimir prueba");
    expect(leer("src/renderer/pages/AjustesRespaldos.tsx")).toContain("Respaldar ahora");
    expect(leer("src/renderer/pages/AjustesRespaldos.tsx")).toContain("Preparar restauración");
    for (const boton of ["Nuevo usuario", "Contraseña de", "Desactivar"]) expect(leer("src/renderer/pages/AjustesUsuarios.tsx")).toContain(boton);
    for (const boton of ["Nueva sucursal", "Agregar caja a", "Editar"]) expect(leer("src/renderer/pages/AjustesSucursales.tsx")).toContain(boton);
    expect(leer("src/renderer/components/BarraEstado.tsx")).toContain("Mi contraseña");
    expect(pos).toContain("Guardar factura (PDF)");
    expect(leer("src/renderer/pages/ClientesPage.tsx")).toContain("Nuevo cliente");
    expect(leer("src/renderer/pages/InventarioPage.tsx")).toContain("Nuevo producto");
    expect(leer("src/renderer/pages/SriMonitorPage.tsx")).toContain("Reintentar envío");
  });
});

describe("Centro de ayuda", () => {
  async function abrirAyuda(usuarioRol: Parameters<typeof usuarioDe>[0] = "CAJERO") {
    const api = servidorBasico(new ApiSimulada());
    const r = renderizarPos({ api, usuario: usuarioDe(usuarioRol) });
    await r.usuario.click(await screen.findByRole("button", { name: "Ayuda" }));
    return { ...r, api };
  }

  it("el cajero ve sus guías y no las del administrador; no hace falta internet (ninguna consulta de ayuda)", async () => {
    const { api } = await abrirAyuda();
    const ayuda = await screen.findByRole("region", { name: "Centro de ayuda" });
    expect(within(ayuda).getByText("Registrar una venta")).toBeInTheDocument();
    expect(within(ayuda).getByText("Cerrar el turno (cierre ciego)")).toBeInTheDocument();
    expect(within(ayuda).queryByText("Restaurar la información desde un respaldo")).toBeNull();
    expect(api.llamadas.some((l) => /ayuda/i.test(l.ruta))).toBe(false);
  });

  it("«todos los roles» muestra también las del administrador", async () => {
    const { usuario } = await abrirAyuda();
    await usuario.click(screen.getByRole("checkbox", { name: "Mostrar las guías de todos los roles" }));
    expect(await screen.findByText("Restaurar la información desde un respaldo")).toBeInTheDocument();
  });

  it("busca, abre un artículo con sus pasos numerados y vuelve", async () => {
    const { usuario } = await abrirAyuda();
    await usuario.type(screen.getByLabelText("Buscar en la ayuda"), "cierre cuadre");
    expect(screen.queryByText("Registrar una venta")).toBeNull();
    await usuario.click(await screen.findByRole("button", { name: /Cerrar el turno/ }));
    const articulo = await screen.findByRole("article", { name: "Cerrar el turno (cierre ciego)" });
    expect(within(articulo).getAllByRole("listitem").length).toBeGreaterThanOrEqual(4);
    expect(within(articulo).getByText(/cierre ciego/i, { selector: "li" })).toBeInTheDocument();
    await usuario.click(screen.getByRole("button", { name: /Volver a la ayuda/ }));
    expect(await screen.findByRole("region", { name: "Centro de ayuda" })).toBeInTheDocument();
  });

  it("sin coincidencias lo dice y sugiere qué hacer", async () => {
    const { usuario } = await abrirAyuda();
    await usuario.type(screen.getByLabelText("Buscar en la ayuda"), "zzzqqq");
    expect(await screen.findByText(/No hay guías que coincidan/)).toBeInTheDocument();
  });

  it("todos los roles tienen la Ayuda en el menú, también quien no tiene otras vistas", async () => {
    renderizarPos({ api: servidorBasico(new ApiSimulada()), usuario: { ...usuarioDe("CAJERO"), permisos: [] }, sinTurno: true });
    expect(await screen.findByRole("button", { name: "Ayuda" })).toBeInTheDocument();
    expect(await screen.findByRole("region", { name: "Centro de ayuda" })).toBeInTheDocument();
  });
});

// ── Respaldos ────────────────────────────────────────────────

const LOCALES = [
  { archivo: "vendeya-automatico-2026-11-25T10-00-00-000Z.db", motivo: "automatico", creado: "2026-11-25T10:00:00.000Z", bytes: 5_000_000 },
  { archivo: "vendeya-pre-actualizacion-2026-11-20T09-00-00-000Z-v1.0.1.db", motivo: "pre-actualizacion", creado: "2026-11-20T09:00:00.000Z", bytes: 4_800_000 },
];
const NUBE_VACIA = { configurada: false, carpeta: null, requiereReconfigurar: false, ultima: null, copias: [] };

function servidorRespaldos(): ApiSimulada {
  const estado = { locales: [...LOCALES], nube: { ...NUBE_VACIA } as Record<string, unknown>, restauracionPendiente: null as unknown };
  return servidorBasico(new ApiSimulada())
    .en("GET /api/respaldos", () => ({ cuerpo: estado }))
    .en("POST /api/respaldos", () => {
      estado.locales = [{ archivo: "vendeya-manual-2026-11-25T12-00-00-000Z.db", motivo: "manual", creado: "2026-11-25T12:00:00.000Z", bytes: 5_100_000 }, ...estado.locales];
      return { status: 201, cuerpo: { archivo: "vendeya-manual-2026-11-25T12-00-00-000Z.db", ...estado } };
    })
    .en("PUT /api/respaldos/nube", (p) => {
      estado.nube = { configurada: true, carpeta: (p.cuerpo as { carpeta: string }).carpeta, requiereReconfigurar: false, ultima: null, copias: ["vendeya-respaldo-2026-11-24T10-00-00-000Z.vdbk"] };
      return { cuerpo: estado.nube };
    })
    .en("POST /api/respaldos/restaurar", (p) => {
      const c = p.cuerpo as { password: string; archivo: string; origen: string };
      if (c.password !== "ClaveAdmin1") return { status: 400, cuerpo: { error: "VALIDACION", mensaje: "La contraseña no es correcta" } };
      estado.restauracionPendiente = { origen: c.origen, archivo: c.archivo, preparada: "2026-11-25T12:30:00.000Z" };
      return { status: 202, cuerpo: { pendiente: estado.restauracionPendiente, ...estado } };
    })
    .en("DELETE /api/respaldos/restaurar", () => {
      estado.restauracionPendiente = null;
      return { cuerpo: estado };
    })
    .en("GET /api/telemetria", { cuerpo: { consentimiento: false, desde: null, instalacion: "id-1", pendientes: 0, destinoConfigurado: false, ultimoEnvio: null } });
}

async function abrirSeccion(api: ApiSimulada, pestana: string) {
  const r = renderizarPos({ api, usuario: ADMIN });
  await r.usuario.click(await screen.findByRole("button", { name: "Ajustes" }));
  await r.usuario.click(await screen.findByRole("tab", { name: pestana }));
  return r;
}

describe("Ajustes › Respaldos", () => {
  it("lista los respaldos y «Respaldar ahora» crea uno manual", async () => {
    const api = servidorRespaldos();
    const { usuario } = await abrirSeccion(api, "Respaldos");
    const lista = await screen.findByRole("list", { name: "Lista de respaldos" });
    expect(within(lista).getAllByRole("listitem")).toHaveLength(2);
    expect(within(lista).getByText(/Automático/)).toBeInTheDocument();
    await usuario.click(screen.getByRole("button", { name: "Respaldar ahora" }));
    expect(await screen.findByText("Respaldo creado y verificado")).toBeInTheDocument();
    expect(within(await screen.findByRole("list", { name: "Lista de respaldos" })).getAllByRole("listitem")).toHaveLength(3);
    expect(api.llamadasA("POST /api/respaldos")).toHaveLength(1);
  });

  it("la copia en la nube exige carpeta, frase de 12+ caracteres y confirmar que se anotó; advierte que sin frase no se recupera", async () => {
    const api = servidorRespaldos();
    const { usuario } = await abrirSeccion(api, "Respaldos");
    const guardar = await screen.findByRole("button", { name: "Guardar configuración" });
    expect(screen.getByText(/Sin la frase no se puede recuperar/)).toBeInTheDocument();
    expect(guardar).toBeDisabled();
    await usuario.type(screen.getByLabelText("Carpeta de la nube"), "C:\\Nube\\Respaldos");
    await usuario.type(screen.getByLabelText("Frase de cifrado"), "corta");
    await usuario.click(screen.getByRole("checkbox", { name: "Ya anoté la frase en un lugar seguro" }));
    expect(guardar).toBeDisabled(); // frase corta
    await usuario.clear(screen.getByLabelText("Frase de cifrado"));
    await usuario.type(screen.getByLabelText("Frase de cifrado"), "una-frase-bien-larga");
    expect(guardar).toBeEnabled();
    await usuario.click(guardar);
    expect(await screen.findByText(/Copia en la nube configurada/)).toBeInTheDocument();
    expect(api.llamadasA("PUT /api/respaldos/nube")[0]?.cuerpo).toEqual({ carpeta: "C:\\Nube\\Respaldos", frase: "una-frase-bien-larga" });
    expect(await screen.findByRole("button", { name: "Copiar a la nube ahora" })).toBeInTheDocument();
  });

  it("restaurar pide contraseña y confirmación; un error de contraseña se muestra y no queda nada pendiente", async () => {
    const api = servidorRespaldos();
    const { usuario } = await abrirSeccion(api, "Respaldos");
    const preparar = await screen.findByRole("button", { name: "Preparar restauración" });
    expect(preparar).toBeDisabled();
    await usuario.type(screen.getByLabelText("Su contraseña de administrador"), "mala");
    await usuario.click(screen.getByRole("checkbox", { name: "Entiendo que se reemplazarán todos los datos actuales" }));
    await usuario.click(preparar);
    expect(await screen.findByText("La contraseña no es correcta")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Restauración pendiente" })).toBeNull();
  });

  it("con la contraseña correcta queda «pendiente» y se puede cancelar", async () => {
    const api = servidorRespaldos();
    const { usuario } = await abrirSeccion(api, "Respaldos");
    await usuario.type(await screen.findByLabelText("Su contraseña de administrador"), "ClaveAdmin1");
    await usuario.click(screen.getByRole("checkbox", { name: "Entiendo que se reemplazarán todos los datos actuales" }));
    await usuario.click(screen.getByRole("button", { name: "Preparar restauración" }));
    const pendiente = await screen.findByRole("region", { name: "Restauración pendiente" });
    expect(within(pendiente).getByText(/Cierre la aplicación por completo/)).toBeInTheDocument();
    const enviado = api.llamadasA("POST /api/respaldos/restaurar")[0]?.cuerpo as Record<string, unknown>;
    expect(enviado).toEqual({ origen: "local", archivo: LOCALES[0]?.archivo, password: "ClaveAdmin1" });
    await usuario.click(within(pendiente).getByRole("button", { name: "Cancelar restauración" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Restauración pendiente" })).toBeNull());
    expect(api.llamadasA("DELETE /api/respaldos/restaurar")).toHaveLength(1);
  });
});

// ── Privacidad y reporte de errores ──────────────────────────

function servidorTelemetria(): { api: ApiSimulada; estado: Record<string, unknown> } {
  const estado: Record<string, unknown> = { consentimiento: false, desde: null, instalacion: "id-1", pendientes: 0, destinoConfigurado: false, ultimoEnvio: null };
  const reportes = [{ id: "r1", fecha: "2026-11-25T10:00:00.000Z", version: "1.0.0", plataforma: "win32-x64", origen: "interfaz", vista: "venta", mensaje: "TypeError: x is undefined", pila: null }];
  const api = servidorBasico(new ApiSimulada())
    .en("GET /api/telemetria", () => ({ cuerpo: estado }))
    .en("PUT /api/telemetria", (p) => {
      const si = (p.cuerpo as { consentimiento: boolean }).consentimiento;
      Object.assign(estado, { consentimiento: si, desde: si ? "2026-11-25T11:00:00.000Z" : null, pendientes: si ? 1 : 0 });
      return { cuerpo: estado };
    })
    .en("GET /api/telemetria/pendientes", () => ({ cuerpo: { reportes: estado["consentimiento"] === true ? reportes : [], estado } }))
    .en("POST /api/telemetria/errores", { status: 204 });
  return { api, estado };
}

describe("Ajustes › Privacidad", () => {
  it("está desactivada por defecto y explica qué se reúne y qué nunca", async () => {
    const { api } = servidorTelemetria();
    await abrirSeccion(api, "Privacidad");
    const caja = await screen.findByRole("checkbox", { name: "Enviar reportes de errores técnicos" });
    expect(caja).not.toBeChecked();
    expect(screen.getByText("Qué NUNCA se reúne")).toBeInTheDocument();
    expect(screen.getByText(/Ventas, clientes, productos ni precios/)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Reportes pendientes" })).toBeNull();
  });

  it("al activarla se puede ver exactamente lo que se enviaría; sin servidor de destino no se puede enviar", async () => {
    const { api } = servidorTelemetria();
    const { usuario } = await abrirSeccion(api, "Privacidad");
    await usuario.click(await screen.findByRole("checkbox", { name: "Enviar reportes de errores técnicos" }));
    expect(api.llamadasA("PUT /api/telemetria")[0]?.cuerpo).toEqual({ consentimiento: true });
    const seccion = await screen.findByRole("region", { name: "Reportes pendientes" });
    expect(within(seccion).getByText(/no tiene un servidor de destino/)).toBeInTheDocument();
    expect(within(seccion).getByRole("button", { name: "Enviar ahora" })).toBeDisabled();
    await usuario.click(within(seccion).getByRole("button", { name: "Ver reportes pendientes" }));
    expect(await screen.findByLabelText("Vista previa de los reportes")).toHaveTextContent("TypeError: x is undefined");
  });

  it("desactivarla vuelve a ocultar los pendientes", async () => {
    const { api } = servidorTelemetria();
    const { usuario } = await abrirSeccion(api, "Privacidad");
    const caja = await screen.findByRole("checkbox", { name: "Enviar reportes de errores técnicos" });
    await usuario.click(caja);
    await screen.findByRole("region", { name: "Reportes pendientes" });
    await usuario.click(caja);
    await waitFor(() => expect(screen.queryByRole("region", { name: "Reportes pendientes" })).toBeNull());
    expect(api.llamadasA("PUT /api/telemetria").map((l) => l.cuerpo)).toEqual([{ consentimiento: true }, { consentimiento: false }]);
  });
});

describe("Límite de errores y reporte desde la interfaz", () => {
  const Roto = (): React.JSX.Element => {
    throw new Error("falló el dibujo");
  };

  it("un fallo de dibujo muestra un aviso en lugar de una pantalla en blanco, lo informa y se recupera al cambiar de vista", () => {
    const alError = vi.fn();
    const consola = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { rerender } = render(<LimiteErrores clave="venta" alError={alError}><Roto /></LimiteErrores>);
    expect(screen.getByRole("alert")).toHaveTextContent("Esta pantalla tuvo un problema");
    expect(alError).toHaveBeenCalledTimes(1);
    expect((alError.mock.calls[0]?.[0] as Error).message).toBe("falló el dibujo");
    rerender(<LimiteErrores clave="caja" alError={alError}><p>pantalla sana</p></LimiteErrores>);
    expect(screen.getByText("pantalla sana")).toBeInTheDocument();
    consola.mockRestore();
  });

  it("«Volver a intentar» reintenta dibujar la vista", async () => {
    const consola = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let roto = true;
    const Variable = (): React.JSX.Element => (roto ? <Roto /> : <p>recuperada</p>);
    render(<LimiteErrores clave="x"><Variable /></LimiteErrores>);
    roto = false;
    await userEvent.click(screen.getByRole("button", { name: "Volver a intentar" }));
    expect(screen.getByText("recuperada")).toBeInTheDocument();
    consola.mockRestore();
  });

  it("con consentimiento, un error no capturado de la ventana se informa; sin consentimiento no se envía nada", async () => {
    const { api, estado } = servidorTelemetria();
    estado["consentimiento"] = true;
    renderizarPos({ api, usuario: ADMIN });
    await screen.findByRole("navigation", { name: "Menú principal" });
    await waitFor(() => expect(api.llamadasA("GET /api/telemetria").length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 50));
    fireEvent(window, new ErrorEvent("error", { error: new Error("explotó algo"), message: "explotó algo" }));
    await waitFor(() => expect(api.llamadasA("POST /api/telemetria/errores")).toHaveLength(1));
    expect(api.llamadasA("POST /api/telemetria/errores")[0]?.cuerpo).toMatchObject({ origen: "interfaz", mensaje: "Error: explotó algo" });
  });

  it("sin consentimiento la interfaz ni siquiera envía la petición", async () => {
    const { api } = servidorTelemetria();
    renderizarPos({ api, usuario: ADMIN });
    await screen.findByRole("navigation", { name: "Menú principal" });
    await waitFor(() => expect(api.llamadasA("GET /api/telemetria").length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 50));
    fireEvent(window, new ErrorEvent("error", { error: new Error("otro fallo"), message: "otro fallo" }));
    await new Promise((r) => setTimeout(r, 100));
    expect(api.llamadasA("POST /api/telemetria/errores")).toHaveLength(0);
  });
});

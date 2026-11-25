// @vitest-environment jsdom
// ============================================================
// tests/unit/renderer/licencia.test.tsx — Aviso de licencia en el marco y pestaña Ajustes › Licencia (API simulada)
// ============================================================
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { EstadoLicencia } from "../../../src/shared/types/licencia.types";
import { ApiSimulada, renderizarPos, servidorBasico, usuarioDe, USUARIO } from "../../helpers/renderer/entorno";

const ADMIN = { ...USUARIO, id: "u-admin", username: "dueno", rol: "ADMIN", permisos: ["configuracion:leer", "configuracion:actualizar", "caja:crear", "caja:leer", "ventas:crear", "clientes:leer"] };

const estado = (c: Partial<EstadoLicencia>): EstadoLicencia => ({
  tipo: "ACTIVA", permiteOperar: true, mensaje: "Licencia activa hasta el 01/12/2027.", plan: "PRO", vence: "2027-12-01T12:00:00.000Z", diasParaVencer: 365, ultimaValidacion: "2026-12-01T12:00:00.000Z",
  diasGraciaRestantes: null, maxDispositivos: 2, claveEnmascarada: "ABCD-••••-••••-WXYZ", dispositivoId: "eq1", ...c,
});
const SIN: EstadoLicencia = estado({ tipo: "SIN_LICENCIA", permiteOperar: false, mensaje: "Active su licencia para registrar ventas. Sus datos y reportes siguen disponibles.", plan: null, vence: null, diasParaVencer: null, ultimaValidacion: null, maxDispositivos: null, claveEnmascarada: null });

function servidor(inicial: EstadoLicencia): { api: ApiSimulada; fijar: (e: EstadoLicencia) => void } {
  let actual = inicial;
  const api = servidorBasico(new ApiSimulada()).en("GET /api/licencia", () => ({ cuerpo: actual }));
  return { api, fijar: (e) => { actual = e; } };
}

describe("Aviso de licencia en el marco", () => {
  it("no aparece con licencia activa, sin licenciamiento ni cuando el servidor no responde", async () => {
    for (const api of [
      servidor(estado({})).api,
      servidorBasico(new ApiSimulada()), // NO_REQUERIDA
      servidorBasico(new ApiSimulada()).en("GET /api/licencia", { status: 500, cuerpo: { error: "ERROR_INTERNO", mensaje: "x" } }),
    ]) {
      const { unmount } = renderizarPos({ api, usuario: ADMIN });
      await screen.findByRole("navigation", { name: "Menú principal" });
      await waitFor(() => expect(api.llamadasA("GET /api/licencia").length).toBeGreaterThan(0));
      expect(screen.queryByLabelText("Licencia")).toBeNull();
      unmount();
    }
  });

  it("sin licencia bloquea con alerta; el administrador puede ir directo a Ajustes › Licencia", async () => {
    const { api } = servidor(SIN);
    const { usuario } = renderizarPos({ api, usuario: ADMIN });
    const aviso = await screen.findByRole("alert", { name: "Licencia" });
    expect(aviso).toHaveTextContent("No se puede vender. Active su licencia");
    await usuario.click(within(aviso).getByRole("button", { name: "Abrir Ajustes › Licencia" }));
    expect(await screen.findByRole("form", { name: "Activar licencia" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Licencia", selected: true })).toBeInTheDocument();
  });

  it("un cajero ve el aviso con la indicación de avisar al administrador, sin el botón de Ajustes", async () => {
    const { api } = servidor(estado({ tipo: "BLOQUEADA_OFFLINE", permiteOperar: false, mensaje: "Hace más de 15 días que no se valida la licencia. Conecte este equipo a internet para continuar." }));
    renderizarPos({ api, usuario: usuarioDe("CAJERO") });
    const aviso = await screen.findByRole("alert", { name: "Licencia" });
    expect(aviso).toHaveTextContent("Conecte este equipo a internet");
    expect(aviso).toHaveTextContent("Avise al administrador");
    expect(within(aviso).queryByRole("button")).toBeNull();
  });

  it("en gracia o por vencer avisa sin bloquear (estado, no alerta)", async () => {
    for (const e of [
      estado({ tipo: "GRACIA", mensaje: "No se ha podido validar la licencia en línea. Podrá seguir vendiendo 12 días más.", diasGraciaRestantes: 12 }),
      estado({ tipo: "POR_VENCER", mensaje: "La suscripción vence en 5 días (06/12/2026). Renuévela.", diasParaVencer: 5 }),
    ]) {
      const { unmount } = renderizarPos({ api: servidor(e).api, usuario: ADMIN });
      const aviso = await screen.findByRole("status", { name: "Licencia" });
      expect(aviso).toHaveTextContent(e.mensaje);
      expect(aviso).not.toHaveTextContent("No se puede vender");
      unmount();
    }
  });
});

describe("Arranque sin licencia", () => {
  it("el administrador no queda atrapado en «Abrir turno»: entra a Ajustes para activar y, al activarse, pasa a abrir turno", async () => {
    const { api, fijar } = servidor(SIN);
    api.en("GET /api/turnos/actual", { status: 409, cuerpo: { error: "TURNO_REQUERIDO", mensaje: "Abra un turno" } });
    const { queryClient } = renderizarPos({ api, usuario: ADMIN, sinTurno: true });
    expect(await screen.findByRole("button", { name: "Ajustes", current: "page" })).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Apertura de turno" })).toBeNull();
    expect(await screen.findByRole("alert", { name: "Licencia" })).toBeInTheDocument();

    fijar(estado({}));
    await queryClient.invalidateQueries({ queryKey: ["licencia"] });
    expect(await screen.findByRole("form", { name: "Apertura de turno" })).toBeInTheDocument();
  });

  it("con la licencia vigente se abre turno como siempre", async () => {
    const api = servidor(estado({})).api;
    api.en("GET /api/turnos/actual", { status: 409, cuerpo: { error: "TURNO_REQUERIDO", mensaje: "Abra un turno" } });
    renderizarPos({ api, usuario: ADMIN, sinTurno: true });
    expect(await screen.findByRole("form", { name: "Apertura de turno" })).toBeInTheDocument();
  });
});

describe("Ajustes › Licencia", () => {
  async function abrir(api: ApiSimulada) {
    const r = renderizarPos({ api, usuario: ADMIN });
    await r.usuario.click(await screen.findByRole("button", { name: "Ajustes" }));
    await r.usuario.click(await screen.findByRole("tab", { name: "Licencia" }));
    return r;
  }
  const escribir = async (u: Awaited<ReturnType<typeof abrir>>["usuario"], etiqueta: string, texto: string): Promise<void> => {
    await u.clear(screen.getByLabelText(etiqueta));
    await u.type(screen.getByLabelText(etiqueta), texto);
  };

  it("sin licenciamiento solo informa", async () => {
    await abrir(servidorBasico(new ApiSimulada()));
    expect(await screen.findByText("Licenciamiento no requerido en esta instalación")).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Activar licencia" })).toBeNull();
  });

  it("activa con la clave (en mayúsculas), muestra el resultado y el estado pasa a activa", async () => {
    const { api, fijar } = servidor(SIN);
    api.en("POST /api/licencia/activar", () => { const e = estado({}); fijar(e); return { cuerpo: e }; });
    api.en("GET /api/licencia/dispositivos", { cuerpo: { maximo: 2, dispositivos: [{ id: "eq1", nombre: "CAJA-1", plataforma: "win32", ultimoUso: null, esEste: true }] } });
    const { usuario } = await abrir(api);
    expect(await screen.findByLabelText("Estado de la licencia")).toHaveTextContent("Sin activar");
    const boton = screen.getByRole("button", { name: "Activar" });
    expect(boton).toBeDisabled();
    await escribir(usuario, "Clave de activación", "abcd-1234-5678-wxyz");
    await usuario.click(boton);
    await waitFor(() => expect(api.llamadasA("POST /api/licencia/activar")[0]?.cuerpo).toEqual({ clave: "ABCD-1234-5678-WXYZ" }));
    // el resultado se muestra como confirmación y en el cuadro de estado
    expect(await screen.findAllByText("Licencia activa hasta el 01/12/2027.")).toHaveLength(2);
    await waitFor(() => expect(screen.getByLabelText("Estado de la licencia")).toHaveTextContent("Activa"));
    expect(screen.getByLabelText("Estado de la licencia")).toHaveTextContent("ABCD-••••-••••-WXYZ");
    expect(screen.getByLabelText("Estado de la licencia")).toHaveTextContent("PRO");
  });

  it("un rechazo del servidor (clave inexistente, límite de equipos) se muestra tal cual y no cambia el estado", async () => {
    const { api } = servidor(SIN);
    api.en("POST /api/licencia/activar", { status: 409, cuerpo: { error: "ESTADO_INVALIDO", mensaje: "Se alcanzó el número de equipos que permite el plan. Libere uno para activar este. Equipos registrados: CAJA-7." } });
    const { usuario } = await abrir(api);
    await escribir(usuario, "Clave de activación", "ABCD-1234-5678-WXYZ");
    await usuario.click(screen.getByRole("button", { name: "Activar" }));
    expect(await screen.findByText(/Equipos registrados: CAJA-7/)).toBeInTheDocument();
    expect(screen.getByLabelText("Estado de la licencia")).toHaveTextContent("Sin activar");
  });

  it("«Validar ahora» explica si no hubo conexión y confirma si se validó", async () => {
    const { api } = servidor(estado({}));
    api.en("GET /api/licencia/dispositivos", { cuerpo: { maximo: 2, dispositivos: [] } });
    api.en("POST /api/licencia/validar", { cuerpo: { estado: estado({}), error: "No se pudo comunicar con el servidor de licencias. Revise la conexión a internet." } });
    const { usuario } = await abrir(api);
    await usuario.click(await screen.findByRole("button", { name: "Validar ahora" }));
    expect(await screen.findByText(/No se pudo validar ahora: No se pudo comunicar/)).toBeInTheDocument();
    api.en("POST /api/licencia/validar", { cuerpo: { estado: estado({}), error: null } });
    await usuario.click(screen.getByRole("button", { name: "Validar ahora" }));
    expect(await screen.findByText("Licencia validada con el servidor")).toBeInTheDocument();
  });

  it("muestra los equipos, marca el actual y libera otro solo tras confirmar", async () => {
    const { api } = servidor(estado({}));
    let lista = [
      { id: "eq1", nombre: "CAJA-1", plataforma: "win32", ultimoUso: "2026-12-01T10:00:00Z", esEste: true },
      { id: "eq2", nombre: "CAJA-2", plataforma: "win32", ultimoUso: null, esEste: false },
    ];
    api.en("GET /api/licencia/dispositivos", () => ({ cuerpo: { maximo: 2, dispositivos: lista } }));
    api.en("POST /api/licencia/dispositivos/eq2/liberar", () => { lista = lista.slice(0, 1); return { cuerpo: { maximo: 2, dispositivos: lista } }; });
    const { usuario } = await abrir(api);
    const equipos = await screen.findByRole("list", { name: "Equipos" });
    expect(screen.getByText("2 de 2 plazas en uso")).toBeInTheDocument();
    expect(within(equipos).getAllByRole("listitem")).toHaveLength(2);
    expect(within(equipos).getByText("Este equipo")).toBeInTheDocument();
    expect(within(equipos).getAllByRole("button", { name: "Liberar" })).toHaveLength(1); // el propio equipo no se libera desde aquí

    await usuario.click(within(equipos).getByRole("button", { name: "Liberar" }));
    expect(api.llamadasA("POST /api/licencia/dispositivos/eq2/liberar")).toHaveLength(0);
    await usuario.click(screen.getByRole("button", { name: "Cancelar" }));
    await usuario.click(within(equipos).getByRole("button", { name: "Liberar" }));
    await usuario.click(screen.getByRole("button", { name: "Sí, liberar" }));
    expect(await screen.findByText("Equipo liberado")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("1 de 2 plazas en uso")).toBeInTheDocument());
  });

  it("desactivar este equipo exige confirmar, y un error (sin conexión) se muestra sin perder la licencia", async () => {
    const { api, fijar } = servidor(estado({}));
    api.en("GET /api/licencia/dispositivos", { cuerpo: { maximo: 2, dispositivos: [] } });
    api.en("DELETE /api/licencia", { status: 409, cuerpo: { error: "ESTADO_INVALIDO", mensaje: "No se pudo comunicar con el servidor de licencias. Revise la conexión a internet." } });
    const { usuario } = await abrir(api);
    const desactivar = await screen.findByRole("button", { name: "Desactivar este equipo" });
    expect(desactivar).toBeDisabled();
    await usuario.click(screen.getByLabelText("Entiendo que este equipo dejará de poder vender"));
    await usuario.click(desactivar);
    expect(await screen.findByText(/No se pudo comunicar con el servidor de licencias/)).toBeInTheDocument();
    expect(screen.getByLabelText("Estado de la licencia")).toHaveTextContent("Activa");

    api.en("DELETE /api/licencia", () => { fijar(SIN); return { cuerpo: SIN }; });
    await usuario.click(screen.getByRole("button", { name: "Desactivar este equipo" }));
    expect(await screen.findByText(/la plaza está libre para otro equipo/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Estado de la licencia")).toHaveTextContent("Sin activar"));
  });
});

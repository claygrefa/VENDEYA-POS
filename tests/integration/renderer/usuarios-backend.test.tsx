// @vitest-environment jsdom
// ============================================================
// tests/integration/renderer/usuarios-backend.test.tsx
// Ajustes › Usuarios y Sucursales y «Mi contraseña» (interfaz real) contra el backend REAL: lo que el administrador hace en pantalla
// queda en la base de datos, y los rechazos del servidor se explican sin cerrar su sesión.
// ============================================================
import "@testing-library/jest-dom/vitest";
import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, configure, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { crearQueryClient } from "../../../src/renderer/App";
import { CambiarPassword } from "../../../src/renderer/components/CambiarPassword";
import { AjustesPage } from "../../../src/renderer/pages/AjustesPage";
import { ApiCliente } from "../../../src/renderer/services/api";
import { ProveedorPos, type ContextoPos } from "../../../src/renderer/services/contexto";
import { PosApi } from "../../../src/renderer/services/pos.api";
import { useNavegacion } from "../../../src/renderer/store/navegacion.store";
import { useSesion } from "../../../src/renderer/store/sesion.store";
import { SocketSimulado } from "../../helpers/renderer/entorno";
import { crearEntorno, PASSWORD_ADMIN, type Entorno } from "../helpers/entorno.helper";

configure({ asyncUtilTimeout: 8_000 });

let env: Entorno;

async function montar(pagina: React.ReactElement, permisos?: string[]) {
  const api = new PosApi(new ApiCliente({ baseUrl: env.backend.url, cajaId: "caja-usuarios", obtenerToken: () => useSesion.getState().token, alNoAutenticado: () => useSesion.getState().cerrar() }));
  const entrada = await api.login("admin", PASSWORD_ADMIN);
  useSesion.setState({ token: entrada.token, usuario: permisos === undefined ? entrada.usuario : { ...entrada.usuario, permisos }, turno: null, puntoEmision: null, modoTactil: false });
  useNavegacion.setState({ vista: null, seccionAjustes: null });
  const contexto: ContextoPos = { api, crearSocket: (url) => new SocketSimulado(url), cajaId: "caja-usuarios" };
  const vista = render(
    <QueryClientProvider client={crearQueryClient()}>
      <ProveedorPos valor={contexto}>{pagina}</ProveedorPos>
    </QueryClientProvider>
  );
  return { ...vista, u: userEvent.setup({ delay: null }) };
}

type U = ReturnType<typeof userEvent.setup>;
const escribir = async (u: U, en: HTMLElement, etiqueta: string, texto: string): Promise<void> => {
  const campo = within(en).getByLabelText(etiqueta);
  await u.clear(campo);
  await u.type(campo, texto);
};
const dialogo = async (nombre: string | RegExp): Promise<HTMLElement> => screen.findByRole("dialog", { name: nombre });

beforeAll(async () => {
  env = await crearEntorno();
}, 60_000);

afterEach(() => cleanup());

afterAll(async () => {
  await env.cerrar();
});

describe("Ajustes › Usuarios", () => {
  it("el administrador crea, edita, cambia la contraseña y desactiva usuarios; todo queda en la base y su sesión sigue abierta", async () => {
    const { u } = await montar(<AjustesPage />);
    await u.click(await screen.findByRole("tab", { name: "Usuarios" }));
    const tabla = await screen.findByRole("table", { name: "Usuarios" });
    expect(await within(tabla).findByText(/admin \(usted\)/)).toBeInTheDocument();
    // sobre sí mismo solo se edita: ni contraseña (tiene su propio botón) ni desactivar
    expect(within(tabla).getByRole("button", { name: "Editar admin" })).toBeInTheDocument();
    expect(within(tabla).queryByRole("button", { name: /Desactivar admin/ })).toBeNull();

    // ── Alta ──
    await u.click(screen.getByRole("button", { name: "Nuevo usuario" }));
    let d = await dialogo("Nuevo usuario");
    await escribir(u, d, "Nombre de usuario", "Maria.Perez");
    await escribir(u, d, "Contraseña", "corta");
    await escribir(u, d, "Nombre", "María");
    await escribir(u, d, "Apellido", "Pérez");
    await u.click(within(d).getByRole("button", { name: "Crear usuario" }));
    expect(await within(d).findByRole("alert")).toHaveTextContent(/al menos 8 caracteres/); // el rechazo del servidor se muestra y el formulario sigue
    await escribir(u, d, "Contraseña", "Clave12345");
    await u.click(within(d).getByRole("button", { name: "Crear usuario" }));
    expect(await screen.findByText("Usuario maria.perez creado")).toBeInTheDocument();
    const creado = await env.prisma.usuario.findUniqueOrThrow({ where: { username: "maria.perez" }, include: { rol: true } });
    expect(creado).toMatchObject({ nombre: "María", apellido: "Pérez", status: "ACTIVO" });
    expect(creado.rol.nombre).toBe("CAJERO");
    expect(creado.passwordHash).toMatch(/^scrypt\$/);

    // ── Cambio de rol ──
    await u.click(await screen.findByRole("button", { name: "Editar maria.perez" }));
    d = await dialogo("Editar maria.perez");
    await within(d).findByRole("option", { name: "BODEGUERO" }); // los roles llegan del servidor
    await u.selectOptions(within(d).getByLabelText("Rol"), "BODEGUERO");
    expect(await within(d).findByText(/se cerrará la sesión de maria.perez/)).toBeInTheDocument();
    await u.click(within(d).getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText("Datos de maria.perez guardados")).toBeInTheDocument();
    expect((await env.prisma.usuario.findUniqueOrThrow({ where: { username: "maria.perez" }, include: { rol: true } })).rol.nombre).toBe("BODEGUERO");

    // ── Contraseña: la confirmación errónea se explica y NO cierra la sesión del administrador ──
    await u.click(screen.getByRole("button", { name: "Contraseña de maria.perez" }));
    d = await dialogo("Nueva contraseña para maria.perez");
    await escribir(u, d, "Contraseña nueva", "NuevaClave99");
    await escribir(u, d, "Repita la contraseña nueva", "NuevaClave99");
    await escribir(u, d, "Su contraseña (administrador)", "no-es-la-mia");
    await u.click(within(d).getByRole("button", { name: "Cambiar contraseña" }));
    expect(await within(d).findByRole("alert")).toHaveTextContent("La contraseña no es correcta");
    expect(useSesion.getState().token).not.toBeNull();
    await escribir(u, d, "Su contraseña (administrador)", PASSWORD_ADMIN);
    await u.click(within(d).getByRole("button", { name: "Cambiar contraseña" }));
    expect(await screen.findByText(/Contraseña de maria.perez cambiada/)).toBeInTheDocument();
    const api = new PosApi(new ApiCliente({ baseUrl: env.backend.url, cajaId: "x", obtenerToken: () => null }));
    await expect(api.login("maria.perez", "Clave12345")).rejects.toMatchObject({ status: 401 });
    expect((await api.login("maria.perez", "NuevaClave99")).usuario.rol).toBe("BODEGUERO");

    // ── Desactivar ──
    await u.click(screen.getByRole("button", { name: "Desactivar maria.perez" }));
    d = await dialogo("Desactivar a maria.perez");
    await u.click(within(d).getByRole("button", { name: "Sí, desactivar" }));
    expect(await screen.findByText("maria.perez quedó desactivado")).toBeInTheDocument();
    await waitFor(async () => expect((await env.prisma.usuario.findUniqueOrThrow({ where: { username: "maria.perez" } })).status).toBe("INACTIVO"));
    expect(await within(await screen.findByRole("table", { name: "Usuarios" })).findByText("Inactivo")).toBeInTheDocument();
    await expect(api.login("maria.perez", "NuevaClave99")).rejects.toMatchObject({ codigo: "USUARIO_INACTIVO" });

    // el filtro «Inactivos» solo la deja a ella
    await u.selectOptions(screen.getByLabelText("Estado"), "INACTIVO");
    await waitFor(() => expect(within(screen.getByRole("table", { name: "Usuarios" })).queryByText(/admin \(usted\)/)).toBeNull());
    expect(within(screen.getByRole("table", { name: "Usuarios" })).getByRole("button", { name: "Activar maria.perez" })).toBeInTheDocument();
  });

  it("un usuario con turno abierto no se desactiva: el motivo se muestra en el diálogo", async () => {
    const cajero = await env.prisma.usuario.findUniqueOrThrow({ where: { username: "maria.perez" } });
    await env.prisma.usuario.update({ where: { id: cajero.id }, data: { status: "ACTIVO" } });
    const turno = await env.prisma.turnoCaja.create({ data: { sucursalId: env.seed.sucursalId, cajeroId: cajero.id, montoApertura: 20 } });
    const { u } = await montar(<AjustesPage />);
    await u.click(await screen.findByRole("tab", { name: "Usuarios" }));
    await u.click(await screen.findByRole("button", { name: "Desactivar maria.perez" }));
    const d = await dialogo("Desactivar a maria.perez");
    await u.click(within(d).getByRole("button", { name: "Sí, desactivar" }));
    expect(await within(d).findByRole("alert")).toHaveTextContent(/turno de caja abierto/);
    expect((await env.prisma.usuario.findUniqueOrThrow({ where: { id: cajero.id } })).status).toBe("ACTIVO");
    await env.prisma.turnoCaja.update({ where: { id: turno.id }, data: { estado: "CERRADO" } });
  });

  it("quien no administra usuarios no ve la pestaña, aunque pueda cambiar la configuración", async () => {
    await montar(<AjustesPage />, ["configuracion:leer", "configuracion:actualizar"]);
    await screen.findByRole("tab", { name: "Sucursales" });
    expect(screen.queryByRole("tab", { name: "Usuarios" })).toBeNull();
  });
});

describe("Ajustes › Sucursales", () => {
  it("crea una sucursal con su caja, agrega y desactiva cajas, y el POS recibe los cambios", async () => {
    const { u } = await montar(<AjustesPage />);
    await u.click(await screen.findByRole("tab", { name: "Sucursales" }));
    const matriz = await screen.findByRole("listitem", { name: "Sucursal 001" });
    expect(within(matriz).getByText(/001-001 · Caja principal/)).toBeInTheDocument();
    expect(screen.getByText(/registrado en el SRI/)).toBeInTheDocument();

    await u.click(screen.getByRole("button", { name: "Nueva sucursal" }));
    let d = await dialogo("Nueva sucursal");
    await escribir(u, d, "Nombre", "Norte");
    await escribir(u, d, "Dirección", "Av. Principal 123 y Calle 2");
    await escribir(u, d, "Teléfono", "abc");
    await u.click(within(d).getByRole("button", { name: "Crear sucursal" }));
    expect(await within(d).findByRole("alert")).toHaveTextContent(/Teléfono inválido/);
    await escribir(u, d, "Teléfono", "022345678");
    await u.click(within(d).getByRole("button", { name: "Crear sucursal" }));
    expect(await screen.findByText("Sucursal 002 creada con su caja 002-001")).toBeInTheDocument();
    const norte = await screen.findByRole("listitem", { name: "Sucursal 002" });
    expect(within(norte).getByText(/002-001 · Caja principal/)).toBeInTheDocument();

    await u.click(within(norte).getByRole("button", { name: "Agregar caja a Norte" }));
    d = await dialogo("Nueva caja en Norte");
    await escribir(u, d, "Descripción de la caja", "Caja 2");
    await u.click(within(d).getByRole("button", { name: "Agregar caja" }));
    expect(await within(await screen.findByRole("listitem", { name: "Sucursal 002" })).findByText(/002-002 · Caja 2/)).toBeInTheDocument();
    expect((await env.prisma.puntoEmision.findMany({ where: { sucursal: { codigo: "002" } }, orderBy: { codigo: "asc" } })).map((p) => p.codigo)).toEqual(["001", "002"]);

    // desactivar la caja 002-002
    await u.click(within(await screen.findByRole("listitem", { name: "Sucursal 002" })).getByRole("button", { name: "Editar caja 002-002" }));
    d = await dialogo("Caja 002-002");
    await u.click(within(d).getByLabelText("Caja activa"));
    await u.click(within(d).getByRole("button", { name: "Guardar" }));
    expect(await within(await screen.findByRole("listitem", { name: "Sucursal 002" })).findByText(/002-002 · Caja 2 \(inactiva\)/)).toBeInTheDocument();

    // desactivar la sucursal Norte: el POS deja de ofrecerla
    await u.click(within(await screen.findByRole("listitem", { name: "Sucursal 002" })).getByRole("button", { name: "Desactivar Norte" }));
    d = await dialogo("Desactivar Norte");
    await u.click(within(d).getByRole("button", { name: "Sí, desactivar" }));
    expect(await screen.findByText("Sucursal 002 desactivada")).toBeInTheDocument();
    expect(await within(await screen.findByRole("listitem", { name: "Sucursal 002" })).findByText("Inactiva")).toBeInTheDocument();
    const api = new PosApi(new ApiCliente({ baseUrl: env.backend.url, cajaId: "x", obtenerToken: () => useSesion.getState().token }));
    expect((await api.puntosEmision()).map((p) => `${p.sucursal.codigo}-${p.codigo}`)).toEqual(["001-001"]);

    // la única sucursal activa no se puede desactivar: el motivo se explica
    await u.click(within(await screen.findByRole("listitem", { name: "Sucursal 001" })).getByRole("button", { name: /Desactivar /i }));
    d = await dialogo(/Desactivar /);
    await u.click(within(d).getByRole("button", { name: "Sí, desactivar" }));
    expect(await within(d).findByRole("alert")).toHaveTextContent(/ningún punto de emisión activo/);
    expect(useSesion.getState().token).not.toBeNull();
  });
});

describe("Mi contraseña", () => {
  it("valida lo que escribe, rechaza la actual equivocada sin cerrar la sesión y cambia la contraseña", async () => {
    const cerrado: string[] = [];
    const { u } = await montar(<CambiarPassword onCerrar={() => cerrado.push("cerrado")} />);
    const d = await dialogo("Cambiar mi contraseña");
    await escribir(u, d, "Contraseña actual", PASSWORD_ADMIN);
    await escribir(u, d, "Contraseña nueva", "OtraClave2026");
    await escribir(u, d, "Repita la contraseña nueva", "Distinta1234");
    await u.click(within(d).getByRole("button", { name: "Cambiar contraseña" }));
    expect(await within(d).findByRole("alert")).toHaveTextContent("Las contraseñas nuevas no coinciden");

    await escribir(u, d, "Contraseña actual", "no-es-la-mia");
    await escribir(u, d, "Repita la contraseña nueva", "OtraClave2026");
    await u.click(within(d).getByRole("button", { name: "Cambiar contraseña" }));
    expect(await within(d).findByRole("alert")).toHaveTextContent("La contraseña no es correcta");
    expect(useSesion.getState().token).not.toBeNull(); // un error de confirmación no es una sesión vencida

    await escribir(u, d, "Contraseña actual", PASSWORD_ADMIN);
    await u.click(within(d).getByRole("button", { name: "Cambiar contraseña" }));
    expect(await screen.findByText(/Su contraseña se cambió/)).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Aceptar" }));
    expect(cerrado).toEqual(["cerrado"]);
    const api = new PosApi(new ApiCliente({ baseUrl: env.backend.url, cajaId: "x", obtenerToken: () => null }));
    await expect(api.login("admin", PASSWORD_ADMIN)).rejects.toMatchObject({ status: 401 });
    expect((await api.login("admin", "OtraClave2026")).usuario.rol).toBe("ADMIN");
  });
});

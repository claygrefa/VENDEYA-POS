// ============================================================
// tests/integration/server/usuarios-sucursales.test.ts — Gestión de usuarios, sucursales y puntos de emisión
//   · alta, edición, desactivación y contraseñas con sus protecciones · cierre de sesiones al cambiar permisos
//   · aislamiento entre empresas · sucursales con código consecutivo, desactivación segura y efecto en el POS
// ============================================================
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearEntorno, PASSWORD_ADMIN, type Entorno } from "../helpers/entorno.helper";

let env: Entorno;
let tokenAdmin = "";
let tokenSupervisor = "";

type Metodo = "GET" | "POST" | "PATCH";
const api = (metodo: Metodo, url: string, token: string | null, payload?: unknown) =>
  env.backend.server.inject({
    method: metodo,
    url,
    ...(token !== null ? { headers: { authorization: `Bearer ${token}` } } : {}),
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });
const json = <T>(r: { json: () => unknown }): T => r.json() as T;
const login = async (username: string, password: string): Promise<{ status: number; token: string; error?: string }> => {
  const r = await api("POST", "/api/auth/login", null, { username, password });
  const c = json<{ token?: string; error?: string }>(r);
  return { status: r.statusCode, token: c.token ?? "", ...(c.error !== undefined ? { error: c.error } : {}) };
};
const yo = (token: string) => api("GET", "/api/auth/me", token);

interface Usuario { id: string; username: string; rol: string; estado: string; sesionesActivas: number; email: string | null; [campo: string]: unknown }
const nuevo = (extra: Record<string, unknown> = {}) => ({ username: "maria.perez", password: "Clave12345", rol: "CAJERO", nombre: "María", apellido: "Pérez", ...extra });

beforeAll(async () => {
  env = await crearEntorno();
  tokenAdmin = (await login("admin", PASSWORD_ADMIN)).token;
  await env.servicios.usuarios.crear({ empresaId: env.seed.empresaId, rol: "SUPERVISOR", username: "super", password: "Clave12345", nombre: "Sup", apellido: "Test" });
  tokenSupervisor = (await login("super", "Clave12345")).token;
}, 60_000);

afterAll(async () => {
  await env.cerrar();
});

describe("Usuarios: alta y consulta", () => {
  it("el administrador crea un usuario: usuario en minúsculas, sin contraseña en la respuesta, y entra aunque escriba mayúsculas", async () => {
    const r = await api("POST", "/api/usuarios", tokenAdmin, nuevo({ username: "Maria.Perez", email: "maria@ejemplo.com" }));
    expect(r.statusCode).toBe(201);
    const u = json<Usuario>(r);
    expect(u).toMatchObject({ username: "maria.perez", rol: "CAJERO", estado: "ACTIVO", email: "maria@ejemplo.com", sesionesActivas: 0 });
    expect(JSON.stringify(u)).not.toMatch(/passwordHash|scrypt/);
    expect((await login("Maria.Perez", "Clave12345")).status).toBe(200);
    expect((await login("maria.perez", "Clave12345")).status).toBe(200);
  });

  it("no se repite un usuario (ni cambiando mayúsculas), rol inexistente y datos inválidos se rechazan", async () => {
    expect((await api("POST", "/api/usuarios", tokenAdmin, nuevo({ username: "MARIA.PEREZ" }))).statusCode).toBe(409);
    expect((await api("POST", "/api/usuarios", tokenAdmin, nuevo({ username: "otro", rol: "DUENO" }))).statusCode).toBe(400);
    expect((await api("POST", "/api/usuarios", tokenAdmin, nuevo({ username: "otro", password: "corta" }))).statusCode).toBe(400);
    expect((await api("POST", "/api/usuarios", tokenAdmin, nuevo({ username: "con espacio" }))).statusCode).toBe(400);
    expect((await api("POST", "/api/usuarios", tokenAdmin, nuevo({ username: "otro", email: "no-es-correo" }))).statusCode).toBe(400);
  });

  it("la lista filtra por texto y por estado, y muestra las sesiones abiertas", async () => {
    const todos = json<{ items: Usuario[] }>(await api("GET", "/api/usuarios", tokenAdmin)).items;
    expect(todos.map((u) => u.username).sort()).toEqual(["admin", "maria.perez", "super"]);
    expect(todos.find((u) => u.username === "maria.perez")?.sesionesActivas).toBe(2); // las dos entradas de la prueba anterior
    const porTexto = json<{ items: Usuario[] }>(await api("GET", "/api/usuarios?q=mar%C3%ADa", tokenAdmin)).items;
    expect(porTexto.map((u) => u.username)).toEqual(["maria.perez"]);
    expect(json<{ items: Usuario[] }>(await api("GET", "/api/usuarios?estado=INACTIVO", tokenAdmin)).items).toEqual([]);
    expect((await api("GET", "/api/usuarios?estado=otro", tokenAdmin)).statusCode).toBe(400);
  });

  it("los roles disponibles se listan con su descripción", async () => {
    const roles = json<{ items: Array<{ nombre: string; descripcion: string }> }>(await api("GET", "/api/roles", tokenAdmin)).items;
    expect(roles.map((r) => r.nombre).sort()).toEqual(["ADMIN", "BODEGUERO", "CAJERO", "COCINA", "CONTADOR", "MESERO", "SUPERVISOR"]);
    expect(roles.every((r) => r.descripcion.length > 0)).toBe(true);
  });

  it("el supervisor y el cajero no administran usuarios (403)", async () => {
    expect((await api("GET", "/api/usuarios", tokenSupervisor)).statusCode).toBe(403);
    expect((await api("POST", "/api/usuarios", tokenSupervisor, nuevo({ username: "intruso" }))).statusCode).toBe(403);
    const cajero = (await login("maria.perez", "Clave12345")).token;
    expect((await api("GET", "/api/usuarios", cajero)).statusCode).toBe(403);
  });
});

describe("Usuarios: edición y cambio de rol", () => {
  it("corrige nombre, contacto y vacía un campo; el nombre de usuario no cambia", async () => {
    const id = json<{ items: Usuario[] }>(await api("GET", "/api/usuarios?q=maria", tokenAdmin)).items[0]?.id as string;
    const r = await api("PATCH", `/api/usuarios/${id}`, tokenAdmin, { nombre: "Mariana", telefono: "0999999999", email: null, username: "otro.nombre" });
    expect(r.statusCode).toBe(200);
    expect(json<Usuario>(r)).toMatchObject({ username: "maria.perez", nombre: "Mariana", telefono: "0999999999", email: null });
    expect((await api("PATCH", `/api/usuarios/${id}`, tokenAdmin, { nombre: "" })).statusCode).toBe(400);
    expect((await api("PATCH", "/api/usuarios/no-existe", tokenAdmin, { nombre: "X" })).statusCode).toBe(404);
  });

  it("cambiar el rol cierra sus sesiones y al volver a entrar tiene los permisos del rol nuevo", async () => {
    const id = json<{ items: Usuario[] }>(await api("GET", "/api/usuarios?q=maria", tokenAdmin)).items[0]?.id as string;
    const antes = (await login("maria.perez", "Clave12345")).token;
    expect((await yo(antes)).statusCode).toBe(200);
    expect((await api("GET", "/api/productos", antes)).statusCode).toBe(200); // cajero: inventario:leer
    expect((await api("POST", "/api/productos", antes, {})).statusCode).toBe(403); // pero no crea productos
    const r = await api("PATCH", `/api/usuarios/${id}`, tokenAdmin, { rol: "BODEGUERO" });
    expect(json<Usuario>(r)).toMatchObject({ rol: "BODEGUERO", sesionesActivas: 0 });
    expect((await yo(antes)).statusCode).toBe(401); // la sesión con permisos viejos ya no sirve
    const despues = (await login("maria.perez", "Clave12345")).token;
    expect((await api("POST", "/api/productos", despues, {})).statusCode).toBe(400); // ahora pasa el permiso (falla la validación del cuerpo vacío)
  });

  it("nadie se cambia el rol a sí mismo", async () => {
    const yoMismo = json<{ items: Usuario[] }>(await api("GET", "/api/usuarios?q=admin", tokenAdmin)).items[0] as Usuario;
    const r = await api("PATCH", `/api/usuarios/${yoMismo.id}`, tokenAdmin, { rol: "CAJERO" });
    expect(r.statusCode).toBe(409);
    expect(json<{ mensaje: string }>(r).mensaje).toMatch(/propio rol/);
  });
});

describe("Usuarios: desactivar y reactivar", () => {
  let id = "";
  beforeAll(async () => {
    id = json<{ items: Usuario[] }>(await api("GET", "/api/usuarios?q=maria", tokenAdmin)).items[0]?.id as string;
  });

  it("no se desactiva a sí mismo", async () => {
    const admin = json<{ items: Usuario[] }>(await api("GET", "/api/usuarios?q=admin", tokenAdmin)).items[0] as Usuario;
    const r = await api("POST", `/api/usuarios/${admin.id}/estado`, tokenAdmin, { estado: "INACTIVO" });
    expect(r.statusCode).toBe(409);
    expect(json<{ mensaje: string }>(r).mensaje).toMatch(/propio usuario/);
  });

  it("la empresa no puede quedarse sin administrador activo (ni por desactivación ni por cambio de rol)", async () => {
    const admin = json<{ items: Usuario[] }>(await api("GET", "/api/usuarios?q=admin", tokenAdmin)).items[0] as Usuario;
    const otro = { id: "otro-actor", empresaId: env.seed.empresaId, username: "otro" }; // alguien que no es el administrador
    await expect(env.servicios.usuariosAdmin.cambiarEstado(otro, admin.id, { estado: "INACTIVO" })).rejects.toMatchObject({ codigo: "ESTADO_INVALIDO", message: expect.stringMatching(/único administrador/) });
    await expect(env.servicios.usuariosAdmin.actualizar(otro, admin.id, { rol: "SUPERVISOR" })).rejects.toMatchObject({ codigo: "ESTADO_INVALIDO", message: expect.stringMatching(/único administrador/) });
    // con un segundo administrador activo, sí se puede
    const segundo = json<Usuario>(await api("POST", "/api/usuarios", tokenAdmin, nuevo({ username: "admin2", rol: "ADMIN" })));
    await expect(env.servicios.usuariosAdmin.cambiarEstado(otro, admin.id, { estado: "INACTIVO" })).resolves.toMatchObject({ estado: "INACTIVO" });
    await env.servicios.usuariosAdmin.cambiarEstado(otro, admin.id, { estado: "ACTIVO" });
    tokenAdmin = (await login("admin", PASSWORD_ADMIN)).token; // al desactivarlo se cerró su sesión
    await api("POST", `/api/usuarios/${segundo.id}/estado`, tokenAdmin, { estado: "INACTIVO" });
  });

  it("con un turno de caja abierto no se puede desactivar; al cerrarlo sí", async () => {
    const turno = await env.prisma.turnoCaja.create({ data: { sucursalId: env.seed.sucursalId, cajeroId: id, montoApertura: 50 } });
    const r = await api("POST", `/api/usuarios/${id}/estado`, tokenAdmin, { estado: "INACTIVO" });
    expect(r.statusCode).toBe(409);
    expect(json<{ mensaje: string }>(r).mensaje).toMatch(/turno de caja abierto/);
    await env.prisma.turnoCaja.update({ where: { id: turno.id }, data: { estado: "CERRADO" } });
  });

  it("al desactivar se cierran sus sesiones y no puede entrar; al reactivar vuelve a entrar", async () => {
    const sesion = (await login("maria.perez", "Clave12345")).token;
    const r = await api("POST", `/api/usuarios/${id}/estado`, tokenAdmin, { estado: "INACTIVO" });
    expect(json<Usuario>(r)).toMatchObject({ estado: "INACTIVO", sesionesActivas: 0 });
    expect((await yo(sesion)).statusCode).toBe(401);
    expect(await login("maria.perez", "Clave12345")).toMatchObject({ status: 403, error: "USUARIO_INACTIVO" });
    expect(json<{ items: Usuario[] }>(await api("GET", "/api/usuarios?estado=INACTIVO", tokenAdmin)).items.map((u) => u.username)).toContain("maria.perez");
    // repetir la orden no falla
    expect((await api("POST", `/api/usuarios/${id}/estado`, tokenAdmin, { estado: "INACTIVO" })).statusCode).toBe(200);
    expect(json<Usuario>(await api("POST", `/api/usuarios/${id}/estado`, tokenAdmin, { estado: "ACTIVO" })).estado).toBe("ACTIVO");
    expect((await login("maria.perez", "Clave12345")).status).toBe(200);
    expect((await api("POST", `/api/usuarios/${id}/estado`, tokenAdmin, { estado: "BORRADO" })).statusCode).toBe(400);
  });
});

describe("Contraseñas", () => {
  let id = "";
  beforeAll(async () => {
    id = json<{ items: Usuario[] }>(await api("GET", "/api/usuarios?q=maria", tokenAdmin)).items[0]?.id as string;
  });

  it("el administrador restablece la de otra persona confirmando con la suya: una confirmación errónea es 400 (no 401, no cierra su sesión)", async () => {
    const mala = await api("POST", `/api/usuarios/${id}/password`, tokenAdmin, { passwordAdmin: "no-es-la-mia", password: "NuevaClave99" });
    expect(mala.statusCode).toBe(400);
    expect(json<{ mensaje: string }>(mala).mensaje).toMatch(/contraseña no es correcta/);
    expect((await yo(tokenAdmin)).statusCode).toBe(200);
    expect((await api("POST", `/api/usuarios/${id}/password`, tokenAdmin, { passwordAdmin: PASSWORD_ADMIN, password: "corta" })).statusCode).toBe(400);

    const sesion = (await login("maria.perez", "Clave12345")).token;
    const ok = await api("POST", `/api/usuarios/${id}/password`, tokenAdmin, { passwordAdmin: PASSWORD_ADMIN, password: "NuevaClave99" });
    expect(ok.statusCode).toBe(200);
    expect(JSON.stringify(ok.json())).not.toMatch(/scrypt|passwordHash/);
    expect((await yo(sesion)).statusCode).toBe(401);
    expect((await login("maria.perez", "Clave12345")).status).toBe(401);
    expect((await login("maria.perez", "NuevaClave99")).status).toBe(200);
  });

  it("para la suya el administrador usa «cambiar mi contraseña», no el restablecimiento", async () => {
    const admin = json<{ items: Usuario[] }>(await api("GET", "/api/usuarios?q=admin", tokenAdmin)).items.find((u) => u.username === "admin") as Usuario;
    const r = await api("POST", `/api/usuarios/${admin.id}/password`, tokenAdmin, { passwordAdmin: PASSWORD_ADMIN, password: "OtraClave123" });
    expect(r.statusCode).toBe(400);
    expect(json<{ mensaje: string }>(r).mensaje).toMatch(/Cambiar mi contraseña/);
  });

  it("cada usuario cambia la suya: exige la actual, la nueva distinta y deja abierta solo la sesión actual", async () => {
    const actual = (await login("maria.perez", "NuevaClave99")).token;
    const otraCaja = (await login("maria.perez", "NuevaClave99")).token;
    const equivocada = await api("POST", "/api/auth/password", actual, { actual: "no-es", nueva: "TerceraClave1" });
    expect(equivocada.statusCode).toBe(400); // 400: un 401 haría que la pantalla cierre la sesión
    expect((await yo(actual)).statusCode).toBe(200);
    expect((await api("POST", "/api/auth/password", actual, { actual: "NuevaClave99", nueva: "NuevaClave99" })).statusCode).toBe(400);
    expect((await api("POST", "/api/auth/password", actual, { actual: "NuevaClave99", nueva: "corta" })).statusCode).toBe(400);

    const ok = await api("POST", "/api/auth/password", actual, { actual: "NuevaClave99", nueva: "TerceraClave1" });
    expect(ok.statusCode).toBe(200);
    expect(json<{ sesionesCerradas: number }>(ok).sesionesCerradas).toBe(2); // la otra caja y la que dejó abierta la prueba anterior; la actual sigue
    expect((await yo(actual)).statusCode).toBe(200);
    expect((await yo(otraCaja)).statusCode).toBe(401);
    expect((await login("maria.perez", "NuevaClave99")).status).toBe(401);
    expect((await login("maria.perez", "TerceraClave1")).status).toBe(200);
  });
});

describe("Aislamiento entre empresas", () => {
  it("el administrador de una empresa no ve ni modifica usuarios o sucursales de otra", async () => {
    const rol = await env.prisma.rol.findUniqueOrThrow({ where: { nombre: "CAJERO" } });
    const otra = await env.prisma.empresa.create({
      data: { ruc: "1790011223001", razonSocial: "OTRA S.A.", nombreComercial: "OTRA", direccionMatriz: "Quito", telefono: "022222222", email: "o@o.com", tipoContribuyente: "SOCIEDAD", regimenTributario: "GENERAL" },
    });
    const ajeno = await env.prisma.usuario.create({ data: { empresaId: otra.id, rolId: rol.id, username: "ajeno", passwordHash: "x", nombre: "A", apellido: "J" } });
    const sucursalAjena = await env.prisma.sucursal.create({ data: { empresaId: otra.id, codigo: "001", nombre: "Ajena", direccion: "Quito centro", telefono: "022222222" } });

    expect(json<{ items: Usuario[] }>(await api("GET", "/api/usuarios", tokenAdmin)).items.map((u) => u.username)).not.toContain("ajeno");
    expect((await api("PATCH", `/api/usuarios/${ajeno.id}`, tokenAdmin, { nombre: "Hack" })).statusCode).toBe(404);
    expect((await api("POST", `/api/usuarios/${ajeno.id}/estado`, tokenAdmin, { estado: "INACTIVO" })).statusCode).toBe(404);
    expect((await api("POST", `/api/usuarios/${ajeno.id}/password`, tokenAdmin, { passwordAdmin: PASSWORD_ADMIN, password: "NuevaClave99" })).statusCode).toBe(404);
    expect(json<{ items: Array<{ id: string }> }>(await api("GET", "/api/sucursales", tokenAdmin)).items.map((s) => s.id)).not.toContain(sucursalAjena.id);
    expect((await api("PATCH", `/api/sucursales/${sucursalAjena.id}`, tokenAdmin, { nombre: "Hack" })).statusCode).toBe(404);
    expect((await api("POST", `/api/sucursales/${sucursalAjena.id}/estado`, tokenAdmin, { estado: "INACTIVO" })).statusCode).toBe(404);
    expect((await api("POST", `/api/sucursales/${sucursalAjena.id}/puntos-emision`, tokenAdmin, { descripcion: "Caja X" })).statusCode).toBe(404);
    expect((await env.prisma.usuario.findUniqueOrThrow({ where: { id: ajeno.id } })).nombre).toBe("A");
  });
});

interface Punto { id: string; codigo: string; descripcion: string; estado: string }
interface Sucursal { id: string; codigo: string; nombre: string; direccion: string; telefono: string; estado: string; turnosAbiertos: number; puntosEmision: Punto[] }
const sucursales = async (): Promise<Sucursal[]> => json<{ items: Sucursal[] }>(await api("GET", "/api/sucursales", tokenAdmin)).items;
const datosSucursal = (extra: Record<string, unknown> = {}) => ({ nombre: "Sucursal Norte", direccion: "Av. Principal 123 y Calle 2", telefono: "022345678", ...extra });
/** Puntos que ofrece el POS para abrir turno y vender (solo activos, de sucursales activas) */
const puntosDelPos = async (): Promise<string[]> =>
  json<{ items: Array<{ codigo: string; sucursal: { codigo: string } }> }>(await api("GET", "/api/puntos-emision", tokenAdmin)).items.map((p) => `${p.sucursal.codigo}-${p.codigo}`);

describe("Sucursales y puntos de emisión", () => {
  it("la instalación empieza con la sucursal 001 y su caja 001; solo quien tiene configuración las ve", async () => {
    const lista = await sucursales();
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ codigo: "001", estado: "ACTIVO", turnosAbiertos: 0, puntosEmision: [{ codigo: "001", descripcion: "Caja principal", estado: "ACTIVO" }] });
    expect((await api("GET", "/api/sucursales", tokenSupervisor)).statusCode).toBe(403);
    expect((await api("POST", "/api/sucursales", tokenSupervisor, datosSucursal())).statusCode).toBe(403);
  });

  it("crea sucursales con código consecutivo y su primera caja; valida los datos", async () => {
    const r = await api("POST", "/api/sucursales", tokenAdmin, datosSucursal());
    expect(r.statusCode).toBe(201);
    expect(json<Sucursal>(r)).toMatchObject({ codigo: "002", nombre: "Sucursal Norte", estado: "ACTIVO", puntosEmision: [{ codigo: "001", descripcion: "Caja principal" }] });
    expect(json<Sucursal>(await api("POST", "/api/sucursales", tokenAdmin, datosSucursal({ nombre: "Sucursal Sur" }))).codigo).toBe("003");
    expect((await api("POST", "/api/sucursales", tokenAdmin, datosSucursal({ nombre: "X" }))).statusCode).toBe(400);
    expect((await api("POST", "/api/sucursales", tokenAdmin, datosSucursal({ telefono: "abc" }))).statusCode).toBe(400);
    expect((await api("POST", "/api/sucursales", tokenAdmin, { nombre: "Sin datos" })).statusCode).toBe(400);
  });

  it("edita nombre, dirección y teléfono; el código no se puede cambiar", async () => {
    const norte = (await sucursales()).find((s) => s.codigo === "002") as Sucursal;
    const r = await api("PATCH", `/api/sucursales/${norte.id}`, tokenAdmin, { nombre: "Norte Plaza", telefono: "0987654321", codigo: "009" });
    expect(json<Sucursal>(r)).toMatchObject({ codigo: "002", nombre: "Norte Plaza", telefono: "0987654321", direccion: "Av. Principal 123 y Calle 2" });
    expect((await api("PATCH", `/api/sucursales/${norte.id}`, tokenAdmin, { direccion: "x" })).statusCode).toBe(400);
  });

  it("agrega cajas con código consecutivo dentro de la sucursal y el POS las ofrece", async () => {
    const norte = (await sucursales()).find((s) => s.codigo === "002") as Sucursal;
    const r = await api("POST", `/api/sucursales/${norte.id}/puntos-emision`, tokenAdmin, { descripcion: "Caja 2" });
    expect(r.statusCode).toBe(201);
    expect(json<Sucursal>(r).puntosEmision.map((p) => `${p.codigo}:${p.descripcion}`)).toEqual(["001:Caja principal", "002:Caja 2"]);
    expect((await api("POST", `/api/sucursales/${norte.id}/puntos-emision`, tokenAdmin, { descripcion: "" })).statusCode).toBe(400);
    expect(await puntosDelPos()).toEqual(["001-001", "002-001", "002-002", "003-001"]);
  });

  it("una caja desactivada deja de ofrecerse y su código no se reutiliza", async () => {
    const norte = (await sucursales()).find((s) => s.codigo === "002") as Sucursal;
    const caja2 = norte.puntosEmision.find((p) => p.codigo === "002") as Punto;
    const r = await api("PATCH", `/api/puntos-emision/${caja2.id}`, tokenAdmin, { estado: "INACTIVO", descripcion: "Caja 2 (vieja)" });
    expect(json<Sucursal>(r).puntosEmision.find((p) => p.codigo === "002")).toMatchObject({ estado: "INACTIVO", descripcion: "Caja 2 (vieja)" });
    expect(await puntosDelPos()).toEqual(["001-001", "002-001", "003-001"]);
    const nueva = json<Sucursal>(await api("POST", `/api/sucursales/${norte.id}/puntos-emision`, tokenAdmin, { descripcion: "Caja 3" }));
    expect(nueva.puntosEmision.map((p) => p.codigo)).toEqual(["001", "002", "003"]);
    expect((await api("PATCH", `/api/puntos-emision/${caja2.id}`, tokenAdmin, { estado: "ACTIVO" })).statusCode).toBe(200);
    expect((await api("PATCH", "/api/puntos-emision/no-existe", tokenAdmin, { estado: "ACTIVO" })).statusCode).toBe(404);
    expect((await api("PATCH", `/api/puntos-emision/${caja2.id}`, tokenAdmin, { estado: "BORRADO" })).statusCode).toBe(400);
  });

  it("una sucursal con turnos abiertos no se desactiva; al cerrarlos sí, y el POS deja de ofrecerla", async () => {
    const sur = (await sucursales()).find((s) => s.codigo === "003") as Sucursal;
    const turno = await env.prisma.turnoCaja.create({ data: { sucursalId: sur.id, cajeroId: env.seed.adminId, montoApertura: 10 } });
    expect((await sucursales()).find((s) => s.codigo === "003")?.turnosAbiertos).toBe(1);
    const bloqueada = await api("POST", `/api/sucursales/${sur.id}/estado`, tokenAdmin, { estado: "INACTIVO" });
    expect(bloqueada.statusCode).toBe(409);
    expect(json<{ mensaje: string }>(bloqueada).mensaje).toMatch(/turnos de caja abiertos/);
    await env.prisma.turnoCaja.update({ where: { id: turno.id }, data: { estado: "CERRADO" } });
    expect(json<Sucursal>(await api("POST", `/api/sucursales/${sur.id}/estado`, tokenAdmin, { estado: "INACTIVO" })).estado).toBe("INACTIVO");
    expect(await puntosDelPos()).toEqual(["001-001", "002-001", "002-002", "002-003"]);
    // el código de la desactivada no se reutiliza
    expect(json<Sucursal>(await api("POST", "/api/sucursales", tokenAdmin, datosSucursal({ nombre: "Sucursal Este" }))).codigo).toBe("004");
  });

  it("no se desactiva la sucursal con cuentas de mesa abiertas", async () => {
    const este = (await sucursales()).find((s) => s.codigo === "004") as Sucursal;
    const mesa = await env.prisma.mesa.create({ data: { sucursalId: este.id, numero: 1, nombre: "Mesa 1", capacidad: 4 } });
    const comanda = await env.prisma.comanda.create({ data: { sucursalId: este.id, numero: 1, mesaId: mesa.id } });
    const r = await api("POST", `/api/sucursales/${este.id}/estado`, tokenAdmin, { estado: "INACTIVO" });
    expect(r.statusCode).toBe(409);
    expect(json<{ mensaje: string }>(r).mensaje).toMatch(/cuentas de mesa abiertas/);
    await env.prisma.comanda.update({ where: { id: comanda.id }, data: { estado: "CERRADA" } });
    expect((await api("POST", `/api/sucursales/${este.id}/estado`, tokenAdmin, { estado: "INACTIVO" })).statusCode).toBe(200);
  });

  it("la empresa siempre conserva una caja activa en una sucursal activa", async () => {
    const lista = await sucursales();
    const activas = lista.filter((s) => s.estado === "ACTIVO");
    expect(activas.map((s) => s.codigo)).toEqual(["001", "002"]);
    // dejar solo la 001 activa y su única caja
    const norte = activas.find((s) => s.codigo === "002") as Sucursal;
    expect((await api("POST", `/api/sucursales/${norte.id}/estado`, tokenAdmin, { estado: "INACTIVO" })).statusCode).toBe(200);
    const matriz = lista.find((s) => s.codigo === "001") as Sucursal;
    const r = await api("POST", `/api/sucursales/${matriz.id}/estado`, tokenAdmin, { estado: "INACTIVO" });
    expect(r.statusCode).toBe(409);
    expect(json<{ mensaje: string }>(r).mensaje).toMatch(/ningún punto de emisión activo/);
    const caja = matriz.puntosEmision[0] as Punto;
    expect((await api("PATCH", `/api/puntos-emision/${caja.id}`, tokenAdmin, { estado: "INACTIVO" })).statusCode).toBe(409);
    expect((await sucursales()).find((s) => s.codigo === "001")).toMatchObject({ estado: "ACTIVO", puntosEmision: [{ estado: "ACTIVO" }] });
    // con otra caja activa en la misma sucursal, la primera sí se puede desactivar
    await api("POST", `/api/sucursales/${matriz.id}/puntos-emision`, tokenAdmin, { descripcion: "Caja 2" });
    expect((await api("PATCH", `/api/puntos-emision/${caja.id}`, tokenAdmin, { estado: "INACTIVO" })).statusCode).toBe(200);
    expect(await puntosDelPos()).toEqual(["001-002"]);
  });

  it("las sucursales desactivadas no aceptan abrir turno ni vender", async () => {
    const desactivada = (await sucursales()).find((s) => s.codigo === "002") as Sucursal;
    await expect(env.servicios.turnos.abrir({ sucursalId: desactivada.id, montoApertura: 10 }, { id: env.seed.adminId, empresaId: env.seed.empresaId, permisos: ["caja:crear"] })).rejects.toMatchObject({ codigo: "VALIDACION" });
  });
});

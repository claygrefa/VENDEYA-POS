// ============================================================
// tests/integration/server/seed-services.test.ts
// Seed + repositorios + servicios contra una BD SQLite aislada.
// ============================================================
import { execSync } from "child_process";
import { existsSync, rmSync } from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runSeed, ROLES_BASE, type SeedResult } from "../../../prisma/seed";
import { ClienteRepository } from "../../../src/server/repositories/cliente.repository";
import { EmpresaRepository } from "../../../src/server/repositories/empresa.repository";
import { ProductoRepository } from "../../../src/server/repositories/producto.repository";
import { UsuarioRepository } from "../../../src/server/repositories/usuario.repository";
import { AppError } from "../../../src/server/services/appError.util";
import { ClienteService } from "../../../src/server/services/cliente.service";
import { EmpresaService } from "../../../src/server/services/empresa.service";
import { ProductoService } from "../../../src/server/services/producto.service";
import { UsuarioService } from "../../../src/server/services/usuario.service";
import { TARIFAS_IVA } from "../../../src/shared/constants/sri.constants";

const DB_NOMBRE = `vendeya-seed-test-${process.pid}.db`;
const DB_URL = `file:./${DB_NOMBRE}`;
const DB_RUTA = path.resolve(__dirname, "../../../prisma", DB_NOMBRE);

let prisma: PrismaClient;
let seed: SeedResult;
let empresas: EmpresaService;
let usuarios: UsuarioService;
let productos: ProductoService;
let clientes: ClienteService;

async function codigoError(promesa: Promise<unknown>): Promise<string> {
  try {
    await promesa;
  } catch (e) {
    if (e instanceof AppError) return e.codigo;
    throw e;
  }
  return "SIN_ERROR";
}

beforeAll(async () => {
  execSync("npx prisma migrate deploy", {
    cwd: path.resolve(__dirname, "../../.."),
    env: { ...process.env, DATABASE_URL: DB_URL },
    stdio: "pipe",
  });
  prisma = new PrismaClient({ datasources: { db: { url: DB_URL } } });
  seed = await runSeed(prisma, { adminPassword: "ClaveDePrueba1" });
  empresas = new EmpresaService(new EmpresaRepository(prisma));
  usuarios = new UsuarioService(new UsuarioRepository(prisma));
  productos = new ProductoService(new ProductoRepository(prisma));
  clientes = new ClienteService(new ClienteRepository(prisma));
}, 60_000);

afterAll(async () => {
  await prisma.$disconnect();
  for (const sufijo of ["", "-journal"]) {
    if (existsSync(DB_RUTA + sufijo)) rmSync(DB_RUTA + sufijo);
  }
});

describe("runSeed", () => {
  it("crea roles, permisos y asignaciones RBAC", async () => {
    expect(await prisma.rol.count()).toBe(ROLES_BASE.length);
    expect(await prisma.permiso.count()).toBe(60);
    const admin = await prisma.rol.findUniqueOrThrow({ where: { nombre: "ADMIN" }, include: { permisos: true } });
    expect(admin.permisos).toHaveLength(60);
    const cajero = await prisma.rol.findUniqueOrThrow({ where: { nombre: "CAJERO" }, include: { permisos: true } });
    expect(cajero.permisos.length).toBeGreaterThan(0);
    expect(cajero.permisos.length).toBeLessThan(admin.permisos.length);
  });

  it("carga las tarifas de IVA vigentes (15% como general)", async () => {
    const tarifas = await prisma.tarifaImpuesto.findMany({ where: { empresaId: seed.empresaId } });
    expect(tarifas).toHaveLength(TARIFAS_IVA.length);
    expect(tarifas.find((t) => t.codigo === "2")?.porcentaje).toBe(15);
  });

  it("crea Consumidor Final, empresa/sucursal/punto, categoría y unidades", async () => {
    const cf = await prisma.cliente.findUniqueOrThrow({ where: { id: seed.clienteConsumidorFinalId } });
    expect(cf.identificacion).toBe("9999999999999");
    expect(await prisma.sucursal.count()).toBe(1);
    expect(await prisma.puntoEmision.count()).toBe(1);
    expect(await prisma.categoria.count({ where: { nombre: "General" } })).toBe(1);
    expect(await prisma.unidadMedida.count()).toBeGreaterThanOrEqual(8);
  });

  it("crea la configuración de giro con los flags de RETAIL_GENERAL", async () => {
    const cfg = await prisma.configuracionGiro.findUniqueOrThrow({ where: { empresaId: seed.empresaId } });
    expect(cfg.giroNegocio).toBe("RETAIL_GENERAL");
    expect(cfg.moduloLotes).toBe(false);
    expect(cfg.emitirFacturas).toBe(true);
  });

  it("es idempotente: una segunda ejecución no duplica datos", async () => {
    const segundo = await runSeed(prisma);
    expect(segundo).toEqual(seed);
    expect(await prisma.empresa.count()).toBe(1);
    expect(await prisma.usuario.count({ where: { username: "admin" } })).toBe(1);
    expect(await prisma.permiso.count()).toBe(60);
    expect(await prisma.categoria.count({ where: { nombre: "General" } })).toBe(1);
  });
});

describe("UsuarioService", () => {
  it("autentica al admin del seed y devuelve sus permisos", async () => {
    const u = await usuarios.autenticar({ username: "admin", password: "ClaveDePrueba1" });
    expect(u.rol).toBe("ADMIN");
    expect(usuarios.tienePermiso(u, "usuarios", "crear")).toBe(true);
    expect((await prisma.usuario.findUniqueOrThrow({ where: { id: u.id } })).ultimoAcceso).not.toBeNull();
  });

  it("rechaza contraseña incorrecta y usuario inexistente con el mismo código", async () => {
    expect(await codigoError(usuarios.autenticar({ username: "admin", password: "mala" }))).toBe("CREDENCIALES_INVALIDAS");
    expect(await codigoError(usuarios.autenticar({ username: "nadie", password: "x" }))).toBe("CREDENCIALES_INVALIDAS");
  });

  it("crea un cajero con permisos limitados y rechaza usernames duplicados", async () => {
    const entrada = {
      empresaId: seed.empresaId, rol: "CAJERO", username: "cajero1",
      password: "Cajero1234", nombre: "Ana", apellido: "Pérez",
    };
    const c = await usuarios.crear(entrada);
    expect(usuarios.tienePermiso(c, "ventas", "crear")).toBe(true);
    expect(usuarios.tienePermiso(c, "usuarios", "crear")).toBe(false);
    expect(await codigoError(usuarios.crear(entrada))).toBe("DUPLICADO");
  });

  it("rechaza usuarios inactivos", async () => {
    await prisma.usuario.update({ where: { username: "cajero1" }, data: { status: "INACTIVO" } });
    expect(await codigoError(usuarios.autenticar({ username: "cajero1", password: "Cajero1234" }))).toBe("USUARIO_INACTIVO");
  });

  it("valida la entrada (contraseña corta)", async () => {
    expect(
      await codigoError(usuarios.crear({ empresaId: seed.empresaId, rol: "CAJERO", username: "x1x", password: "123", nombre: "A", apellido: "B" }))
    ).toBe("VALIDACION");
  });
});

describe("EmpresaService", () => {
  const datos = {
    ruc: "1790012345001", razonSocial: "Comercial Andina S.A.", nombreComercial: "Andina",
    direccionMatriz: "Av. Amazonas N34", telefono: "0223456789", email: "info@andina.ec",
    tipoContribuyente: "SOCIEDAD", regimenTributario: "GENERAL",
  };

  it("registra, obtiene y actualiza una empresa", async () => {
    const e = await empresas.registrar(datos);
    expect(e.ambienteSRI).toBe("PRUEBAS");
    expect((await empresas.obtener(e.id)).ruc).toBe(datos.ruc);
    const act = await empresas.actualizar(e.id, { nombreComercial: "Andina Plus" });
    expect(act.nombreComercial).toBe("Andina Plus");
  });

  it("rechaza RUC duplicado, RUC inválido y empresa inexistente", async () => {
    expect(await codigoError(empresas.registrar(datos))).toBe("DUPLICADO");
    expect(await codigoError(empresas.registrar({ ...datos, ruc: "123" }))).toBe("VALIDACION");
    expect(await codigoError(empresas.obtener("no-existe"))).toBe("NO_ENCONTRADO");
  });
});

describe("ProductoService", () => {
  let categoriaId: string;
  let unidadMedidaId: string;

  beforeAll(async () => {
    categoriaId = (await prisma.categoria.findFirstOrThrow({ where: { nombre: "General" } })).id;
    unidadMedidaId = (await prisma.unidadMedida.findUniqueOrThrow({ where: { codigo: "UN" } })).id;
  });

  const nuevo = (extra: Record<string, unknown> = {}) => ({
    codigo: "P001", codigoBarras: "7861000000011", nombre: "Arroz 1kg",
    tipo: "BIEN", categoriaId, unidadMedidaId, precioCompra: 0.8, precioVenta: 1,
    ...extra,
  });

  it("crea un producto calculando el margen y aplicando defaults", async () => {
    const p = await productos.crear(nuevo());
    expect(p.margen).toBe(25);
    expect(p.aplicaIva).toBe(true);
    expect(p.codigoIvaSRI).toBe("2");
  });

  it("rechaza código duplicado y precio inválido", async () => {
    expect(await codigoError(productos.crear(nuevo()))).toBe("DUPLICADO");
    expect(await codigoError(productos.crear(nuevo({ codigo: "P002", precioVenta: 0 })))).toBe("VALIDACION");
  });

  it("busca con paginación, por texto y por código de barras", async () => {
    await productos.crear(nuevo({ codigo: "P003", codigoBarras: null, nombre: "Aceite 1L", precioCompra: 2, precioVenta: 3 }));
    const todos = await productos.buscar({ page: 1, pageSize: 1 });
    expect(todos.total).toBe(2);
    expect(todos.items).toHaveLength(1);
    expect((await productos.buscar({ search: "arroz" })).items.map((p) => p.codigo)).toEqual(["P001"]);
    expect((await productos.porCodigoBarras("7861000000011")).codigo).toBe("P001");
    expect(await codigoError(productos.porCodigoBarras("000"))).toBe("NO_ENCONTRADO");
  });

  it("actualiza precio y evita colisión de código", async () => {
    const p = await productos.porCodigoBarras("7861000000011");
    expect((await productos.actualizar(p.id, { precioVenta: 1.2 })).precioVenta).toBe(1.2);
    expect(await codigoError(productos.actualizar(p.id, { codigo: "P003" }))).toBe("DUPLICADO");
  });
});

describe("ClienteService", () => {
  const cedula = { tipoIdentificacion: "05", identificacion: "1710034065", razonSocial: "Juan Pérez" };

  it("crea un cliente con cédula válida y rechaza duplicado/identificación inválida", async () => {
    const c = await clientes.crear(cedula);
    expect(c.limiteCredito).toBe(0);
    expect(await codigoError(clientes.crear(cedula))).toBe("DUPLICADO");
    expect(await codigoError(clientes.crear({ ...cedula, identificacion: "1710034060" }))).toBe("VALIDACION");
  });

  it("actualiza datos manteniendo la validación de identificación", async () => {
    const c = await clientes.crear({ tipoIdentificacion: "04", identificacion: "0926687856001", razonSocial: "Empresa X" });
    const act = await clientes.actualizar(c.id, { email: "x@empresa.ec", diasCredito: 15 });
    expect(act.email).toBe("x@empresa.ec");
    expect(act.diasCredito).toBe(15);
    expect(await codigoError(clientes.actualizar(c.id, { identificacion: "123" }))).toBe("VALIDACION");
  });

  it("busca por texto y expone Consumidor Final", async () => {
    expect((await clientes.buscar({ search: "Juan" })).total).toBe(1);
    expect((await clientes.consumidorFinal()).razonSocial).toBe("CONSUMIDOR FINAL");
  });
});

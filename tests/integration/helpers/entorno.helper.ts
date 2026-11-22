// ============================================================
// tests/integration/helpers/entorno.helper.ts
// Entorno aislado: backend real sobre SQLite temporal + seed + utilidades de datos.
// ============================================================
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import type { Producto, PrismaClient, Proveedor, TurnoCaja } from "@prisma/client";
import { runSeed, type SeedResult } from "../../../prisma/seed";
import { iniciarBackend, type BackendHandle } from "../../../src/server";
import type { Servicios } from "../../../src/server/services/container.factory";
import { AppError } from "../../../src/server/services/appError.util";
import type { ActorCaja } from "../../../src/server/services/turno.service";

export interface Entorno {
  backend: BackendHandle;
  prisma: PrismaClient;
  servicios: Servicios;
  seed: SeedResult;
  categoriaId: string;
  unidadMedidaId: string;
  cerrar: () => Promise<void>;
}

export const PASSWORD_ADMIN = "ClaveDePrueba1";

export async function crearEntorno(): Promise<Entorno> {
  const dir = mkdtempSync(path.join(os.tmpdir(), "vendeya-it-"));
  const backend = await iniciarBackend({
    dbPath: path.join(dir, "data", "vendeya.db"),
    migrationsDir: path.resolve(__dirname, "../../../prisma/migrations"),
    port: 0,
    logLevel: "silent",
  });
  const seed = await runSeed(backend.prisma, { adminPassword: PASSWORD_ADMIN });
  const categoria = await backend.prisma.categoria.findFirstOrThrow({ where: { nombre: "General" } });
  const unidad = await backend.prisma.unidadMedida.findUniqueOrThrow({ where: { codigo: "UN" } });

  return {
    backend,
    prisma: backend.prisma,
    servicios: backend.servicios,
    seed,
    categoriaId: categoria.id,
    unidadMedidaId: unidad.id,
    cerrar: async () => {
      await backend.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export interface OpcionesProducto {
  codigo: string;
  precioVenta?: number;
  /** Stock inicial (se carga con una COMPRA en Kardex) */
  stock?: number;
  costo?: number;
  tipo?: "BIEN" | "SERVICIO";
  aplicaIva?: boolean;
  codigoBarras?: string;
}

export async function crearProducto(env: Entorno, o: OpcionesProducto): Promise<Producto> {
  const p = await env.servicios.productos.crear({
    codigo: o.codigo,
    ...(o.codigoBarras !== undefined ? { codigoBarras: o.codigoBarras } : {}),
    nombre: `Producto ${o.codigo}`,
    tipo: o.tipo ?? "BIEN",
    categoriaId: env.categoriaId,
    unidadMedidaId: env.unidadMedidaId,
    precioCompra: o.costo ?? 1,
    precioVenta: o.precioVenta ?? 10,
    aplicaIva: o.aplicaIva ?? true,
  });
  if (o.stock !== undefined && o.stock > 0) {
    await env.servicios.kardex.registrarEntrada(env.prisma, {
      productoId: p.id,
      cantidad: o.stock,
      costoUnitario: o.costo ?? 1,
      tipoMovimiento: "COMPRA",
      observacion: "Stock inicial de prueba",
    });
  }
  return env.prisma.producto.findUniqueOrThrow({ where: { id: p.id } });
}

export function abrirTurno(env: Entorno, cajeroId: string, sucursalId = env.seed.sucursalId): Promise<TurnoCaja> {
  return env.prisma.turnoCaja.create({ data: { sucursalId, cajeroId, montoApertura: 100 } });
}

/** Devuelve el código de AppError de una promesa rechazada ("SIN_ERROR" si resuelve). */
export async function codigoError(promesa: Promise<unknown>): Promise<string> {
  try {
    await promesa;
  } catch (e) {
    if (e instanceof AppError) return e.codigo;
    throw e;
  }
  return "SIN_ERROR";
}

/** Crea un usuario con el rol indicado y devuelve su actor (con permisos reales del RBAC). */
export async function crearActor(env: Entorno, rol: string, username: string): Promise<ActorCaja> {
  const u = await env.servicios.usuarios.crear({
    empresaId: env.seed.empresaId, rol, username, password: "Clave12345", nombre: username, apellido: "Test",
  });
  return { id: u.id, empresaId: env.seed.empresaId, permisos: u.permisos };
}

let contadorProveedor = 0;

export function crearProveedor(env: Entorno, extra: { razonSocial?: string; diasPago?: number; status?: string } = {}): Promise<Proveedor> {
  contadorProveedor += 1;
  return env.prisma.proveedor.create({
    data: {
      ruc: `179${String(contadorProveedor).padStart(7, "0")}001`,
      razonSocial: extra.razonSocial ?? `Proveedor ${contadorProveedor}`,
      diasPago: extra.diasPago ?? 30,
      ...(extra.status !== undefined ? { status: extra.status } : {}),
    },
  });
}

/** Cliente con crédito autorizado. */
export function crearClienteConCredito(env: Entorno, identificacion: string, limiteCredito: number, diasCredito = 30) {
  return env.servicios.clientes.crear({
    tipoIdentificacion: "04", identificacion, razonSocial: `Cliente ${identificacion}`, limiteCredito, diasCredito,
  });
}

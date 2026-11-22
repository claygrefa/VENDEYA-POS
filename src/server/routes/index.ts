// ============================================================
// src/server/routes/index.ts — Registro de todas las rutas /api
// ============================================================
import type { FastifyInstance } from "fastify";
import { crearAuthController } from "../controllers/auth.controller";
import { crearClienteController } from "../controllers/cliente.controller";
import { crearHealthController } from "../controllers/health.controller";
import { crearProductoController } from "../controllers/producto.controller";
import type { Servicios } from "../services/container.factory";
import { requerirSesion } from "./auth.guard";

export function registrarRutas(server: FastifyInstance, servicios: Servicios): void {
  const health = crearHealthController(servicios);
  const auth = crearAuthController(servicios);
  const productos = crearProductoController(servicios);
  const clientes = crearClienteController(servicios);

  // ── Públicas ──────────────────────────────────────────────
  server.get("/api/health", health.estado);
  server.post("/api/auth/login", auth.login);

  // ── Sesión ────────────────────────────────────────────────
  const sesion = { preHandler: requerirSesion(servicios) };
  server.post("/api/auth/logout", sesion, auth.logout);
  server.get("/api/auth/me", sesion, auth.yo);

  // ── Productos (inventario:leer) ───────────────────────────
  const leerInventario = { preHandler: requerirSesion(servicios, { modulo: "inventario", accion: "leer" }) };
  server.get("/api/productos", leerInventario, productos.buscar);
  server.get<{ Params: { codigo: string } }>("/api/productos/barcode/:codigo", leerInventario, productos.porCodigoBarras);
  server.get<{ Params: { id: string } }>("/api/productos/:id", leerInventario, productos.obtener);

  // ── Clientes (clientes:leer) ──────────────────────────────
  const leerClientes = { preHandler: requerirSesion(servicios, { modulo: "clientes", accion: "leer" }) };
  server.get("/api/clientes", leerClientes, clientes.buscar);
  server.get("/api/clientes/consumidor-final", leerClientes, clientes.consumidorFinal);
  server.get<{ Params: { id: string } }>("/api/clientes/:id", leerClientes, clientes.obtener);
}

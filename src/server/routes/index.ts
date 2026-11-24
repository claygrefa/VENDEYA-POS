// ============================================================
// src/server/routes/index.ts — Registro de todas las rutas /api
// ============================================================
import type { FastifyInstance } from "fastify";
import { crearAuthController } from "../controllers/auth.controller";
import { crearCertificadoController } from "../controllers/certificado.controller";
import { crearComprobanteController } from "../controllers/comprobante.controller";
import { crearClienteController } from "../controllers/cliente.controller";
import { crearCuentaController } from "../controllers/cuenta.controller";
import { crearHealthController } from "../controllers/health.controller";
import { crearInventarioController } from "../controllers/inventario.controller";
import { crearRestauranteController } from "../controllers/restaurante.controller";
import { crearProductoController } from "../controllers/producto.controller";
import { crearTurnoController } from "../controllers/turno.controller";
import { crearVentaController } from "../controllers/venta.controller";
import type { Servicios } from "../services/container.factory";
import { requerirSesion } from "./auth.guard";

export function registrarRutas(server: FastifyInstance, servicios: Servicios): void {
  const health = crearHealthController(servicios);
  const auth = crearAuthController(servicios);
  const productos = crearProductoController(servicios);
  const clientes = crearClienteController(servicios);
  const ventas = crearVentaController(servicios);
  const turnos = crearTurnoController(servicios);
  const cuentas = crearCuentaController(servicios);
  const inventario = crearInventarioController(servicios);
  const restaurante = crearRestauranteController(servicios);
  const comprobantes = crearComprobanteController(servicios);
  const certificado = crearCertificadoController(servicios);

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

  // ── Ventas ────────────────────────────────────────────────
  const crearVenta = { preHandler: requerirSesion(servicios, { modulo: "ventas", accion: "crear" }) };
  const anularVenta = { preHandler: requerirSesion(servicios, { modulo: "ventas", accion: "anular" }) };
  const leerVentas = { preHandler: requerirSesion(servicios, { modulo: "ventas", accion: "leer" }) };
  server.post("/api/ventas", crearVenta, ventas.crear);
  server.post<{ Params: { id: string } }>("/api/ventas/:id/anular", anularVenta, ventas.anular);
  server.get<{ Params: { id: string } }>("/api/ventas/:id", leerVentas, ventas.obtener);

  // ── Turnos de caja ────────────────────────────────────────
  // caja:crear = operar caja (abrir, movimientos, cierre); caja:leer = consultar.
  // Operar/ver turnos ajenos exige además caja:actualizar (supervisor), validado en el servicio.
  const operarCaja = { preHandler: requerirSesion(servicios, { modulo: "caja", accion: "crear" }) };
  const leerCaja = { preHandler: requerirSesion(servicios, { modulo: "caja", accion: "leer" }) };
  server.post("/api/turnos/abrir", operarCaja, turnos.abrir);
  server.get("/api/turnos/actual", leerCaja, turnos.actual);
  server.post<{ Params: { id: string } }>("/api/turnos/:id/movimientos", operarCaja, turnos.movimiento);
  server.post<{ Params: { id: string } }>("/api/turnos/:id/cerrar", operarCaja, turnos.cerrar);
  server.get<{ Params: { id: string } }>("/api/turnos/:id/reporte", leerCaja, turnos.reporte);

  // ── Compras (inventario) ──────────────────────────────────
  const crearCompra = { preHandler: requerirSesion(servicios, { modulo: "inventario", accion: "crear" }) };
  server.post("/api/compras", crearCompra, cuentas.crearCompra);
  server.get<{ Params: { id: string } }>("/api/compras/:id", leerInventario, cuentas.obtenerCompra);

  // ── Cuentas por cobrar (clientes) ─────────────────────────
  server.get("/api/cuentas-por-cobrar", leerClientes, cuentas.listarCxC);
  server.get<{ Params: { id: string } }>("/api/cuentas-por-cobrar/:id", leerClientes, cuentas.obtenerCxC);
  server.post<{ Params: { id: string } }>("/api/cuentas-por-cobrar/:id/abonos", operarCaja, cuentas.abonarCxC);

  // ── Cuentas por pagar (proveedores) ───────────────────────
  const leerProveedores = { preHandler: requerirSesion(servicios, { modulo: "proveedores", accion: "leer" }) };
  const pagarProveedores = { preHandler: requerirSesion(servicios, { modulo: "proveedores", accion: "actualizar" }) };
  server.get("/api/cuentas-por-pagar", leerProveedores, cuentas.listarCxP);
  server.get<{ Params: { id: string } }>("/api/cuentas-por-pagar/:id", leerProveedores, cuentas.obtenerCxP);
  server.post<{ Params: { id: string } }>("/api/cuentas-por-pagar/:id/pagos", pagarProveedores, cuentas.pagarCxP);

  // ── Inventario: catálogo, presentaciones, listas de precios, lotes, ajustes y alertas ──
  const permiso = (modulo: string, accion: string) => ({ preHandler: requerirSesion(servicios, { modulo, accion }) });
  const invCrear = permiso("inventario", "crear");
  const invActualizar = permiso("inventario", "actualizar");
  const clientesActualizar = permiso("clientes", "actualizar");

  server.post("/api/productos", invCrear, inventario.crearProducto);
  server.patch<{ Params: { id: string } }>("/api/productos/:id", invActualizar, inventario.actualizarProducto);

  server.get<{ Params: { id: string } }>("/api/productos/:id/presentaciones", leerInventario, inventario.listarPresentaciones);
  server.post<{ Params: { id: string } }>("/api/productos/:id/presentaciones", invCrear, inventario.crearPresentacion);
  server.patch<{ Params: { id: string } }>("/api/presentaciones/:id", invActualizar, inventario.actualizarPresentacion);

  server.get("/api/listas-precio", leerInventario, inventario.listarListas);
  server.post("/api/listas-precio", invCrear, inventario.crearLista);
  server.patch<{ Params: { id: string } }>("/api/listas-precio/:id", invActualizar, inventario.actualizarLista);
  server.get<{ Params: { id: string } }>("/api/listas-precio/:id/precios", leerInventario, inventario.listarPrecios);
  server.put<{ Params: { id: string } }>("/api/listas-precio/:id/precios", invActualizar, inventario.fijarPrecio);
  server.delete<{ Params: { id: string; precioId: string } }>("/api/listas-precio/:id/precios/:precioId", invActualizar, inventario.quitarPrecio);
  server.put<{ Params: { id: string } }>("/api/clientes/:id/lista-precio", clientesActualizar, inventario.asignarListaACliente);

  server.get("/api/inventario/lotes", leerInventario, inventario.listarLotes);
  server.post("/api/inventario/lotes", invCrear, inventario.crearLote);
  server.get<{ Params: { id: string } }>("/api/inventario/lotes/:id", leerInventario, inventario.obtenerLote);
  server.patch<{ Params: { id: string } }>("/api/inventario/lotes/:id", invActualizar, inventario.actualizarLote);

  server.post("/api/inventario/ajustes", invActualizar, inventario.ajustar);
  server.get<{ Params: { id: string } }>("/api/inventario/productos/:id/kardex", leerInventario, inventario.kardex);
  server.get("/api/inventario/alertas-vencimiento", leerInventario, inventario.alertasVencimiento);
  server.get("/api/inventario/alertas-stock", leerInventario, inventario.alertasStock);

  // ── Restaurante: mesas, comandas, cocina y cobro ──────────
  // El plano de mesas es configuración (configuracion:actualizar); el servicio es operación (restaurante:*).
  const planoMesas = permiso("configuracion", "actualizar");
  const verRestaurante = permiso("restaurante", "leer");
  const operarRestaurante = permiso("restaurante", "actualizar");
  const abrirCuentas = permiso("restaurante", "crear");
  const cobrarCuentas = permiso("ventas", "crear"); // además, el servicio exige restaurante:actualizar

  server.get("/api/mesas", verRestaurante, restaurante.listarMesas);
  server.post("/api/mesas", planoMesas, restaurante.crearMesa);
  server.patch<{ Params: { id: string } }>("/api/mesas/:id", planoMesas, restaurante.actualizarMesa);
  server.post<{ Params: { id: string } }>("/api/mesas/:id/estado", operarRestaurante, restaurante.estadoMesa);

  server.post("/api/comandas", abrirCuentas, restaurante.abrirComanda);
  server.get("/api/comandas", verRestaurante, restaurante.listarComandas);
  server.get<{ Params: { id: string } }>("/api/comandas/:id", verRestaurante, restaurante.obtenerComanda);
  server.post<{ Params: { id: string } }>("/api/comandas/:id/items", abrirCuentas, restaurante.agregarItems);
  server.post<{ Params: { id: string; itemId: string } }>("/api/comandas/:id/items/:itemId/cancelar", operarRestaurante, restaurante.cancelarItem);
  server.post<{ Params: { id: string; itemId: string } }>("/api/comandas/:id/items/:itemId/estado", operarRestaurante, restaurante.estadoItem);
  server.post<{ Params: { id: string } }>("/api/comandas/:id/enviar", operarRestaurante, restaurante.enviar);
  server.post<{ Params: { id: string } }>("/api/comandas/:id/mover", operarRestaurante, restaurante.mover);
  server.post<{ Params: { id: string } }>("/api/comandas/:id/unir", operarRestaurante, restaurante.unir);
  server.get<{ Params: { id: string } }>("/api/comandas/:id/pre-cuenta", verRestaurante, restaurante.preCuenta);
  server.post<{ Params: { id: string } }>("/api/comandas/:id/cobrar", cobrarCuentas, restaurante.cobrar);
  server.post<{ Params: { id: string } }>("/api/comandas/:id/anular", permiso("restaurante", "anular"), restaurante.anularComanda);

  server.get("/api/cocina/pendientes", verRestaurante, restaurante.pendientesCocina);

  // ── Comprobantes electrónicos SRI ─────────────────────────
  // El envío y la autorización llegan en la Semana 11; por ahora se generan, validan y consultan.
  server.get("/api/comprobantes", permiso("sri", "leer"), comprobantes.listar);
  server.get<{ Params: { id: string } }>("/api/comprobantes/:id", permiso("sri", "leer"), comprobantes.obtener);
  server.post<{ Params: { id: string } }>("/api/ventas/:id/comprobante", permiso("sri", "crear"), comprobantes.emitirFactura);
  // Firma XAdES-BES con el certificado de la empresa (no cambia el estado del comprobante)
  server.post<{ Params: { id: string } }>("/api/comprobantes/:id/firmar", permiso("sri", "crear"), certificado.firmar);

  // ── Certificado digital de firma (.p12) ───────────────────
  // La contraseña y la clave privada nunca se devuelven: la consulta solo muestra titular, emisor, huella y vigencia.
  const configurar = permiso("configuracion", "actualizar");
  server.put("/api/configuracion/certificado", configurar, certificado.guardar);
  server.get("/api/configuracion/certificado", permiso("configuracion", "leer"), certificado.informacion);
  server.delete("/api/configuracion/certificado", configurar, certificado.eliminar);
  server.post("/api/configuracion/certificado/rotar-clave", configurar, certificado.rotarClave);
}

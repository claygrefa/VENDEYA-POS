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
import { crearSetupController } from "../controllers/setup.controller";
import { crearGestionController } from "../controllers/gestion.controller";
import { crearHardwareController } from "../controllers/hardware.controller";
import { crearImpresionController } from "../controllers/impresion.controller";
import { crearInventarioController } from "../controllers/inventario.controller";
import { crearRestauranteController } from "../controllers/restaurante.controller";
import { crearProductoController } from "../controllers/producto.controller";
import { crearTurnoController } from "../controllers/turno.controller";
import { crearVentaController } from "../controllers/venta.controller";
import type { Servicios } from "../services/container.factory";
import { crearLicenciaController } from "../controllers/licencia.controller";
import { crearRespaldoController } from "../controllers/respaldo.controller";
import { crearTelemetriaController } from "../controllers/telemetria.controller";
import { crearSucursalController } from "../controllers/sucursal.controller";
import { crearUsuarioController } from "../controllers/usuario.controller";
import { exigirLicencia, requerirSesion } from "./auth.guard";

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
  const impresion = crearImpresionController(servicios);
  const hardware = crearHardwareController(servicios);
  const gestion = crearGestionController(servicios);
  const setup = crearSetupController(servicios);
  const licencia = crearLicenciaController(servicios);
  const respaldo = crearRespaldoController(servicios);
  const telemetria = crearTelemetriaController(servicios);
  const usuarios = crearUsuarioController(servicios);
  const sucursales = crearSucursalController(servicios);

  // ── Públicas ──────────────────────────────────────────────
  server.get("/api/health", health.estado);
  server.post("/api/auth/login", auth.login);
  // Asistente de configuración inicial: solo mientras no exista ninguna empresa y solo desde este equipo
  server.get("/api/setup/estado", setup.estado);
  server.post("/api/setup", setup.inicializar);
  server.post("/api/setup/certificado", setup.validarCertificado);

  // ── Sesión ────────────────────────────────────────────────
  const sesion = { preHandler: requerirSesion(servicios) };
  server.post("/api/auth/logout", sesion, auth.logout);
  server.get("/api/auth/me", sesion, auth.yo);
  // Cada usuario cambia su propia contraseña (la actual debe coincidir; las demás sesiones suyas se cierran)
  server.post("/api/auth/password", sesion, usuarios.cambiarMiPassword);

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
  const crearVenta = { preHandler: [requerirSesion(servicios, { modulo: "ventas", accion: "crear" }), exigirLicencia(servicios)] };
  const anularVenta = { preHandler: requerirSesion(servicios, { modulo: "ventas", accion: "anular" }) };
  const leerVentas = { preHandler: requerirSesion(servicios, { modulo: "ventas", accion: "leer" }) };
  server.post("/api/ventas", crearVenta, ventas.crear);
  server.post<{ Params: { id: string } }>("/api/ventas/:id/anular", anularVenta, ventas.anular);
  server.get<{ Params: { id: string } }>("/api/ventas/:id", leerVentas, ventas.obtener);
  // PDF de la factura de la venta (lo guarda quien cobró, con o sin impresora): permiso de ventas, no del monitor del SRI
  server.get<{ Params: { id: string } }>("/api/ventas/:id/ride", leerVentas, impresion.rideDeVenta);

  // ── Turnos de caja ────────────────────────────────────────
  // caja:crear = operar caja (abrir, movimientos, cierre); caja:leer = consultar.
  // Operar/ver turnos ajenos exige además caja:actualizar (supervisor), validado en el servicio.
  const operarCaja = { preHandler: requerirSesion(servicios, { modulo: "caja", accion: "crear" }) };
  const leerCaja = { preHandler: requerirSesion(servicios, { modulo: "caja", accion: "leer" }) };
  const abrirTurno = { preHandler: [requerirSesion(servicios, { modulo: "caja", accion: "crear" }), exigirLicencia(servicios)] };
  server.post("/api/turnos/abrir", abrirTurno, turnos.abrir);
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
  // Cobrar una cuenta de mesa crea una venta: igual que POST /api/ventas, exige licencia vigente. Además, el servicio exige restaurante:actualizar
  const cobrarCuentas = { preHandler: [requerirSesion(servicios, { modulo: "ventas", accion: "crear" }), exigirLicencia(servicios)] };

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
  // Se generan, validan, firman y se envían al SRI en segundo plano (worker de la cola).
  server.get("/api/comprobantes", permiso("sri", "leer"), comprobantes.listar);
  server.get<{ Params: { id: string } }>("/api/comprobantes/:id", permiso("sri", "leer"), comprobantes.obtener);
  server.post<{ Params: { id: string } }>("/api/ventas/:id/comprobante", permiso("sri", "crear"), comprobantes.emitirFactura);
  // Firma XAdES-BES con el certificado de la empresa (no cambia el estado del comprobante)
  server.post<{ Params: { id: string } }>("/api/comprobantes/:id/firmar", permiso("sri", "crear"), certificado.firmar);

  // Retenciones y liquidaciones (sobre compras), guías de remisión y ATS
  server.post<{ Params: { id: string } }>("/api/compras/:id/retencion", permiso("sri", "crear"), comprobantes.emitirRetencion);
  server.post<{ Params: { id: string } }>("/api/compras/:id/liquidacion", permiso("sri", "crear"), comprobantes.emitirLiquidacion);
  server.post("/api/guias-remision", permiso("sri", "crear"), comprobantes.emitirGuiaRemision);
  server.get("/api/reportes/ats", permiso("reportes", "exportar"), comprobantes.ats);

  // Cola de envíos al SRI: la procesa el worker en segundo plano; aquí se consulta y se fuerza el reintento
  server.get("/api/sri/cola", permiso("sri", "leer"), comprobantes.estadoCola);
  server.post<{ Params: { id: string } }>("/api/comprobantes/:id/reintentar", permiso("sri", "crear"), comprobantes.reintentar);

  // RIDE (PDF A4) de cualquier comprobante de la empresa
  server.get<{ Params: { id: string }; Querystring: { descargar?: string } }>("/api/comprobantes/:id/ride", permiso("sri", "leer"), impresion.ride);

  // ── Impresora térmica ESC/POS y gaveta ────────────────────
  // La configuración la cambia el administrador; el cajero imprime, reimprime y abre la gaveta (operar caja).
  server.get("/api/impresora", permiso("caja", "leer"), impresion.configuracion);
  server.put("/api/impresora", permiso("configuracion", "actualizar"), impresion.configurar);
  server.post("/api/impresora/probar", permiso("caja", "crear"), impresion.probar);
  server.post("/api/impresora/gaveta", permiso("caja", "crear"), impresion.gaveta);
  server.post<{ Params: { id: string } }>("/api/ventas/:id/imprimir", permiso("caja", "crear"), impresion.reimprimirVenta);
  server.post<{ Params: { id: string } }>("/api/turnos/:id/imprimir", permiso("caja", "crear"), impresion.imprimirArqueo);

  // ── Lectores de códigos, balanza serial y cajas conectadas (LAN) ──
  // Escanear y pesar son parte de vender (ventas:crear); la configuración de la balanza la cambia el administrador.
  server.get<{ Params: { codigo: string } }>("/api/escaneo/:codigo", permiso("ventas", "crear"), hardware.escanear);
  server.get("/api/balanza", permiso("caja", "leer"), hardware.balanza);
  server.put("/api/balanza", permiso("configuracion", "actualizar"), hardware.configurarBalanza);
  server.get("/api/balanza/peso", permiso("ventas", "crear"), hardware.peso);
  server.get("/api/sync/cajas", permiso("caja", "leer"), hardware.cajasConectadas);
  server.get("/api/puntos-emision", permiso("caja", "leer"), hardware.puntosEmision);

  // ── Vistas de gestión: clientes, proveedores, listados, catálogos y reportes ──
  server.post("/api/clientes", permiso("clientes", "crear"), gestion.crearCliente);
  server.patch<{ Params: { id: string } }>("/api/clientes/:id", permiso("clientes", "actualizar"), gestion.actualizarCliente);
  server.get("/api/proveedores", permiso("proveedores", "leer"), gestion.buscarProveedores);
  server.post("/api/proveedores", permiso("proveedores", "crear"), gestion.crearProveedor);
  server.patch<{ Params: { id: string } }>("/api/proveedores/:id", permiso("proveedores", "actualizar"), gestion.actualizarProveedor);
  server.get("/api/ventas", permiso("ventas", "leer"), gestion.listarVentas);
  server.get("/api/compras", leerInventario, gestion.listarCompras);
  server.get("/api/catalogos", leerInventario, gestion.catalogos);
  server.get<{ Params: { tipo: string } }>("/api/reportes/:tipo", permiso("reportes", "leer"), gestion.reporte);

  // ── Ajustes del negocio (solo el administrador cambia; quien tiene configuracion:leer los consulta) ──
  server.get("/api/configuracion", permiso("configuracion", "leer"), setup.ajustes);
  server.patch("/api/configuracion/empresa", permiso("configuracion", "actualizar"), setup.actualizarEmpresa);
  server.patch("/api/configuracion/modulos", permiso("configuracion", "actualizar"), setup.actualizarModulos);
  server.post("/api/configuracion/giro", permiso("configuracion", "actualizar"), setup.aplicarGiro);

  // ── Usuarios (administrador: usuarios:*) ──────────────────
  // No se borran: se desactivan. Desactivar, cambiar el rol o la contraseña cierra las sesiones de esa persona.
  server.get("/api/usuarios", permiso("usuarios", "leer"), usuarios.listar);
  server.get("/api/roles", permiso("usuarios", "leer"), usuarios.roles);
  server.post("/api/usuarios", permiso("usuarios", "crear"), usuarios.crear);
  server.patch<{ Params: { id: string } }>("/api/usuarios/:id", permiso("usuarios", "actualizar"), usuarios.actualizar);
  server.post<{ Params: { id: string } }>("/api/usuarios/:id/estado", permiso("usuarios", "actualizar"), usuarios.estado);
  server.post<{ Params: { id: string } }>("/api/usuarios/:id/password", permiso("usuarios", "actualizar"), usuarios.restablecerPassword);

  // ── Sucursales y puntos de emisión (configuración) ────────
  // El código lo asigna el sistema (consecutivo, no se reutiliza); el establecimiento debe estar registrado en el SRI para facturar con él.
  server.get("/api/sucursales", permiso("configuracion", "leer"), sucursales.listar);
  server.post("/api/sucursales", permiso("configuracion", "actualizar"), sucursales.crear);
  server.patch<{ Params: { id: string } }>("/api/sucursales/:id", permiso("configuracion", "actualizar"), sucursales.actualizar);
  server.post<{ Params: { id: string } }>("/api/sucursales/:id/estado", permiso("configuracion", "actualizar"), sucursales.estado);
  server.post<{ Params: { id: string } }>("/api/sucursales/:id/puntos-emision", permiso("configuracion", "actualizar"), sucursales.crearPunto);
  server.patch<{ Params: { id: string } }>("/api/puntos-emision/:id", permiso("configuracion", "actualizar"), sucursales.actualizarPunto);

  // ── Licencia (estado para cualquier usuario: el marco avisa al cajero; la gestión es del administrador) ──
  const administrar = permiso("configuracion", "actualizar");
  server.get("/api/licencia", { preHandler: requerirSesion(servicios) }, licencia.estado);
  server.post("/api/licencia/activar", administrar, licencia.activar);
  server.post("/api/licencia/validar", administrar, licencia.validar);
  server.delete("/api/licencia", administrar, licencia.desactivar);
  server.get("/api/licencia/dispositivos", administrar, licencia.dispositivos);
  server.post<{ Params: { id: string } }>("/api/licencia/dispositivos/:id/liberar", administrar, licencia.liberar);

  // ── Certificado digital de firma (.p12) ───────────────────
  // La contraseña y la clave privada nunca se devuelven: la consulta solo muestra titular, emisor, huella y vigencia.
  const configurar = permiso("configuracion", "actualizar");
  server.put("/api/configuracion/certificado", configurar, certificado.guardar);
  server.get("/api/configuracion/certificado", permiso("configuracion", "leer"), certificado.informacion);
  server.delete("/api/configuracion/certificado", configurar, certificado.eliminar);
  server.post("/api/configuracion/certificado/rotar-clave", configurar, certificado.rotarClave);

  // ── Respaldos (solo administrador): locales y copia cifrada en una carpeta de nube/externa ──
  server.get("/api/respaldos", administrar, respaldo.estado);
  server.post("/api/respaldos", administrar, respaldo.crear);
  server.put("/api/respaldos/nube", administrar, respaldo.configurarNube);
  server.delete("/api/respaldos/nube", administrar, respaldo.quitarNube);
  server.post("/api/respaldos/nube/exportar", administrar, respaldo.exportarNube);
  // Restaurar es en dos tiempos: se prepara (pide la contraseña del administrador) y se aplica al reabrir la aplicación
  server.post("/api/respaldos/restaurar", administrar, respaldo.prepararRestauracion);
  server.delete("/api/respaldos/restaurar", administrar, respaldo.cancelarRestauracion);

  // ── Telemetría opcional de errores (desactivada por defecto; la gestiona el administrador) ──
  server.get("/api/telemetria", { preHandler: requerirSesion(servicios) }, telemetria.estado);
  server.post("/api/telemetria/errores", { preHandler: requerirSesion(servicios) }, telemetria.registrar);
  server.put("/api/telemetria", administrar, telemetria.configurar);
  server.get("/api/telemetria/pendientes", administrar, telemetria.pendientes);
  server.delete("/api/telemetria/pendientes", administrar, telemetria.descartar);
  server.post("/api/telemetria/enviar", administrar, telemetria.enviar);
}

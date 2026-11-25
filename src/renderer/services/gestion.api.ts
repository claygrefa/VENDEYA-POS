// ============================================================
// src/renderer/services/gestion.api.ts — Operaciones de las vistas de gestión (inventario, clientes, compras, caja, reportes, SRI)
// ============================================================
import { consulta, type ApiCliente } from "./api";
import type { ClientePos, Pagina, ProductoPos, TurnoPos, VentaEmitidaPos } from "./tipos";

// ── Tipos de las respuestas ──────────────────────────────────

export interface ProductoGestion extends ProductoPos {
  stockMinimo: number;
  precioCompra: number;
  categoriaId: string;
  unidadMedidaId: string;
  requiereLote: boolean;
  tieneVencimiento: boolean;
  status: string;
}

export interface Catalogos {
  categorias: Array<{ id: string; nombre: string }>;
  unidades: Array<{ id: string; codigo: string; nombre: string; permiteDecimales: boolean }>;
}

export interface MovimientoKardex {
  id: string;
  fecha: string;
  tipoMovimiento: string;
  cantidad: number;
  costoUnitario: number;
  stockResultante: number;
  observacion: string | null;
}

export interface AlertaStock {
  productoId: string;
  codigo: string;
  nombre: string;
  stockActual: number;
  stockMinimo: number;
  faltante: number;
}

export interface AlertaLote {
  loteId: string;
  numeroLote: string;
  codigo: string;
  nombre: string;
  cantidadActual: number;
  fechaVencimiento: string;
  diasRestantes: number;
}

export interface Proveedor {
  id: string;
  ruc: string;
  razonSocial: string;
  email: string | null;
  telefono: string | null;
  diasPago: number;
  status: string;
}

export interface CompraListada {
  id: string;
  numeroFactura: string;
  fecha: string;
  proveedor: string;
  formaPago: string;
  total: number;
  estado: string;
  tipoDocumento: string;
}

export interface CuentaPorCobrar {
  id: string;
  montoTotal: number;
  saldo: number;
  fechaVencimiento: string;
  estado: string;
  cliente: { id: string; razonSocial: string };
  venta: { numero: string };
}

export interface CuentaPorPagar {
  id: string;
  montoTotal: number;
  saldo: number;
  fechaVencimiento: string;
  estado: string;
  proveedor: { id: string; razonSocial: string };
  compra: { numeroFactura: string };
}

export interface VentaListada {
  id: string;
  numero: string;
  createdAt: string;
  estado: string;
  total: number;
  propina: number;
  clienteNombre: string | null;
  cajero: string;
  turnoId: string;
  comprobante: { id: string; estado: string } | null;
}

export interface ReporteTurno {
  turno: { id: string; sucursal: string; cajero: string; estado: string; montoApertura: number; fechaApertura: string; fechaCierre: string | null };
  ventas: { cantidad: number; total: number; subtotal: number; iva: number; descuento: number; anuladas: { cantidad: number; total: number } };
  porFormaPago: Array<{ formaPago: string; neto: number }>;
  movimientos: { ingresos: number; egresos: number; detalle: Array<{ id: string; tipo: string; concepto: string; monto: number }> };
  /** null mientras el turno está abierto y quien consulta es el cajero (cierre ciego) */
  efectivo: { esperado: number; contado: number | null; diferencia: number | null } | null;
}

export interface ColumnaReporte {
  clave: string;
  titulo: string;
  tipo: "texto" | "numero" | "dinero";
}

export interface Reporte {
  tipo: string;
  titulo: string;
  desde: string | null;
  hasta: string | null;
  columnas: ColumnaReporte[];
  filas: Array<Record<string, string | number>>;
  totales: Record<string, number>;
}

export interface ComprobanteListado {
  id: string;
  tipoComprobante: string;
  serie: string;
  secuencial: string;
  claveAcceso: string;
  fechaEmision: string;
  estado: string;
  ambiente: string;
  intentosEnvio: number;
  proximoIntento: string | null;
  mensajesRespuesta: string | null;
  colaSRI: { intentos: number; ultimoError: string | null } | null;
}

export interface MensajeSri {
  identificador: string;
  mensaje: string;
  informacionAdicional: string | null;
  tipo: string;
}

export interface ColaSriDetalle {
  porEstado: Record<string, number>;
  pendientes: Array<{ id: string; estado: string; intentos: number; ultimoError: string | null }>;
}

export class GestionApi {
  constructor(readonly http: ApiCliente) {}

  // Inventario
  catalogos(): Promise<Catalogos> {
    return this.http.get("/api/catalogos");
  }
  productos(search: string, page = 1): Promise<Pagina<ProductoGestion>> {
    return this.http.get(`/api/productos${consulta({ search: search.trim(), page, pageSize: 15 })}`);
  }
  guardarProducto(id: string | null, datos: Record<string, unknown>): Promise<ProductoGestion> {
    return id === null ? this.http.post("/api/productos", datos) : this.http.patch(`/api/productos/${id}`, datos);
  }
  ajustar(datos: Record<string, unknown>): Promise<unknown> {
    return this.http.post("/api/inventario/ajustes", datos);
  }
  kardex(productoId: string, page = 1): Promise<{ producto: { nombre: string; stockActual: number; costoPromedio: number }; items: MovimientoKardex[]; total: number; page: number; pageSize: number }> {
    return this.http.get(`/api/inventario/productos/${productoId}/kardex${consulta({ page, pageSize: 10 })}`);
  }
  alertasStock(): Promise<{ total: number; items: AlertaStock[] }> {
    return this.http.get("/api/inventario/alertas-stock");
  }
  alertasVencimiento(dias = 30): Promise<{ dias: number; vencidos: AlertaLote[]; porVencer: AlertaLote[] }> {
    return this.http.get(`/api/inventario/alertas-vencimiento${consulta({ dias })}`);
  }

  // Clientes y cuentas por cobrar
  clientes(search: string, page = 1): Promise<Pagina<ClientePos & { limiteCredito: number; diasCredito: number; telefono: string | null; direccion: string | null; descuentoHabitual: number }>> {
    return this.http.get(`/api/clientes${consulta({ search: search.trim(), page, pageSize: 15 })}`);
  }
  guardarCliente(id: string | null, datos: Record<string, unknown>): Promise<ClientePos> {
    return id === null ? this.http.post("/api/clientes", datos) : this.http.patch(`/api/clientes/${id}`, datos);
  }
  cuentasPorCobrar(page = 1, soloVencidas = false): Promise<Pagina<CuentaPorCobrar>> {
    return this.http.get(`/api/cuentas-por-cobrar${consulta({ page, pageSize: 15, vencidas: soloVencidas ? "true" : undefined })}`);
  }
  abonar(cuentaId: string, datos: Record<string, unknown>): Promise<CuentaPorCobrar> {
    return this.http.post(`/api/cuentas-por-cobrar/${cuentaId}/abonos`, datos);
  }

  // Compras, proveedores y cuentas por pagar
  compras(search: string, page = 1): Promise<Pagina<CompraListada>> {
    return this.http.get(`/api/compras${consulta({ search: search.trim(), page, pageSize: 15 })}`);
  }
  crearCompra(datos: Record<string, unknown>): Promise<{ id: string; numeroFactura: string; total: number }> {
    return this.http.post("/api/compras", datos);
  }
  proveedores(search: string, page = 1): Promise<Pagina<Proveedor>> {
    return this.http.get(`/api/proveedores${consulta({ search: search.trim(), page, pageSize: 15 })}`);
  }
  guardarProveedor(id: string | null, datos: Record<string, unknown>): Promise<Proveedor> {
    return id === null ? this.http.post("/api/proveedores", datos) : this.http.patch(`/api/proveedores/${id}`, datos);
  }
  cuentasPorPagar(page = 1, soloVencidas = false): Promise<Pagina<CuentaPorPagar>> {
    return this.http.get(`/api/cuentas-por-pagar${consulta({ page, pageSize: 15, vencidas: soloVencidas ? "true" : undefined })}`);
  }
  pagar(cuentaId: string, datos: Record<string, unknown>): Promise<CuentaPorPagar> {
    return this.http.post(`/api/cuentas-por-pagar/${cuentaId}/pagos`, datos);
  }

  // Caja
  reporteTurno(turnoId: string): Promise<ReporteTurno> {
    return this.http.get(`/api/turnos/${turnoId}/reporte`);
  }
  movimiento(turnoId: string, datos: Record<string, unknown>): Promise<unknown> {
    return this.http.post(`/api/turnos/${turnoId}/movimientos`, datos);
  }
  cerrarTurno(turnoId: string, datos: Record<string, unknown>): Promise<ReporteTurno> {
    return this.http.post(`/api/turnos/${turnoId}/cerrar`, datos);
  }
  imprimirArqueo(turnoId: string): Promise<void> {
    return this.http.post(`/api/turnos/${turnoId}/imprimir`);
  }
  ventas(turnoId: string, page = 1): Promise<Pagina<VentaListada>> {
    return this.http.get(`/api/ventas${consulta({ turnoId, page, pageSize: 10 })}`);
  }
  anularVenta(ventaId: string, motivo: string): Promise<VentaEmitidaPos> {
    return this.http.post(`/api/ventas/${ventaId}/anular`, { motivo });
  }
  reimprimir(ventaId: string): Promise<void> {
    return this.http.post(`/api/ventas/${ventaId}/imprimir`);
  }

  // Reportes
  reporte(tipo: string, parametros: { desde?: string; hasta?: string; agrupar?: string }): Promise<Reporte> {
    return this.http.get(`/api/reportes/${tipo}${consulta(parametros)}`);
  }
  reporteCsv(tipo: string, parametros: { desde?: string; hasta?: string; agrupar?: string }): Promise<{ blob: Blob; nombre: string }> {
    return this.http.archivo(`/api/reportes/${tipo}${consulta({ ...parametros, formato: "csv" })}`);
  }

  // SRI
  comprobantes(estado: string, tipo: string, page = 1): Promise<Pagina<ComprobanteListado>> {
    return this.http.get(`/api/comprobantes${consulta({ estado: estado === "" ? undefined : estado, tipoComprobante: tipo === "" ? undefined : tipo, page, pageSize: 15 })}`);
  }
  colaSri(): Promise<ColaSriDetalle> {
    return this.http.get("/api/sri/cola");
  }
  reintentar(comprobanteId: string): Promise<{ id: string; estado: string }> {
    return this.http.post(`/api/comprobantes/${comprobanteId}/reintentar`);
  }
  ride(comprobanteId: string): Promise<{ blob: Blob; nombre: string }> {
    return this.http.archivo(`/api/comprobantes/${comprobanteId}/ride?descargar=1`);
  }
  ats(anio: number, mes: number): Promise<{ blob: Blob; nombre: string }> {
    return this.http.archivo(`/api/reportes/ats${consulta({ anio, mes })}`);
  }
}

export type { TurnoPos };

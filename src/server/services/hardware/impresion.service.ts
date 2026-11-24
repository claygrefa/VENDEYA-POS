// ============================================================
// src/server/services/hardware/impresion.service.ts — Impresión de tickets y apertura de gaveta
//
// La impresión es un periférico: NUNCA debe hacer fallar ni retrasar una venta. `alCobrar` se invoca después de que la
// venta ya está registrada y captura cualquier error. Las acciones explícitas del usuario (reimprimir, probar, abrir la
// gaveta) sí informan el error para que pueda corregir la impresora.
// ============================================================
import type { ConfiguracionGiro, PrismaClient } from "@prisma/client";
import { ConfigurarImpresoraSchema } from "../../../shared/schemas/impresora.schema";
import type { ConfiguracionRepository } from "../../repositories/configuracion.repository";
import type { ImpresionRepository, VentaParaTicket } from "../../repositories/impresion.repository";
import { AppError } from "../appError.util";
import type { ActorCaja, TurnoService } from "../turno.service";
import { parsear } from "../validation.util";
import { EscPosBuilder, columnasPara } from "./escpos.builder";
import { construirTicketArqueo, construirTicketVenta, fechaHoraTicket, type DatosTicketVenta } from "./ticket.builder";
import { ImpresoraError, TransporteRed, TransporteSistema, type TransporteImpresora } from "./transporteImpresora";

export interface ConfiguracionImpresora {
  conexion: "NINGUNA" | "RED" | "SISTEMA";
  direccion: string | null;
  puerto: number;
  ancho: 58 | 80;
  /** Interruptores del giro: imprimir al cobrar y abrir la gaveta */
  impresionTermica: boolean;
  aperturaGaveta: boolean;
}

export type FabricaTransporte = (c: ConfiguracionImpresora) => TransporteImpresora;

const fabricaReal: FabricaTransporte = (c) => {
  const direccion = c.direccion ?? "";
  return c.conexion === "RED" ? new TransporteRed(direccion, c.puerto) : new TransporteSistema(direccion);
};

function leerConfiguracion(g: ConfiguracionGiro | null): ConfiguracionImpresora {
  return {
    conexion: g?.impresoraConexion === "RED" || g?.impresoraConexion === "SISTEMA" ? g.impresoraConexion : "NINGUNA",
    direccion: g?.impresoraDireccion ?? null,
    puerto: g?.impresoraPuerto ?? 9100,
    ancho: g?.impresoraAncho === 58 ? 58 : 80,
    impresionTermica: g?.impresionTermica ?? false,
    aperturaGaveta: g?.aperturaGaveta ?? false,
  };
}

export interface OpcionesImpresion {
  fabricaTransporte?: FabricaTransporte;
  /** Recibe los errores de la impresión automática (default: consola) */
  alError?: (e: unknown) => void;
}

export class ImpresionService {
  private readonly fabrica: FabricaTransporte;
  private readonly alError: (e: unknown) => void;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly repo: ImpresionRepository,
    private readonly configuracion: ConfiguracionRepository,
    private readonly turnos: TurnoService,
    opciones: OpcionesImpresion = {}
  ) {
    this.fabrica = opciones.fabricaTransporte ?? fabricaReal;
    this.alError = opciones.alError ?? ((e) => console.error("[impresion]", e instanceof Error ? e.message : e));
  }

  // ── Configuración ──────────────────────────────────────────

  async obtenerConfiguracion(actor: ActorCaja): Promise<ConfiguracionImpresora> {
    return leerConfiguracion(await this.configuracion.porEmpresa(this.prisma, actor.empresaId));
  }

  async configurar(entrada: unknown, actor: ActorCaja): Promise<ConfiguracionImpresora> {
    const d = parsear(ConfigurarImpresoraSchema, entrada);
    if ((await this.configuracion.porEmpresa(this.prisma, actor.empresaId)) === null) throw new AppError("NO_ENCONTRADO", "Configure primero el giro del negocio");
    await this.repo.guardarImpresora(this.prisma, actor.empresaId, {
      conexion: d.conexion,
      direccion: d.conexion === "NINGUNA" ? null : (d.direccion ?? null),
      puerto: d.puerto,
      ancho: d.ancho,
    });
    return this.obtenerConfiguracion(actor);
  }

  // ── Al cobrar (automático, sin afectar a la venta) ─────────

  /**
   * Imprime el ticket de una venta recién registrada y abre la gaveta si hubo pago en efectivo. No lanza nunca:
   * devuelve `true` si se envió a la impresora y `false` si no corresponde imprimir o si falló.
   */
  async alCobrar(ventaId: string, actor: ActorCaja): Promise<boolean> {
    try {
      const cfg = await this.obtenerConfiguracion(actor);
      if (cfg.conexion === "NINGUNA" || !cfg.impresionTermica) return false;
      const venta = await this.repo.venta(this.prisma, ventaId, actor.empresaId);
      if (venta === null) return false;
      await this.fabrica(cfg).enviar(this.ticketDeVenta(venta, cfg, false));
      return true;
    } catch (e) {
      this.alError(e);
      return false;
    }
  }

  // ── Acciones del usuario (informan el error) ───────────────

  async reimprimirVenta(ventaId: string, actor: ActorCaja): Promise<void> {
    const cfg = await this.exigirConfigurada(actor);
    const venta = await this.repo.venta(this.prisma, ventaId, actor.empresaId);
    if (venta === null) throw new AppError("NO_ENCONTRADO", "Venta no encontrada");
    await this.enviar(cfg, this.ticketDeVenta(venta, cfg, true));
  }

  async imprimirArqueo(turnoId: string, actor: ActorCaja): Promise<void> {
    const cfg = await this.exigirConfigurada(actor);
    const reporte = await this.turnos.reporte(turnoId, actor); // valida que el turno sea del actor o de un supervisor
    const empresa = await this.repo.empresa(this.prisma, actor.empresaId);
    if (empresa === null) throw new AppError("NO_ENCONTRADO", "Empresa no encontrada");
    const bytes = construirTicketArqueo(
      {
        empresa: { razonSocial: empresa.razonSocial, nombreComercial: empresa.nombreComercial, ruc: empresa.ruc, direccion: empresa.direccionMatriz, telefono: empresa.telefono },
        sucursal: reporte.turno.sucursal,
        cajero: reporte.turno.cajero,
        estado: reporte.turno.estado,
        fechaApertura: reporte.turno.fechaApertura,
        fechaCierre: reporte.turno.fechaCierre,
        montoApertura: reporte.turno.montoApertura,
        ventas: { cantidad: reporte.ventas.cantidad, subtotal: reporte.ventas.subtotal, descuento: reporte.ventas.descuento, iva: reporte.ventas.iva, total: reporte.ventas.total },
        anuladas: reporte.ventas.anuladas,
        porFormaPago: reporte.porFormaPago.map((f) => ({ formaPago: f.formaPago, neto: f.neto })),
        ingresos: reporte.movimientos.ingresos,
        egresos: reporte.movimientos.egresos,
        efectivo: reporte.efectivo,
      },
      columnasPara(cfg.ancho)
    );
    await this.enviar(cfg, bytes);
  }

  /** Abre la gaveta sin imprimir (p. ej. cambio de monedas). Respeta el interruptor del giro. */
  async abrirGaveta(actor: ActorCaja): Promise<void> {
    const cfg = await this.exigirConfigurada(actor);
    if (!cfg.aperturaGaveta) throw new AppError("MODULO_DESHABILITADO", "La apertura de gaveta no está habilitada para este negocio");
    await this.enviar(cfg, new EscPosBuilder(columnasPara(cfg.ancho)).inicializar().abrirGaveta().aBuffer());
  }

  /** Página de prueba: confirma la conexión y el ancho del papel. */
  async probar(actor: ActorCaja): Promise<void> {
    const cfg = await this.exigirConfigurada(actor);
    const cols = columnasPara(cfg.ancho);
    const b = new EscPosBuilder(cols).inicializar();
    b.alinear("centro").negrita(true).tamano(2, 2).linea("VENDEYA POS").tamano(1, 1).negrita(false);
    b.linea("Prueba de impresion").alinear("izquierda").separador();
    b.linea(`Papel: ${cfg.ancho} mm (${cols} columnas)`).linea(`Fecha: ${fechaHoraTicket(new Date())}`);
    b.linea("Acentos: áéíóú ñ Ñ ¿? € $").linea("0123456789".repeat(Math.ceil(cols / 10)).slice(0, cols)).cortar();
    await this.enviar(cfg, b.aBuffer());
  }

  // ── Internos ───────────────────────────────────────────────

  private async exigirConfigurada(actor: ActorCaja): Promise<ConfiguracionImpresora> {
    const cfg = await this.obtenerConfiguracion(actor);
    if (cfg.conexion === "NINGUNA") throw new AppError("ESTADO_INVALIDO", "No hay una impresora configurada");
    return cfg;
  }

  private async enviar(cfg: ConfiguracionImpresora, bytes: Buffer): Promise<void> {
    try {
      await this.fabrica(cfg).enviar(bytes);
    } catch (e) {
      if (e instanceof ImpresoraError) throw new AppError("ESTADO_INVALIDO", e.message);
      throw e;
    }
  }

  private ticketDeVenta(v: VentaParaTicket, cfg: ConfiguracionImpresora, reimpresion: boolean): Buffer {
    const empresa = v.sucursal.empresa;
    const hayEfectivo = v.pagos.some((p) => p.formaPago === "EFECTIVO");
    const datos: DatosTicketVenta = {
      empresa: { razonSocial: empresa.razonSocial, nombreComercial: empresa.nombreComercial, ruc: empresa.ruc, direccion: v.sucursal.direccion, telefono: v.sucursal.telefono },
      numero: v.numero,
      fecha: v.createdAt,
      cajero: `${v.cajero.nombre} ${v.cajero.apellido}`.trim(),
      cliente: v.clienteNombre !== null && v.clienteRuc !== null ? { nombre: v.clienteNombre, identificacion: v.clienteRuc } : null,
      lineas: v.lineas,
      subtotal: v.subtotal,
      descuento: v.descuento,
      iva: v.iva,
      propina: v.propina,
      total: v.total,
      pagos: v.pagos,
      comprobante: v.comprobante,
      anulada: v.estado === "ANULADA",
      reimpresion,
      // La gaveta se abre solo al cobrar (no en reimpresiones) y únicamente si hubo efectivo
      abrirGaveta: !reimpresion && cfg.aperturaGaveta && hayEfectivo && v.estado !== "ANULADA",
    };
    return construirTicketVenta(datos, columnasPara(cfg.ancho));
  }
}

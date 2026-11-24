// ============================================================
// src/server/services/sri/comprobante.service.ts
// Emisión de comprobantes electrónicos: factura (01) y nota de crédito (04).
//
// Regla de diseño: todo lo que puede fallar (reglas de la Ficha Técnica, clave de acceso, XML y validación XSD)
// se resuelve ANTES de escribir en la base de datos. Así un error de generación (AppError) nunca deja datos a medias
// y quien llama (la venta) puede capturarlo sin perder su transacción.
// ============================================================
import type { ComprobanteElectronico, PrismaClient } from "@prisma/client";
import { EmitirFacturaSchema, FiltroComprobantesSchema } from "../../../shared/schemas/comprobante.schema";
import type { ComprobanteDetalle, ComprobanteRepository, ComprobanteResumen, VentaParaEmision } from "../../repositories/comprobante.repository";
import type { Db } from "../../repositories/kardex.repository";
import type { ResultadoPaginado } from "../../repositories/producto.repository";
import { AppError } from "../appError.util";
import type { GiroService } from "../giro.service";
import { omitUndefined } from "../object.util";
import type { ActorCaja } from "../turno.service";
import { parsear } from "../validation.util";
import { generarClaveAcceso, type AmbienteSri } from "./claveAcceso.util";
import { datosFacturaDeVenta, datosNotaCreditoDeVenta } from "./comprobanteMapper";
import { COD_DOC_FACTURA, COD_DOC_NOTA_CREDITO, construirFacturaXml, construirNotaCreditoXml } from "./comprobanteXml.builder";
import type { TipoXsd, XsdValidatorService } from "./xsdValidator.service";

const TX_OPCIONES = { maxWait: 30_000, timeout: 60_000 } as const;

export interface ResultadoEmision {
  comprobante: ComprobanteElectronico;
  /** false si la venta ya tenía su factura (la emisión es idempotente) */
  creado: boolean;
}

const ambienteDe = (empresaAmbiente: string): AmbienteSri => (empresaAmbiente === "PRODUCCION" ? "2" : "1");

export class ComprobanteService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly repo: ComprobanteRepository,
    private readonly giro: GiroService,
    private readonly xsd: XsdValidatorService
  ) {}

  // ── Emisión (dentro de la transacción del llamador) ────────

  /**
   * Genera la factura electrónica de una venta: la deja PENDIENTE y en la cola de envío al SRI.
   * Idempotente: si la venta ya tiene factura la devuelve sin crear otra.
   * Lanza AppError (sin haber escrito nada) si no puede generarse.
   */
  async emitirFacturaEnTx(db: Db, ventaId: string, empresaId: string): Promise<ResultadoEmision> {
    const venta = await this.cargarVenta(db, ventaId, empresaId);
    if (venta.comprobante !== null) return { comprobante: venta.comprobante, creado: false };
    if (venta.estado !== "COMPLETADA") throw new AppError("ESTADO_INVALIDO", `La venta ${venta.numero} está ${venta.estado.toLowerCase()}: no se factura`);
    await this.giro.exigir(db, empresaId, "emitirFacturas");

    const ambiente = ambienteDe(venta.sucursal.empresa.ambienteSRI);
    const fechaEmision = new Date();
    const secuencial = await this.repo.siguienteSecuencial(db, venta.puntoEmisionId, COD_DOC_FACTURA);
    const claveAcceso = this.clave(venta, COD_DOC_FACTURA, ambiente, fechaEmision, secuencial);
    const xml = construirFacturaXml(
      datosFacturaDeVenta(venta, { claveAcceso, secuencial: String(secuencial).padStart(9, "0"), fechaEmision })
    );
    await this.exigirXmlValido("factura", xml);

    // ── A partir de aquí solo se escribe ──
    await this.reservar(db, venta.puntoEmisionId, COD_DOC_FACTURA, secuencial);
    const comprobante = await this.repo.crear(db, {
      ventaId: venta.id,
      empresaId,
      sucursalId: venta.sucursalId,
      puntoEmisionId: venta.puntoEmisionId,
      claveAcceso,
      tipoComprobante: COD_DOC_FACTURA,
      ambiente,
      serie: `${venta.sucursal.codigo}-${venta.puntoEmision.codigo}`,
      secuencial: String(secuencial).padStart(9, "0"),
      fechaEmision,
      xmlGenerado: xml,
      motivo: null,
      comprobanteOrigenId: null,
    });
    await this.repo.crearCola(db, comprobante.id);
    return { comprobante, creado: true };
  }

  /**
   * Nota de crédito por el total de una venta cuya factura ya fue AUTORIZADA (anulación de la venta).
   * Exige identificar al comprador (no admite Consumidor Final).
   */
  async emitirNotaCreditoEnTx(db: Db, ventaId: string, empresaId: string, motivo: string): Promise<ResultadoEmision> {
    const venta = await this.cargarVenta(db, ventaId, empresaId);
    const factura = venta.comprobante;
    if (factura === null || factura.estado !== "AUTORIZADO") {
      throw new AppError("ESTADO_INVALIDO", "Solo se emite nota de crédito sobre una factura autorizada por el SRI");
    }
    const existente = await db.comprobanteElectronico.findFirst({ where: { comprobanteOrigenId: factura.id, tipoComprobante: COD_DOC_NOTA_CREDITO, estado: { not: "ANULADO" } } });
    if (existente !== null) return { comprobante: existente, creado: false };

    const ambiente = factura.ambiente === "2" ? "2" : "1";
    const fechaEmision = new Date();
    const secuencial = await this.repo.siguienteSecuencial(db, venta.puntoEmisionId, COD_DOC_NOTA_CREDITO);
    const claveAcceso = this.clave(venta, COD_DOC_NOTA_CREDITO, ambiente, fechaEmision, secuencial);
    const xml = construirNotaCreditoXml(
      datosNotaCreditoDeVenta(
        venta,
        { numero: `${factura.serie}-${factura.secuencial}`, fechaEmision: factura.fechaEmision, ambiente },
        { claveAcceso, secuencial: String(secuencial).padStart(9, "0"), fechaEmision },
        motivo
      )
    );
    await this.exigirXmlValido("notaCredito", xml);

    await this.reservar(db, venta.puntoEmisionId, COD_DOC_NOTA_CREDITO, secuencial);
    const comprobante = await this.repo.crear(db, {
      ventaId: null, // la nota de crédito cuelga de la factura (ventaId es único por venta y lo ocupa la factura)
      empresaId,
      sucursalId: venta.sucursalId,
      puntoEmisionId: venta.puntoEmisionId,
      claveAcceso,
      tipoComprobante: COD_DOC_NOTA_CREDITO,
      ambiente,
      serie: `${venta.sucursal.codigo}-${venta.puntoEmision.codigo}`,
      secuencial: String(secuencial).padStart(9, "0"),
      fechaEmision,
      xmlGenerado: xml,
      motivo,
      comprobanteOrigenId: factura.id,
    });
    await this.repo.crearCola(db, comprobante.id);
    return { comprobante, creado: true };
  }

  /** Anula una factura que nunca llegó a autorizarse: sale de la cola y queda ANULADO. */
  async anularLocalEnTx(db: Db, comprobanteId: string): Promise<void> {
    await this.repo.marcarAnulado(db, comprobanteId);
  }

  // ── Operaciones expuestas por la API ───────────────────────

  /**
   * Emite (o recupera) la factura de una venta ya registrada. Si la factura anterior falló por falta de datos del
   * comprador, se puede indicar `clienteId` para asignarlo a la venta antes de generarla.
   */
  async emitirFactura(ventaId: string, entrada: unknown, actor: ActorCaja): Promise<ResultadoEmision> {
    const datos = parsear(EmitirFacturaSchema, entrada ?? {});
    return this.prisma.$transaction(async (tx) => {
      if (datos.clienteId !== undefined) {
        const cliente = await this.repo.buscarCliente(tx, datos.clienteId);
        if (cliente === null || cliente.status !== "ACTIVO") throw new AppError("NO_ENCONTRADO", "Cliente no encontrado");
        const venta = await this.repo.ventaParaEmision(tx, ventaId, actor.empresaId);
        if (venta === null) throw new AppError("NO_ENCONTRADO", "Venta no encontrada");
        if (venta.comprobante === null) await this.repo.asignarClienteAVenta(tx, ventaId, cliente);
      }
      return this.emitirFacturaEnTx(tx, ventaId, actor.empresaId);
    }, TX_OPCIONES);
  }

  async obtener(id: string, actor: ActorCaja): Promise<ComprobanteDetalle> {
    const c = await this.repo.buscarPorId(this.prisma, id, actor.empresaId);
    if (c === null) throw new AppError("NO_ENCONTRADO", "Comprobante no encontrado");
    return c;
  }

  async listar(entrada: unknown, actor: ActorCaja): Promise<ResultadoPaginado<ComprobanteResumen>> {
    const f = parsear(FiltroComprobantesSchema, entrada ?? {});
    return this.repo.listar(this.prisma, {
      empresaId: actor.empresaId,
      page: f.page,
      pageSize: f.pageSize,
      ...omitUndefined({ estado: f.estado, tipoComprobante: f.tipoComprobante }),
    });
  }

  // ── Internos ───────────────────────────────────────────────

  private async cargarVenta(db: Db, ventaId: string, empresaId: string): Promise<VentaParaEmision> {
    const venta = await this.repo.ventaParaEmision(db, ventaId, empresaId);
    if (venta === null) throw new AppError("NO_ENCONTRADO", "Venta no encontrada");
    return venta;
  }

  private clave(venta: VentaParaEmision, tipo: string, ambiente: AmbienteSri, fechaEmision: Date, secuencial: number): string {
    return generarClaveAcceso({
      fechaEmision,
      tipoComprobante: tipo,
      ruc: venta.sucursal.empresa.ruc,
      ambiente,
      establecimiento: venta.sucursal.codigo,
      puntoEmision: venta.puntoEmision.codigo,
      secuencial,
    });
  }

  private async exigirXmlValido(tipo: TipoXsd, xml: string): Promise<void> {
    const r = await this.xsd.validar(tipo, xml);
    if (!r.valido) {
      const detalle = r.errores.slice(0, 5).map((e) => e.mensaje).join(" | ");
      throw new AppError("VALIDACION", `El comprobante no cumple el esquema XSD del SRI: ${detalle}`);
    }
  }

  /** Reserva el secuencial y comprueba que sea el mismo con el que se generó el XML. */
  private async reservar(db: Db, puntoEmisionId: string, tipo: string, esperado: number): Promise<void> {
    const reservado = await this.repo.reservarSecuencial(db, puntoEmisionId, tipo);
    if (reservado !== esperado) {
      // No debería ocurrir (la transacción serializa las escrituras); se aborta antes que emitir un número distinto
      throw new Error(`Secuencial ${reservado} distinto del usado en el XML (${esperado})`);
    }
  }
}

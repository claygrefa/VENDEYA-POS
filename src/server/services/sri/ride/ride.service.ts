// ============================================================
// src/server/services/sri/ride/ride.service.ts — RIDE de un comprobante de la empresa
// ============================================================
import type { PrismaClient } from "@prisma/client";
import type { ComprobanteRepository } from "../../../repositories/comprobante.repository";
import { AppError } from "../../appError.util";
import type { ActorCaja } from "../../turno.service";
import { datosRideDesdeXml } from "./ride.datos";
import { generarRidePdf, type OpcionesRidePdf } from "./ride.pdf";

export interface ResultadoRide {
  pdf: Buffer;
  /** Nombre sugerido: `<tipo>-<estab>-<pto>-<secuencial>.pdf` */
  nombreArchivo: string;
  autorizado: boolean;
}

export class RideService {
  constructor(private readonly prisma: PrismaClient, private readonly repo: ComprobanteRepository, private readonly opciones: OpcionesRidePdf = {}) {}

  /**
   * RIDE del comprobante. Usa el XML autorizado; si aún no está autorizado usa el firmado o el generado y el PDF queda
   * marcado «sin valor tributario».
   */
  async generar(comprobanteId: string, actor: ActorCaja): Promise<ResultadoRide> {
    const c = await this.repo.buscarPorId(this.prisma, comprobanteId, actor.empresaId);
    if (c === null) throw new AppError("NO_ENCONTRADO", "Comprobante no encontrado");
    const xml = c.xmlAutorizado ?? c.xmlFirmado ?? c.xmlGenerado;
    if (xml === null) throw new AppError("ESTADO_INVALIDO", "El comprobante no tiene XML para imprimir");
    const datos = datosRideDesdeXml(xml);
    const pdf = await generarRidePdf(datos, this.opciones);
    const tipo = datos.titulo.split(" ")[0]?.toLowerCase() ?? "comprobante";
    return { pdf, nombreArchivo: `${tipo}-${datos.numero}.pdf`, autorizado: datos.autorizado };
  }

  /**
   * RIDE de la factura de una venta (para que quien cobró pueda guardar o enviar el comprobante aunque no haya impresora). Es de la venta,
   * no del monitor del SRI: se pide con el permiso de leer ventas y solo devuelve la factura de esa venta.
   */
  async generarDeVenta(ventaId: string, actor: ActorCaja): Promise<ResultadoRide> {
    const factura = await this.prisma.comprobanteElectronico.findFirst({ where: { ventaId, empresaId: actor.empresaId, tipoComprobante: "01" }, select: { id: true } });
    if (factura === null) throw new AppError("NO_ENCONTRADO", "Esta venta no tiene factura electrónica");
    return this.generar(factura.id, actor);
  }
}

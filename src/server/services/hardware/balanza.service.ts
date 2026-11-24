// ============================================================
// src/server/services/hardware/balanza.service.ts — Balanza serial: configuración y lectura de peso para la venta a granel
// ============================================================
import type { PrismaClient } from "@prisma/client";
import { ConfigurarBalanzaSchema, LeerPesoSchema } from "../../../shared/schemas/balanza.schema";
import type { ConfiguracionRepository } from "../../repositories/configuracion.repository";
import { AppError } from "../appError.util";
import type { GiroService } from "../giro.service";
import type { ActorCaja } from "../turno.service";
import { parsear } from "../validation.util";
import { leerPesoEstable, PuertoSerieNode, type OpcionesLectura, type ProtocoloBalanza, type PuertoSerie } from "./balanza.protocolo";
import { kilosAUnidad } from "./escaneo.service";

export interface ConfiguracionBalanza {
  habilitada: boolean;
  puerto: string | null;
  baudios: number;
  protocolo: ProtocoloBalanza;
  etiqueta: "PESO" | "PRECIO";
}

export interface PesoLeido {
  /** Peso que marca la balanza, en kg */
  brutoKg: number;
  taraKg: number;
  /** bruto − tara */
  netoKg: number;
  /** Solo si se indicó el producto: cantidad en SU unidad de medida */
  cantidad: number | null;
  unidad: string | null;
}

export type FabricaPuerto = (c: { ruta: string; baudios: number }) => PuertoSerie;

export interface OpcionesBalanza {
  fabricaPuerto?: FabricaPuerto;
  lectura?: Partial<Pick<OpcionesLectura, "lecturasIguales" | "timeoutMs">>;
}

export class BalanzaService {
  private readonly fabrica: FabricaPuerto;
  private readonly lectura: Partial<Pick<OpcionesLectura, "lecturasIguales" | "timeoutMs">>;
  /** Un solo dueño del puerto a la vez: dos cajas no pueden leer la misma balanza simultáneamente */
  private ocupada = false;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly configuracion: ConfiguracionRepository,
    private readonly giro: GiroService,
    opciones: OpcionesBalanza = {}
  ) {
    this.fabrica = opciones.fabricaPuerto ?? ((c) => new PuertoSerieNode(c));
    this.lectura = opciones.lectura ?? {};
  }

  async obtenerConfiguracion(actor: ActorCaja): Promise<ConfiguracionBalanza> {
    const g = await this.configuracion.porEmpresa(this.prisma, actor.empresaId);
    return {
      habilitada: g?.moduloBalanza ?? false,
      puerto: g?.balanzaPuerto ?? null,
      baudios: g?.balanzaBaudios ?? 9600,
      protocolo: g?.balanzaProtocolo === "CAS" ? "CAS" : "GENERICO",
      etiqueta: g?.balanzaEtiqueta === "PRECIO" ? "PRECIO" : "PESO",
    };
  }

  async configurar(entrada: unknown, actor: ActorCaja): Promise<ConfiguracionBalanza> {
    const d = parsear(ConfigurarBalanzaSchema, entrada);
    if ((await this.configuracion.porEmpresa(this.prisma, actor.empresaId)) === null) throw new AppError("NO_ENCONTRADO", "Configure primero el giro del negocio");
    await this.prisma.configuracionGiro.update({
      where: { empresaId: actor.empresaId },
      data: { balanzaPuerto: d.puerto ?? null, balanzaBaudios: d.baudios, balanzaProtocolo: d.protocolo, balanzaEtiqueta: d.etiqueta },
    });
    return this.obtenerConfiguracion(actor);
  }

  /** Lee un peso estable de la balanza y lo convierte (descontando la tara). */
  async leerPeso(entrada: unknown, actor: ActorCaja): Promise<PesoLeido> {
    const d = parsear(LeerPesoSchema, entrada ?? {});
    await this.giro.exigir(this.prisma, actor.empresaId, "moduloBalanza");
    const cfg = await this.obtenerConfiguracion(actor);
    if (cfg.puerto === null) throw new AppError("ESTADO_INVALIDO", "No hay una balanza configurada");

    let unidad: string | null = null;
    if (d.productoId !== undefined) {
      const p = await this.prisma.producto.findUnique({ where: { id: d.productoId }, select: { unidadMedida: { select: { codigo: true } } } });
      if (p === null) throw new AppError("NO_ENCONTRADO", "Producto no encontrado");
      unidad = p.unidadMedida.codigo;
      if (kilosAUnidad(1, unidad) === null) throw new AppError("VALIDACION", `El producto no se vende por peso (unidad ${unidad})`);
    }

    if (this.ocupada) throw new AppError("ESTADO_INVALIDO", "La balanza está siendo leída por otra operación: reintente");
    this.ocupada = true;
    try {
      const l = await leerPesoEstable(this.fabrica({ ruta: cfg.puerto, baudios: cfg.baudios }), { protocolo: cfg.protocolo, ...this.lectura });
      const neto = Math.round((l.pesoKg - d.tara) * 10_000) / 10_000;
      if (neto < 0) throw new AppError("VALIDACION", `La tara (${d.tara} kg) es mayor que el peso (${l.pesoKg} kg)`);
      return { brutoKg: l.pesoKg, taraKg: d.tara, netoKg: neto, cantidad: unidad === null ? null : kilosAUnidad(neto, unidad), unidad };
    } finally {
      this.ocupada = false;
    }
  }
}

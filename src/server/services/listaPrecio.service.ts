// ============================================================
// src/server/services/listaPrecio.service.ts — Listas de precios (mayorista, ferretería…)
// ============================================================
import type { Cliente, ListaPrecio, PrismaClient } from "@prisma/client";
import {
  AsignarListaSchema,
  FijarPrecioSchema,
  ListaPrecioActualizarSchema,
  ListaPrecioSchema,
} from "../../shared/schemas/inventario.schema";
import type { ListaPrecioRepository, PrecioConDetalle } from "../repositories/listaPrecio.repository";
import { AppError } from "./appError.util";
import type { GiroService } from "./giro.service";
import { omitUndefined } from "./object.util";
import type { ActorCaja } from "./turno.service";
import { parsear } from "./validation.util";
import { round2 } from "./ventaCalculo.util";

export class ListaPrecioService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly repo: ListaPrecioRepository,
    private readonly giro: GiroService
  ) {}

  async crear(entrada: unknown, actor: ActorCaja): Promise<ListaPrecio> {
    const datos = parsear(ListaPrecioSchema, entrada);
    await this.giro.exigir(this.prisma, actor.empresaId, "moduloListasPrecios");
    return this.prisma.$transaction(async (tx) => {
      if ((await this.repo.nombreExiste(tx, actor.empresaId, datos.nombre)) !== null) {
        throw new AppError("DUPLICADO", `Ya existe una lista de precios llamada "${datos.nombre}"`);
      }
      return this.repo.crear(tx, { empresaId: actor.empresaId, nombre: datos.nombre, descripcion: datos.descripcion ?? "" });
    });
  }

  async listar(actor: ActorCaja): Promise<ListaPrecio[]> {
    await this.giro.exigir(this.prisma, actor.empresaId, "moduloListasPrecios");
    return this.repo.listar(this.prisma, actor.empresaId);
  }

  async actualizar(id: string, entrada: unknown, actor: ActorCaja): Promise<ListaPrecio> {
    const datos = parsear(ListaPrecioActualizarSchema, entrada);
    await this.giro.exigir(this.prisma, actor.empresaId, "moduloListasPrecios");
    return this.prisma.$transaction(async (tx) => {
      if ((await this.repo.buscarPorId(tx, id, actor.empresaId)) === null) throw new AppError("NO_ENCONTRADO", "Lista de precios no encontrada");
      if (datos.nombre !== undefined && (await this.repo.nombreExiste(tx, actor.empresaId, datos.nombre, id)) !== null) {
        throw new AppError("DUPLICADO", `Ya existe una lista de precios llamada "${datos.nombre}"`);
      }
      return this.repo.actualizar(tx, id, omitUndefined(datos));
    });
  }

  /** Crea o actualiza el precio de un producto (o de una de sus presentaciones) en la lista. */
  async fijarPrecio(listaId: string, entrada: unknown, actor: ActorCaja): Promise<PrecioConDetalle> {
    const datos = parsear(FijarPrecioSchema, entrada);
    await this.giro.exigir(this.prisma, actor.empresaId, "moduloListasPrecios");
    return this.prisma.$transaction(async (tx) => {
      const lista = await this.repo.buscarPorId(tx, listaId, actor.empresaId);
      if (lista === null) throw new AppError("NO_ENCONTRADO", "Lista de precios no encontrada");
      if ((await this.repo.producto(tx, datos.productoId)) === null) throw new AppError("NO_ENCONTRADO", "Producto no encontrado");

      const presentacionId = datos.presentacionId ?? null;
      if (presentacionId !== null) {
        const pres = await this.repo.presentacion(tx, presentacionId);
        if (pres === null || pres.productoId !== datos.productoId) {
          throw new AppError("NO_ENCONTRADO", "La presentación no pertenece al producto indicado");
        }
      }
      const precio = round2(datos.precio);
      const existente = await this.repo.buscarPrecio(tx, listaId, datos.productoId, presentacionId);
      return existente !== null
        ? this.repo.actualizarPrecio(tx, existente.id, precio)
        : this.repo.crearPrecio(tx, { listaPrecioId: listaId, productoId: datos.productoId, presentacionId, precio });
    });
  }

  async quitarPrecio(listaId: string, precioId: string, actor: ActorCaja): Promise<void> {
    await this.giro.exigir(this.prisma, actor.empresaId, "moduloListasPrecios");
    if ((await this.repo.buscarPorId(this.prisma, listaId, actor.empresaId)) === null) {
      throw new AppError("NO_ENCONTRADO", "Lista de precios no encontrada");
    }
    if ((await this.repo.eliminarPrecio(this.prisma, precioId, listaId)) === 0) {
      throw new AppError("NO_ENCONTRADO", "Precio no encontrado en la lista");
    }
  }

  async precios(listaId: string, actor: ActorCaja): Promise<PrecioConDetalle[]> {
    await this.giro.exigir(this.prisma, actor.empresaId, "moduloListasPrecios");
    if ((await this.repo.buscarPorId(this.prisma, listaId, actor.empresaId)) === null) {
      throw new AppError("NO_ENCONTRADO", "Lista de precios no encontrada");
    }
    return this.repo.preciosDeLista(this.prisma, listaId);
  }

  /** Asigna (o quita con `null`) la lista de precios de un cliente. */
  async asignarACliente(clienteId: string, entrada: unknown, actor: ActorCaja): Promise<Cliente> {
    const { listaPrecioId } = parsear(AsignarListaSchema, entrada);
    await this.giro.exigir(this.prisma, actor.empresaId, "moduloListasPrecios");
    return this.prisma.$transaction(async (tx) => {
      if ((await this.repo.cliente(tx, clienteId)) === null) throw new AppError("NO_ENCONTRADO", "Cliente no encontrado");
      if (listaPrecioId !== null) {
        const lista = await this.repo.buscarPorId(tx, listaPrecioId, actor.empresaId);
        if (lista === null) throw new AppError("NO_ENCONTRADO", "Lista de precios no encontrada");
        if (lista.status !== "ACTIVO") throw new AppError("VALIDACION", "La lista de precios está inactiva");
      }
      return this.repo.asignarACliente(tx, clienteId, listaPrecioId);
    });
  }
}

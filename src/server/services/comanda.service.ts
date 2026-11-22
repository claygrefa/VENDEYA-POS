// ============================================================
// src/server/services/comanda.service.ts — Cuentas de mesa, envío a cocina/barra y cobro dividido
// ============================================================
import type { ItemComanda, PrismaClient } from "@prisma/client";
import {
  AbrirComandaSchema,
  AgregarItemsSchema,
  AnularComandaSchema,
  CancelarItemSchema,
  CobrarComandaSchema,
  EstadoItemSchema,
  FiltroComandasSchema,
  FiltroCocinaSchema,
  MoverComandaSchema,
  PreCuentaQuerySchema,
  UnirComandaSchema,
} from "../../shared/schemas/restaurante.schema";
import type { ComandaDetalle, ComandaRepository, ItemDeCocina } from "../repositories/comanda.repository";
import type { Db } from "../repositories/kardex.repository";
import type { VentaCompleta } from "../repositories/venta.repository";
import { AppError } from "./appError.util";
import {
  esItemEnviado,
  lineasParaItems,
  lineasParaParte,
  totalItem,
  transicionItemValida,
  type ItemCobrable,
  type LineaCobro,
} from "./comanda.util";
import type { GiroService } from "./giro.service";
import { resolverPorcentajeIva } from "./impuesto.util";
import { validarCantidadVenta } from "./inventario.util";
import { omitUndefined } from "./object.util";
import type { ActorCaja } from "./turno.service";
import { parsear } from "./validation.util";
import type { VentaService } from "./venta.service";
import { calcularLinea, calcularTotales, round2, type TotalesVenta } from "./ventaCalculo.util";

/** Permiso para cobrar una comanda (además de `ventas:crear` en la ruta). */
export const PERMISO_COBRAR_COMANDA = "restaurante:actualizar";
/** Permiso para cancelar ítems ya enviados a cocina/barra y para anular una cuenta. */
export const PERMISO_CANCELAR_ENVIADO = "restaurante:anular";

const TX_OPCIONES = { maxWait: 30_000, timeout: 60_000 } as const;

export interface ResumenComanda {
  items: number;
  /** Consumo vigente sin IVA (ítems no cancelados) */
  consumo: number;
  /** Parte del consumo aún sin cobrar */
  porCobrar: number;
}

export type ComandaConResumen = ComandaDetalle & { resumen: ResumenComanda };

export interface TicketEnvio {
  comandaId: string;
  numeroComanda: number;
  mesa: string;
  envio: number;
  enviadoAt: Date;
  destinos: Array<{
    destino: string;
    items: Array<{ itemId: string; producto: string; cantidad: number; observaciones: string | null }>;
  }>;
}

export interface PreCuenta {
  comandaId: string;
  numeroComanda: number;
  items: Array<{ id: string; producto: string; cantidad: number; precioUnitario: number; total: number }>;
  totales: TotalesVenta;
  /** Solo si se pidió `partes` (o la cuenta ya se está dividiendo) */
  partes?: Array<TotalesVenta & { parte: number; cobrada: boolean }>;
}

export interface ResultadoCobro {
  venta: VentaCompleta;
  comanda: ComandaConResumen;
  /** true si con este cobro la cuenta quedó saldada y la mesa liberada */
  cerrada: boolean;
}

function resumir(c: ComandaDetalle): ResumenComanda {
  const vigentes = c.items.filter((i) => i.estado !== "CANCELADO");
  return {
    items: vigentes.length,
    consumo: round2(vigentes.reduce((a, i) => a + i.total, 0)),
    porCobrar: round2(vigentes.filter((i) => !i.cobrado).reduce((a, i) => a + i.total, 0)),
  };
}

const conResumen = (c: ComandaDetalle): ComandaConResumen => ({ ...c, resumen: resumir(c) });

const cobrables = (c: ComandaDetalle): ComandaDetalle["items"] => c.items.filter((i) => i.estado !== "CANCELADO" && !i.cobrado);

const aCobrable = (i: ItemComanda): ItemCobrable => ({
  id: i.id,
  productoId: i.productoId,
  cantidad: i.cantidad,
  precioUnitario: i.precioUnitario,
  descuento: i.descuento,
});

export class ComandaService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly repo: ComandaRepository,
    private readonly giro: GiroService,
    private readonly ventas: VentaService
  ) {}

  // ── Apertura y consulta ────────────────────────────────────

  /** Abre la cuenta de una mesa libre o reservada y la marca como OCUPADA. */
  async abrir(entrada: unknown, actor: ActorCaja): Promise<ComandaConResumen> {
    const datos = parsear(AbrirComandaSchema, entrada);
    await this.giro.exigir(this.prisma, actor.empresaId, "moduloMesas");

    return this.prisma.$transaction(async (tx) => {
      const mesa = await this.repo.mesa(tx, datos.mesaId, actor.empresaId);
      if (mesa === null) throw new AppError("NO_ENCONTRADO", "Mesa no encontrada");
      if (mesa.status !== "ACTIVO") throw new AppError("VALIDACION", `La mesa "${mesa.nombre}" está inactiva`);
      if ((await this.repo.comandaAbiertaDeMesa(tx, mesa.id)) !== null) {
        throw new AppError("ESTADO_INVALIDO", `La mesa "${mesa.nombre}" ya tiene una cuenta abierta`);
      }

      const meseroId = datos.meseroId ?? actor.id;
      if (!(await this.repo.usuarioDeEmpresa(tx, meseroId, actor.empresaId))) {
        throw new AppError("NO_ENCONTRADO", "Mesero no encontrado");
      }

      const numero = await this.repo.reservarNumero(tx, mesa.sucursalId);
      const comanda = await this.repo.crear(tx, {
        sucursalId: mesa.sucursalId,
        numero,
        mesaId: mesa.id,
        meseroId,
        comensales: datos.comensales,
        observaciones: datos.observaciones ?? null,
      });
      await this.repo.actualizarEstadoMesa(tx, mesa.id, "OCUPADA");
      return conResumen(await this.cargar(tx, comanda.id, actor));
    }, TX_OPCIONES);
  }

  async obtener(id: string, actor: ActorCaja): Promise<ComandaConResumen> {
    await this.giro.exigir(this.prisma, actor.empresaId, "moduloMesas");
    return conResumen(await this.cargar(this.prisma, id, actor));
  }

  async listar(entrada: unknown, actor: ActorCaja): Promise<ComandaConResumen[]> {
    const f = parsear(FiltroComandasSchema, entrada ?? {});
    await this.giro.exigir(this.prisma, actor.empresaId, "moduloMesas");
    const comandas = await this.repo.listar(this.prisma, { empresaId: actor.empresaId, ...omitUndefined(f) });
    return comandas.map(conResumen);
  }

  // ── Ítems ──────────────────────────────────────────────────

  /** Agrega pedidos a la cuenta en cualquier momento; el precio y el destino se fijan al pedir. */
  async agregarItems(comandaId: string, entrada: unknown, actor: ActorCaja): Promise<ComandaConResumen> {
    const datos = parsear(AgregarItemsSchema, entrada);
    await this.giro.exigir(this.prisma, actor.empresaId, "moduloMesas");

    return this.prisma.$transaction(async (tx) => {
      const comanda = await this.cargarEditable(tx, comandaId, actor);
      const ids = [...new Set(datos.items.map((i) => i.productoId))];
      const productos = new Map((await this.repo.productosDeMenu(tx, ids)).map((p) => [p.id, p]));

      for (const item of datos.items) {
        const producto = productos.get(item.productoId);
        if (producto === undefined) throw new AppError("NO_ENCONTRADO", `Producto ${item.productoId} no encontrado`);
        if (producto.status !== "ACTIVO") throw new AppError("VALIDACION", `El producto "${producto.nombre}" está inactivo`);
        validarCantidadVenta({
          cantidad: item.cantidad,
          permiteDecimales: producto.unidadMedida.permiteDecimales,
          esPresentacion: false,
          nombre: producto.nombre,
        });
        await this.repo.crearItem(tx, {
          comandaId: comanda.id,
          productoId: producto.id,
          cantidad: item.cantidad,
          precioUnitario: producto.precioVenta,
          total: totalItem(item.cantidad, producto.precioVenta),
          destino: producto.destinoPreparacion,
          observaciones: item.observaciones ?? null,
        });
      }
      return conResumen(await this.cargar(tx, comanda.id, actor));
    }, TX_OPCIONES);
  }

  /**
   * Cancela un ítem. Los pendientes se quitan sin más; uno ya enviado a cocina/barra exige
   * motivo (≥5 caracteres) y el permiso `restaurante:anular` (supervisor).
   */
  async cancelarItem(comandaId: string, itemId: string, entrada: unknown, actor: ActorCaja): Promise<ComandaConResumen> {
    const { motivo } = parsear(CancelarItemSchema, entrada ?? {});
    await this.giro.exigir(this.prisma, actor.empresaId, "moduloMesas");

    return this.prisma.$transaction(async (tx) => {
      const comanda = await this.cargarEditable(tx, comandaId, actor);
      const item = comanda.items.find((i) => i.id === itemId);
      if (item === undefined) throw new AppError("NO_ENCONTRADO", "Ítem no encontrado en la cuenta");
      if (item.estado === "CANCELADO") throw new AppError("ESTADO_INVALIDO", "El ítem ya está cancelado");
      if (item.cobrado) throw new AppError("ESTADO_INVALIDO", "El ítem ya fue cobrado");

      if (esItemEnviado(item.estado)) {
        if (!actor.permisos.includes(PERMISO_CANCELAR_ENVIADO)) {
          throw new AppError("SIN_PERMISO", "Cancelar un ítem ya enviado a cocina/barra requiere autorización de un supervisor");
        }
        if (motivo === undefined || motivo.length < 5) {
          throw new AppError("VALIDACION", "Cancelar un ítem enviado exige un motivo de al menos 5 caracteres");
        }
      }
      await this.repo.actualizarItem(tx, itemId, { estado: "CANCELADO", motivoCancelacion: motivo ?? null });
      return conResumen(await this.cargar(tx, comandaId, actor));
    }, TX_OPCIONES);
  }

  // ── Cocina / barra ─────────────────────────────────────────

  /**
   * Envía los ítems pendientes a preparación (EN_PREPARACION) y devuelve el ticket agrupado
   * por destino (cocina / barra), numerado por envío.
   */
  async enviar(comandaId: string, actor: ActorCaja): Promise<TicketEnvio> {
    await this.giro.exigir(this.prisma, actor.empresaId, "moduloMesas");
    await this.giro.exigir(this.prisma, actor.empresaId, "moduloComandasCocina");

    return this.prisma.$transaction(async (tx) => {
      const comanda = await this.cargarAbierta(tx, comandaId, actor);
      if (!comanda.items.some((i) => i.estado === "PENDIENTE")) {
        throw new AppError("VALIDACION", "No hay ítems pendientes de enviar");
      }
      const envio = (await this.repo.maxEnvio(tx, comanda.id)) + 1;
      const fecha = new Date();
      await this.repo.marcarEnviados(tx, comanda.id, envio, fecha);

      const items = await this.repo.itemsDeEnvio(tx, comanda.id, envio);
      const destinos = new Map<string, TicketEnvio["destinos"][number]["items"]>();
      for (const i of items) {
        const lista = destinos.get(i.destino) ?? [];
        lista.push({ itemId: i.id, producto: i.producto.nombre, cantidad: i.cantidad, observaciones: i.observaciones });
        destinos.set(i.destino, lista);
      }
      return {
        comandaId: comanda.id,
        numeroComanda: comanda.numero,
        mesa: comanda.mesa.nombre,
        envio,
        enviadoAt: fecha,
        destinos: [...destinos].map(([destino, lista]) => ({ destino, items: lista })),
      };
    }, TX_OPCIONES);
  }

  /** Avance de un ítem enviado: cocina lo marca LISTO y el mesero ENTREGADO. */
  async cambiarEstadoItem(comandaId: string, itemId: string, entrada: unknown, actor: ActorCaja): Promise<ComandaConResumen> {
    const { estado } = parsear(EstadoItemSchema, entrada);
    await this.giro.exigir(this.prisma, actor.empresaId, "moduloMesas");
    const usaCocina = await this.giro.habilitado(this.prisma, actor.empresaId, "moduloComandasCocina");

    return this.prisma.$transaction(async (tx) => {
      const comanda = await this.cargarAbierta(tx, comandaId, actor);
      const item = comanda.items.find((i) => i.id === itemId);
      if (item === undefined) throw new AppError("NO_ENCONTRADO", "Ítem no encontrado en la cuenta");
      if (!transicionItemValida(item.estado, estado, usaCocina)) {
        throw new AppError("ESTADO_INVALIDO", `Un ítem ${item.estado} no puede pasar a ${estado}`);
      }
      await this.repo.actualizarItem(tx, itemId, { estado });
      return conResumen(await this.cargar(tx, comandaId, actor));
    }, TX_OPCIONES);
  }

  /** Vista de cocina/barra: ítems enviados, del más antiguo al más reciente. */
  async pendientesCocina(entrada: unknown, actor: ActorCaja): Promise<ItemDeCocina[]> {
    const f = parsear(FiltroCocinaSchema, entrada ?? {});
    await this.giro.exigir(this.prisma, actor.empresaId, "moduloComandasCocina");
    return this.repo.itemsParaCocina(this.prisma, { empresaId: actor.empresaId, estado: f.estado, ...omitUndefined({ destino: f.destino, sucursalId: f.sucursalId }) });
  }

  // ── Mesas: mover y unir ────────────────────────────────────

  /** Cambia la cuenta a otra mesa libre de la misma sucursal. */
  async mover(comandaId: string, entrada: unknown, actor: ActorCaja): Promise<ComandaConResumen> {
    const { mesaId } = parsear(MoverComandaSchema, entrada);
    await this.giro.exigir(this.prisma, actor.empresaId, "moduloMesas");

    return this.prisma.$transaction(async (tx) => {
      const comanda = await this.cargarAbierta(tx, comandaId, actor);
      if (mesaId === comanda.mesaId) throw new AppError("VALIDACION", "La cuenta ya está en esa mesa");
      const destino = await this.repo.mesa(tx, mesaId, actor.empresaId);
      if (destino === null) throw new AppError("NO_ENCONTRADO", "Mesa de destino no encontrada");
      if (destino.sucursalId !== comanda.sucursalId) throw new AppError("VALIDACION", "La mesa de destino es de otra sucursal");
      if (destino.status !== "ACTIVO") throw new AppError("VALIDACION", `La mesa "${destino.nombre}" está inactiva`);
      if ((await this.repo.comandaAbiertaDeMesa(tx, destino.id)) !== null) {
        throw new AppError("ESTADO_INVALIDO", `La mesa "${destino.nombre}" ya tiene una cuenta abierta: use unir cuentas`);
      }

      await this.repo.actualizar(tx, comanda.id, { mesaId: destino.id });
      await this.repo.actualizarEstadoMesa(tx, comanda.mesaId, "LIBRE");
      await this.repo.actualizarEstadoMesa(tx, destino.id, "OCUPADA");
      return conResumen(await this.cargar(tx, comanda.id, actor));
    }, TX_OPCIONES);
  }

  /** Une la cuenta con otra abierta de la misma sucursal: sus ítems pasan a la cuenta de destino. */
  async unir(comandaId: string, entrada: unknown, actor: ActorCaja): Promise<ComandaConResumen> {
    const { comandaDestinoId } = parsear(UnirComandaSchema, entrada);
    await this.giro.exigir(this.prisma, actor.empresaId, "moduloMesas");

    return this.prisma.$transaction(async (tx) => {
      const origen = await this.cargarEditable(tx, comandaId, actor);
      if (comandaDestinoId === origen.id) throw new AppError("VALIDACION", "No se puede unir una cuenta consigo misma");
      const destino = await this.cargarEditable(tx, comandaDestinoId, actor);
      if (destino.sucursalId !== origen.sucursalId) throw new AppError("VALIDACION", "Las cuentas son de sucursales distintas");
      if (origen.cobros.length > 0) throw new AppError("ESTADO_INVALIDO", "La cuenta de origen ya tiene cobros");

      await this.repo.trasladarItems(tx, origen.id, destino.id);
      await this.repo.actualizar(tx, destino.id, { comensales: destino.comensales + origen.comensales });
      await this.repo.actualizar(tx, origen.id, { estado: "UNIDA", fechaCierre: new Date() });
      await this.repo.actualizarEstadoMesa(tx, origen.mesaId, "LIBRE");
      return conResumen(await this.cargar(tx, destino.id, actor));
    }, TX_OPCIONES);
  }

  // ── Cuenta, cobro y anulación ──────────────────────────────

  /** Pre-cuenta con IVA; con `partes` simula la división en partes iguales. */
  async preCuenta(comandaId: string, entrada: unknown, actor: ActorCaja): Promise<PreCuenta> {
    const { partes: partesPedidas } = parsear(PreCuentaQuerySchema, entrada ?? {});
    await this.giro.exigir(this.prisma, actor.empresaId, "moduloMesas");
    const comanda = await this.cargar(this.prisma, comandaId, actor);
    const pendientes = cobrables(comanda);
    const partes = comanda.divisionPartes ?? partesPedidas;

    const ivaPorProducto = await this.ivaDe(this.prisma, pendientes.map((i) => i.productoId), actor.empresaId);
    const calcular = (lineas: LineaCobro[]): TotalesVenta =>
      calcularTotales(lineas.map((l) => calcularLinea({ ...l, porcentajeIva: ivaPorProducto.get(l.productoId) ?? 0 })));

    const cuenta: PreCuenta = {
      comandaId: comanda.id,
      numeroComanda: comanda.numero,
      items: pendientes.map((i) => ({ id: i.id, producto: i.producto.nombre, cantidad: i.cantidad, precioUnitario: i.precioUnitario, total: i.total })),
      totales: calcular(lineasParaItems(pendientes.map(aCobrable))),
    };
    if (partes !== undefined && partes !== null) {
      const cobradas = new Set(comanda.cobros.flatMap((c) => (c.parte !== null ? [c.parte] : [])));
      cuenta.partes = Array.from({ length: partes }, (_, k) => ({
        parte: k + 1,
        cobrada: cobradas.has(k + 1),
        ...calcular(lineasParaParte(pendientes.map(aCobrable), k + 1, partes)),
      }));
    }
    return cuenta;
  }

  /**
   * Cobra la cuenta (o una parte) como una Venta independiente, en la misma transacción que la
   * actualización de ítems y el cierre de la mesa. Stock y Kardex se descuentan aquí, no al pedir.
   *  - ITEMS: cobra los ítems indicados (por defecto, todos los pendientes de cobro).
   *  - PARTE_IGUAL: cobra la parte `parte` de `partes`; cada ítem aporta su fracción.
   */
  async cobrar(comandaId: string, entrada: unknown, actor: ActorCaja): Promise<ResultadoCobro> {
    const datos = parsear(CobrarComandaSchema, entrada);
    if (!actor.permisos.includes(PERMISO_COBRAR_COMANDA)) {
      throw new AppError("SIN_PERMISO", "No tiene permiso para cobrar cuentas de mesa");
    }
    await this.giro.exigir(this.prisma, actor.empresaId, "moduloMesas");

    return this.prisma.$transaction(async (tx) => {
      const comanda = await this.cargarAbierta(tx, comandaId, actor);

      const punto = await this.repo.puntoEmision(tx, datos.puntoEmisionId);
      if (punto === null || punto.sucursalId !== comanda.sucursalId) {
        throw new AppError("VALIDACION", "El punto de emisión no pertenece a la sucursal de la cuenta");
      }

      const pendientes = cobrables(comanda);
      let lineas: LineaCobro[];
      let itemsACobrar: ComandaDetalle["items"] = [];
      let parte: number | null = null;

      if (datos.modo === "ITEMS") {
        if (comanda.divisionPartes !== null) {
          throw new AppError("ESTADO_INVALIDO", "La cuenta se está cobrando en partes iguales: continúe por partes");
        }
        itemsACobrar =
          datos.itemIds === undefined
            ? pendientes
            : datos.itemIds.map((id) => {
                const item = pendientes.find((i) => i.id === id);
                if (item === undefined) throw new AppError("VALIDACION", `El ítem ${id} no existe, está cancelado o ya fue cobrado`);
                return item;
              });
        if (itemsACobrar.length === 0) throw new AppError("VALIDACION", "No hay ítems por cobrar");
        lineas = lineasParaItems(itemsACobrar.map(aCobrable));
      } else {
        const partes = datos.partes as number;
        parte = datos.parte as number;
        if (comanda.cobros.some((c) => c.modo === "ITEMS")) {
          throw new AppError("ESTADO_INVALIDO", "La cuenta ya tiene cobros por ítems: no puede dividirse en partes iguales");
        }
        if (comanda.divisionPartes !== null && comanda.divisionPartes !== partes) {
          throw new AppError("VALIDACION", `La cuenta ya se está dividiendo en ${comanda.divisionPartes} partes`);
        }
        if (comanda.cobros.some((c) => c.parte === parte)) throw new AppError("ESTADO_INVALIDO", `La parte ${parte} ya fue cobrada`);
        if (pendientes.length === 0) throw new AppError("VALIDACION", "No hay ítems por cobrar");
        if (comanda.divisionPartes === null) await this.repo.actualizar(tx, comanda.id, { divisionPartes: partes });
        lineas = lineasParaParte(pendientes.map(aCobrable), parte, partes);
        if (lineas.length === 0) throw new AppError("VALIDACION", "Esta parte no tiene consumo asociado");
      }

      const nota = `Comanda ${comanda.numero} - ${comanda.mesa.nombre}`;
      const venta = await this.ventas.crearEnTx(
        tx,
        {
          puntoEmisionId: datos.puntoEmisionId,
          clienteId: datos.clienteId ?? null,
          clienteRuc: datos.clienteRuc ?? null,
          clienteNombre: datos.clienteNombre ?? null,
          lineas,
          pagos: datos.pagos,
          propina: datos.propina,
          observaciones: datos.observaciones != null && datos.observaciones !== "" ? `${nota}. ${datos.observaciones}` : nota,
        },
        actor,
        { desdeComanda: true }
      );
      await this.repo.crearCobro(tx, { comandaId: comanda.id, ventaId: venta.id, modo: datos.modo, parte });

      if (datos.modo === "ITEMS") {
        await this.repo.marcarCobrados(tx, itemsACobrar.map((i) => i.id), venta.id);
      } else if (comanda.cobros.length + 1 === (datos.partes as number)) {
        // Última parte: toda la cuenta queda cobrada
        await this.repo.marcarCobrados(tx, pendientes.map((i) => i.id), null);
      }

      const actualizada = await this.cargar(tx, comanda.id, actor);
      const cerrada = cobrables(actualizada).length === 0;
      if (cerrada) {
        await this.repo.actualizar(tx, comanda.id, { estado: "CERRADA", fechaCierre: new Date() });
        await this.repo.actualizarEstadoMesa(tx, comanda.mesaId, "LIBRE");
      }
      return { venta, comanda: conResumen(await this.cargar(tx, comanda.id, actor)), cerrada };
    }, TX_OPCIONES);
  }

  /** Anula una cuenta sin cobros: cancela todos sus ítems y libera la mesa. Solo supervisor. */
  async anular(comandaId: string, entrada: unknown, actor: ActorCaja): Promise<ComandaConResumen> {
    const { motivo } = parsear(AnularComandaSchema, entrada);
    if (!actor.permisos.includes(PERMISO_CANCELAR_ENVIADO)) {
      throw new AppError("SIN_PERMISO", "Anular una cuenta requiere autorización de un supervisor");
    }
    await this.giro.exigir(this.prisma, actor.empresaId, "moduloMesas");

    return this.prisma.$transaction(async (tx) => {
      const comanda = await this.cargarAbierta(tx, comandaId, actor);
      if (comanda.cobros.length > 0) {
        throw new AppError("ESTADO_INVALIDO", "La cuenta tiene cobros: anule primero las ventas correspondientes");
      }
      await this.repo.cancelarTodos(tx, comanda.id, `Cuenta anulada: ${motivo}`);
      await this.repo.actualizar(tx, comanda.id, { estado: "ANULADA", motivoAnulacion: motivo, fechaCierre: new Date() });
      await this.repo.actualizarEstadoMesa(tx, comanda.mesaId, "LIBRE");
      return conResumen(await this.cargar(tx, comanda.id, actor));
    }, TX_OPCIONES);
  }

  // ── Internos ───────────────────────────────────────────────

  private async cargar(db: Db, id: string, actor: ActorCaja): Promise<ComandaDetalle> {
    const comanda = await this.repo.buscarPorId(db, id, actor.empresaId);
    if (comanda === null) throw new AppError("NO_ENCONTRADO", "Cuenta no encontrada");
    return comanda;
  }

  private async cargarAbierta(db: Db, id: string, actor: ActorCaja): Promise<ComandaDetalle> {
    const comanda = await this.cargar(db, id, actor);
    if (comanda.estado !== "ABIERTA") throw new AppError("ESTADO_INVALIDO", `La cuenta ${comanda.numero} está ${comanda.estado.toLowerCase()}`);
    return comanda;
  }

  /**
   * Cuenta abierta cuyo contenido aún puede cambiar. La división en partes iguales la congela
   * (cada parte es una fracción del total); los cobros por ítems no: se puede seguir pidiendo.
   */
  private async cargarEditable(db: Db, id: string, actor: ActorCaja): Promise<ComandaDetalle> {
    const comanda = await this.cargarAbierta(db, id, actor);
    if (comanda.divisionPartes !== null) {
      throw new AppError("ESTADO_INVALIDO", "La cuenta se está cobrando en partes iguales y no admite cambios");
    }
    return comanda;
  }

  private async ivaDe(db: Db, productoIds: string[], empresaId: string): Promise<Map<string, number>> {
    const productos = await this.repo.productosDeMenu(db, [...new Set(productoIds)]);
    const tarifas = await this.repo.tarifasIva(db, empresaId);
    return new Map(productos.map((p) => [p.id, resolverPorcentajeIva(p, tarifas)]));
  }
}

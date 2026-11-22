// ============================================================
// src/server/services/cuentaPorCobrar.service.ts — Cartera de clientes
// ============================================================
import type { Cliente, PrismaClient } from "@prisma/client";
import { AbonoSchema, FiltroCuentasPorCobrarSchema } from "../../shared/schemas/cuenta.schema";
import type { CuentaPorCobrarDetalle, CuentaPorCobrarRepository } from "../repositories/cuentaPorCobrar.repository";
import type { Db } from "../repositories/kardex.repository";
import type { ResultadoPaginado } from "../repositories/producto.repository";
import type { TurnoRepository } from "../repositories/turno.repository";
import { AppError } from "./appError.util";
import { estadoPorSaldo, sumarDias } from "./cuadreCaja.util";
import type { ActorCaja } from "./turno.service";
import { omitUndefined } from "./object.util";
import { parsear } from "./validation.util";
import { round2 } from "./ventaCalculo.util";

export interface GenerarCxC {
  ventaId: string;
  cliente: Pick<Cliente, "id" | "razonSocial" | "limiteCredito" | "diasCredito">;
  monto: number;
  fecha: Date;
}

export class CuentaPorCobrarService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly repo: CuentaPorCobrarRepository,
    private readonly turnos: TurnoRepository
  ) {}

  /**
   * Crea la cuenta por cobrar de una venta a crédito (dentro de la transacción de la venta).
   * Valida el límite: `limiteCredito` 0 = cliente sin crédito autorizado.
   */
  async generarPorVenta(db: Db, g: GenerarCxC): Promise<CuentaPorCobrarDetalle> {
    const limite = g.cliente.limiteCredito;
    if (limite <= 0) {
      throw new AppError("LIMITE_CREDITO_EXCEDIDO", `El cliente "${g.cliente.razonSocial}" no tiene crédito autorizado`);
    }
    const pendiente = await this.repo.saldoPendienteCliente(db, g.cliente.id);
    if (round2(pendiente + g.monto) > limite) {
      throw new AppError(
        "LIMITE_CREDITO_EXCEDIDO",
        `Límite de crédito excedido: límite ${limite.toFixed(2)}, saldo pendiente ${pendiente.toFixed(2)}, esta venta ${g.monto.toFixed(2)}`
      );
    }
    return this.repo.crear(db, {
      ventaId: g.ventaId,
      clienteId: g.cliente.id,
      montoTotal: round2(g.monto),
      fechaEmision: g.fecha,
      fechaVencimiento: sumarDias(g.fecha, g.cliente.diasCredito),
    });
  }

  /** Al anular una venta: anula su cuenta; si ya tiene abonos no puede anularse sin revertirlos. */
  async anularPorVenta(db: Db, ventaId: string): Promise<void> {
    const cuenta = await this.repo.porVenta(db, ventaId);
    if (cuenta === null) return;
    if (cuenta.pagos.length > 0) {
      throw new AppError("ESTADO_INVALIDO", "La venta a crédito tiene abonos registrados y no puede anularse");
    }
    await this.repo.anular(db, cuenta.id);
  }

  async registrarAbono(cuentaId: string, entrada: unknown, actor: ActorCaja): Promise<CuentaPorCobrarDetalle> {
    const datos = parsear(AbonoSchema, entrada);
    const monto = round2(datos.monto);

    return this.prisma.$transaction(async (tx) => {
      const cuenta = await this.repo.buscarPorId(tx, cuentaId, actor.empresaId);
      if (cuenta === null) throw new AppError("NO_ENCONTRADO", "Cuenta por cobrar no encontrada");
      if (cuenta.estado !== "PENDIENTE" && cuenta.estado !== "PARCIAL") {
        throw new AppError("ESTADO_INVALIDO", `La cuenta está ${cuenta.estado.toLowerCase()} y no admite abonos`);
      }
      if (monto > cuenta.saldo) {
        throw new AppError("VALIDACION", `El abono (${monto.toFixed(2)}) supera el saldo pendiente (${cuenta.saldo.toFixed(2)})`);
      }

      // El efectivo cobrado debe ingresar a la caja del cajero que lo recibe
      let turnoId: string | null = null;
      if (datos.formaPago === "EFECTIVO") {
        const turno = await this.turnos.turnoAbierto(tx, actor.id, cuenta.venta.sucursalId);
        if (turno === null) throw new AppError("TURNO_REQUERIDO", "Debe tener un turno de caja abierto para cobrar en efectivo");
        turnoId = turno.id;
        await this.turnos.crearMovimiento(tx, {
          turnoId,
          tipo: "INGRESO",
          concepto: `Abono factura ${cuenta.venta.numero} - ${cuenta.cliente.razonSocial}`,
          monto,
          referencia: cuenta.id,
          categoria: "ABONO_CXC",
          usuarioId: actor.id,
        });
      }

      const saldo = round2(cuenta.saldo - monto);
      const filas = await this.repo.actualizarSaldoSiNoCambio(tx, cuenta.id, cuenta.saldo, { saldo, estado: estadoPorSaldo(saldo) });
      if (filas === 0) throw new AppError("ESTADO_INVALIDO", "La cuenta fue modificada simultáneamente; reintente");

      await this.repo.crearPago(tx, {
        cuentaId: cuenta.id,
        monto,
        formaPago: datos.formaPago,
        referencia: datos.referencia ?? null,
        usuarioId: actor.id,
        turnoId,
      });
      return (await this.repo.buscarPorId(tx, cuenta.id, actor.empresaId)) as CuentaPorCobrarDetalle;
    });
  }

  async obtener(id: string, actor: ActorCaja): Promise<CuentaPorCobrarDetalle> {
    const cuenta = await this.repo.buscarPorId(this.prisma, id, actor.empresaId);
    if (cuenta === null) throw new AppError("NO_ENCONTRADO", "Cuenta por cobrar no encontrada");
    return cuenta;
  }

  async listar(entrada: unknown, actor: ActorCaja): Promise<ResultadoPaginado<CuentaPorCobrarDetalle>> {
    const f = parsear(FiltroCuentasPorCobrarSchema, entrada ?? {});
    return this.repo.listar(this.prisma, {
      empresaId: actor.empresaId,
      page: f.page,
      pageSize: f.pageSize,
      ...omitUndefined({ estado: f.estado, clienteId: f.clienteId, vencidas: f.vencidas }),
    });
  }
}

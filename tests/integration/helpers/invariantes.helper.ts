// ============================================================
// tests/integration/helpers/invariantes.helper.ts
// Invariantes del núcleo POS: deben cumplirse tras CUALQUIER secuencia de operaciones.
// Devuelve la lista de violaciones (vacía = consistente) para dar mensajes claros al fallar.
// ============================================================
import type { Entorno } from "./entorno.helper";
import type { ActorCaja } from "../../../src/server/services/turno.service";

const TOL_STOCK = 1e-6;
const TOL_DINERO = 0.0051;

const cerca = (a: number, b: number, tol = TOL_DINERO): boolean => Math.abs(a - b) <= tol;
const r2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const suma = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

const ENTRADAS = new Set(["COMPRA", "AJUSTE_ENTRADA", "DEVOLUCION"]);
const SALIDAS = new Set(["VENTA", "AJUSTE_SALIDA"]);

interface FilaKardex {
  id: string;
  productoId: string;
  tipoMovimiento: string;
  cantidad: number;
  stockAnterior: number;
  stockResultante: number;
  costoPromResultante: number;
  referencia: string | null;
}

export async function verificarInvariantes(env: Entorno): Promise<string[]> {
  const e: string[] = [];
  const prisma = env.prisma;

  // ── 1) Stock = cadena de Kardex ─────────────────────────────
  const productos = await prisma.producto.findMany();
  // rowid conserva el orden real de inserción (createdAt puede empatar dentro del mismo milisegundo)
  const filas = await prisma.$queryRawUnsafe<FilaKardex[]>(
    `SELECT id, productoId, tipoMovimiento, cantidad, stockAnterior, stockResultante, costoPromResultante, referencia FROM "Kardex" ORDER BY rowid`
  );
  const porProducto = new Map<string, FilaKardex[]>();
  for (const f of filas) porProducto.set(f.productoId, [...(porProducto.get(f.productoId) ?? []), f]);

  for (const p of productos) {
    const movs = porProducto.get(p.id) ?? [];
    if (p.stockActual < -TOL_STOCK) e.push(`[stock] ${p.codigo}: stock negativo (${p.stockActual})`);
    if (!Number.isFinite(p.costoPromedio) || p.costoPromedio < 0) e.push(`[costo] ${p.codigo}: costo promedio inválido (${p.costoPromedio})`);
    if (movs.length === 0) {
      if (p.stockActual !== 0) e.push(`[stock] ${p.codigo}: tiene stock ${p.stockActual} sin movimientos de Kardex`);
      continue;
    }
    let esperado = 0;
    for (const m of movs) {
      const signo = ENTRADAS.has(m.tipoMovimiento) ? 1 : SALIDAS.has(m.tipoMovimiento) ? -1 : 0;
      if (signo === 0) e.push(`[kardex] ${p.codigo}: tipo de movimiento desconocido ${m.tipoMovimiento}`);
      if (!cerca(m.stockAnterior, esperado, TOL_STOCK)) e.push(`[kardex] ${p.codigo}: la cadena se rompe (anterior ${m.stockAnterior}, esperado ${esperado})`);
      if (!cerca(m.stockResultante, m.stockAnterior + signo * m.cantidad, TOL_STOCK)) {
        e.push(`[kardex] ${p.codigo}: resultante ${m.stockResultante} ≠ ${m.stockAnterior} ${signo > 0 ? "+" : "−"} ${m.cantidad}`);
      }
      esperado = m.stockResultante;
    }
    if (!cerca(esperado, p.stockActual, TOL_STOCK)) e.push(`[stock] ${p.codigo}: stock ${p.stockActual} ≠ último Kardex ${esperado}`);
  }

  // ── 2) Stock = suma de lotes (productos con lote) ───────────
  const lotes = await prisma.lote.findMany();
  for (const l of lotes) {
    if (l.cantidadActual < -TOL_STOCK) e.push(`[lote] ${l.numeroLote}: cantidad negativa (${l.cantidadActual})`);
    if (l.cantidadActual > l.cantidadInicial + TOL_STOCK) e.push(`[lote] ${l.numeroLote}: actual ${l.cantidadActual} > inicial ${l.cantidadInicial}`);
  }
  for (const p of productos.filter((x) => x.requiereLote)) {
    const total = suma(lotes.filter((l) => l.productoId === p.id).map((l) => l.cantidadActual));
    if (!cerca(total, p.stockActual, TOL_STOCK * 10)) e.push(`[lote] ${p.codigo}: stock ${p.stockActual} ≠ suma de lotes ${total}`);
  }

  // ── 3) Secuenciales sin huecos ──────────────────────────────
  const puntos = await prisma.puntoEmision.findMany({ include: { sucursal: true } });
  for (const pt of puntos) {
    const ventas = await prisma.venta.findMany({ where: { puntoEmisionId: pt.id }, select: { numero: true } });
    if (ventas.length !== pt.secuencialVenta) e.push(`[secuencial] punto ${pt.sucursal.codigo}-${pt.codigo}: ${ventas.length} ventas pero contador ${pt.secuencialVenta}`);
    const esperados = new Set(Array.from({ length: pt.secuencialVenta }, (_, i) => `${pt.sucursal.codigo}-${pt.codigo}-${String(i + 1).padStart(9, "0")}`));
    const reales = new Set(ventas.map((v) => v.numero));
    for (const n of esperados) if (!reales.has(n)) e.push(`[secuencial] falta el número ${n} (hueco)`);
    if (reales.size !== ventas.length) e.push(`[secuencial] punto ${pt.codigo}: números de venta duplicados`);
  }
  for (const s of await prisma.sucursal.findMany()) {
    const n = await prisma.comanda.count({ where: { sucursalId: s.id } });
    if (n !== s.secuencialComanda) e.push(`[secuencial] sucursal ${s.codigo}: ${n} comandas pero contador ${s.secuencialComanda}`);
  }

  // ── 4) Cada venta cuadra con sus líneas y pagos ─────────────
  const ventas = await prisma.venta.findMany({ include: { lineas: true, pagos: true } });
  for (const v of ventas) {
    const lbl = `venta ${v.numero} (${v.estado})`;
    if (!cerca(v.subtotal, suma(v.lineas.map((l) => l.subtotal)))) e.push(`[venta] ${lbl}: subtotal ${v.subtotal} ≠ líneas ${r2(suma(v.lineas.map((l) => l.subtotal)))}`);
    if (!cerca(v.iva, suma(v.lineas.map((l) => l.iva)))) e.push(`[venta] ${lbl}: IVA ${v.iva} ≠ líneas`);
    if (!cerca(v.descuento, suma(v.lineas.map((l) => l.descuento)))) e.push(`[venta] ${lbl}: descuento ≠ líneas`);
    if (!cerca(v.total, suma(v.lineas.map((l) => l.total)))) e.push(`[venta] ${lbl}: total ${v.total} ≠ líneas ${r2(suma(v.lineas.map((l) => l.total)))}`);
    if (!cerca(v.total, v.subtotal + v.iva)) e.push(`[venta] ${lbl}: total ≠ subtotal + IVA`);
    const neto = suma(v.pagos.map((p) => p.monto - p.cambio));
    if (!cerca(neto, v.total + v.propina)) e.push(`[venta] ${lbl}: pagos netos ${r2(neto)} ≠ total + propina ${r2(v.total + v.propina)}`);
    if (v.pagos.some((p) => p.cambio > 0 && p.formaPago !== "EFECTIVO")) e.push(`[venta] ${lbl}: cambio en un pago que no es efectivo`);
  }

  // ── 5) Kardex coherente con las ventas ──────────────────────
  const tipoProducto = new Map(productos.map((p) => [p.id, p.tipo]));
  for (const v of ventas) {
    const bienes = v.lineas.filter((l) => tipoProducto.get(l.productoId) === "BIEN");
    const esperado = new Map<string, number>();
    for (const l of bienes) esperado.set(l.productoId, (esperado.get(l.productoId) ?? 0) + l.cantidadBase);
    const movs = filas.filter((m) => m.referencia === v.id);
    for (const [productoId, cant] of esperado) {
      const salidas = suma(movs.filter((m) => m.productoId === productoId && m.tipoMovimiento === "VENTA").map((m) => m.cantidad));
      const devueltas = suma(movs.filter((m) => m.productoId === productoId && m.tipoMovimiento === "DEVOLUCION").map((m) => m.cantidad));
      if (!cerca(salidas, cant, TOL_STOCK * 10)) e.push(`[kardex] venta ${v.numero}: salidas ${salidas} ≠ líneas ${cant}`);
      const devEsperada = v.estado === "ANULADA" ? cant : 0;
      if (!cerca(devueltas, devEsperada, TOL_STOCK * 10)) e.push(`[kardex] venta ${v.numero} (${v.estado}): devoluciones ${devueltas} ≠ ${devEsperada}`);
    }
    for (const m of movs) if (!esperado.has(m.productoId)) e.push(`[kardex] venta ${v.numero}: movimiento de un producto que no está en sus líneas`);
  }

  // ── 6) Cuadre de caja ───────────────────────────────────────
  const supervisor: ActorCaja = { id: env.seed.adminId, empresaId: env.seed.empresaId, permisos: ["caja:actualizar"] };
  const turnos = await prisma.turnoCaja.findMany();
  for (const t of turnos) {
    const delTurno = ventas.filter((v) => v.turnoId === t.id && v.estado === "COMPLETADA");
    const efectivo = suma(delTurno.flatMap((v) => v.pagos.filter((p) => p.formaPago === "EFECTIVO").map((p) => p.monto - p.cambio)));
    const movs = await prisma.movimientoCaja.findMany({ where: { turnoId: t.id } });
    const ingresos = suma(movs.filter((m) => m.tipo === "INGRESO").map((m) => m.monto));
    const egresos = suma(movs.filter((m) => m.tipo === "EGRESO").map((m) => m.monto));
    const manual = r2(t.montoApertura + efectivo + ingresos - egresos);

    if (t.estado === "ABIERTO") {
      const rep = await env.servicios.turnos.reporte(t.id, supervisor);
      if (rep.efectivo === null || !cerca(rep.efectivo.esperado, manual)) e.push(`[caja] turno ${t.id.slice(0, 8)}: esperado del sistema ${rep.efectivo?.esperado} ≠ recalculado ${manual}`);
      if (manual < -TOL_DINERO) e.push(`[caja] turno ${t.id.slice(0, 8)}: efectivo negativo (${manual})`);
    } else {
      if (t.montoCierreCiego === null || t.montoCierreReal === null || t.diferencia === null) {
        e.push(`[caja] turno cerrado ${t.id.slice(0, 8)} sin datos de arqueo`);
        continue;
      }
      if (!cerca(t.diferencia, t.montoCierreCiego - t.montoCierreReal)) e.push(`[caja] turno cerrado ${t.id.slice(0, 8)}: diferencia ≠ contado − esperado`);
      // El esperado guardado solo puede compararse si ninguna venta se anuló después del cierre
      const anuladasTarde = ventas.some((v) => v.turnoId === t.id && v.estado === "ANULADA" && v.fechaAnulacion !== null && t.fechaCierre !== null && v.fechaAnulacion > t.fechaCierre);
      const movsTarde = movs.some((m) => t.fechaCierre !== null && m.createdAt > t.fechaCierre);
      if (!anuladasTarde && !movsTarde && !cerca(t.montoCierreReal, manual)) e.push(`[caja] turno cerrado ${t.id.slice(0, 8)}: esperado guardado ${t.montoCierreReal} ≠ recalculado ${manual}`);
    }
  }

  // ── 7) Cartera: saldo = total − pagos; estado coherente ─────
  for (const c of await prisma.cuentaPorCobrar.findMany({ include: { pagos: true, venta: { include: { pagos: true } } } })) {
    const pagado = suma(c.pagos.map((p) => p.monto));
    const credito = suma(c.venta.pagos.filter((p) => p.formaPago === "CREDITO").map((p) => p.monto));
    if (!cerca(c.montoTotal, credito)) e.push(`[cxc] ${c.venta.numero}: monto ${c.montoTotal} ≠ pagos a crédito ${credito}`);
    if (c.estado === "ANULADA") {
      if (c.saldo !== 0) e.push(`[cxc] ${c.venta.numero}: anulada con saldo ${c.saldo}`);
      if (c.venta.estado !== "ANULADA") e.push(`[cxc] ${c.venta.numero}: cuenta anulada pero la venta no`);
      continue;
    }
    if (c.venta.estado === "ANULADA") e.push(`[cxc] ${c.venta.numero}: venta anulada pero la cuenta sigue ${c.estado}`);
    if (!cerca(c.saldo, c.montoTotal - pagado)) e.push(`[cxc] ${c.venta.numero}: saldo ${c.saldo} ≠ ${r2(c.montoTotal - pagado)}`);
    const estado = c.saldo <= 0 ? "PAGADA" : pagado > 0 ? "PARCIAL" : "PENDIENTE";
    if (c.estado !== estado) e.push(`[cxc] ${c.venta.numero}: estado ${c.estado} ≠ ${estado}`);
    if (c.saldo < -TOL_DINERO) e.push(`[cxc] ${c.venta.numero}: saldo negativo`);
  }
  for (const c of await prisma.cuentaPorPagar.findMany({ include: { pagos: true, compra: true } })) {
    const pagado = suma(c.pagos.map((p) => p.monto));
    if (!cerca(c.montoTotal, c.compra.total)) e.push(`[cxp] ${c.compra.numeroFactura}: monto ${c.montoTotal} ≠ compra ${c.compra.total}`);
    if (!cerca(c.saldo, c.montoTotal - pagado)) e.push(`[cxp] ${c.compra.numeroFactura}: saldo ${c.saldo} ≠ ${r2(c.montoTotal - pagado)}`);
    const estado = c.saldo <= 0 ? "PAGADA" : pagado > 0 ? "PARCIAL" : "PENDIENTE";
    if (c.estado !== estado) e.push(`[cxp] ${c.compra.numeroFactura}: estado ${c.estado} ≠ ${estado}`);
  }

  // ── 8) Mesas y cuentas ──────────────────────────────────────
  const abiertasPorMesa = new Map<string, number>();
  const comandas = await prisma.comanda.findMany({ include: { items: true, cobros: true } });
  for (const c of comandas) {
    if (c.estado === "ABIERTA") abiertasPorMesa.set(c.mesaId, (abiertasPorMesa.get(c.mesaId) ?? 0) + 1);
    const vigentes = c.items.filter((i) => i.estado !== "CANCELADO");
    if (c.estado === "CERRADA" && vigentes.some((i) => !i.cobrado)) e.push(`[comanda] #${c.numero} cerrada con ítems sin cobrar`);
    if (c.estado === "ANULADA" && vigentes.length > 0) e.push(`[comanda] #${c.numero} anulada con ítems vigentes`);
    if (c.items.some((i) => i.cobrado) && c.cobros.length === 0 && c.estado !== "UNIDA") e.push(`[comanda] #${c.numero}: ítems cobrados sin registro de cobro`);
    for (const i of c.items) if (i.cobrado && i.estado === "CANCELADO") e.push(`[comanda] #${c.numero}: ítem cancelado marcado como cobrado`);
  }
  for (const [mesaId, n] of abiertasPorMesa) if (n > 1) e.push(`[mesa] ${mesaId}: ${n} cuentas abiertas a la vez`);
  for (const m of await prisma.mesa.findMany()) {
    const tieneCuenta = (abiertasPorMesa.get(m.id) ?? 0) > 0;
    if (tieneCuenta && m.estado !== "OCUPADA") e.push(`[mesa] ${m.nombre}: tiene cuenta abierta pero está ${m.estado}`);
    if (!tieneCuenta && m.estado === "OCUPADA") e.push(`[mesa] ${m.nombre}: figura OCUPADA sin cuenta abierta`);
  }

  return e;
}

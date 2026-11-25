// ============================================================
// tests/performance/generador.ts — Generador REPRODUCIBLE (semilla fija) de una base de datos grande para las pruebas de rendimiento
//
// Crea, sobre una instalación ya sembrada (runSeed): categorías, productos (con presentaciones y lotes en parte de ellos), clientes,
// 8 cajeros con su punto de emisión, y un historial de ventas día a día — cada venta con sus líneas, pago, movimiento de Kardex y factura
// electrónica (AUTORIZADA, salvo un 2 % pendiente en el último día con su fila en la cola del SRI) —, parte a crédito con su cuenta por cobrar.
// Inserta por lotes con createMany (sin pasar por los servicios): lo que se mide es la lectura/escritura con la base grande, no la generación.
// ============================================================
import { randomUUID } from "crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/server/services/password.util";

export interface ParametrosBase {
  productos: number;
  clientes: number;
  dias: number;
  ventasPorDia: number;
  /** Ventas adicionales (en el último día) que quedan en un turno ABIERTO, para medir el cierre de un turno con miles de ventas */
  ventasTurnoAbierto: number;
  semilla: number;
}

export const PARAMETROS_COMPLETOS: ParametrosBase = { productos: 20_000, clientes: 5_000, dias: 90, ventasPorDia: 1_500, ventasTurnoAbierto: 3_000, semilla: 20261125 };

export const PASSWORD_CAJEROS = "Clave12345";
export const NUM_CAJEROS = 8;

export interface ResumenBase {
  productos: number;
  clientes: number;
  ventas: number;
  lineas: number;
  kardex: number;
  comprobantes: number;
  cajeros: string[];
  puntosEmision: string[];
  /** Cajero cuyo turno quedó abierto con `ventasTurnoAbierto` ventas */
  cajeroTurnoAbierto: string;
  segundos: number;
}

/** Generador pseudoaleatorio determinista (mulberry32). */
export function crearAzar(semilla: number): { siguiente: () => number; entero: (min: number, max: number) => number; elegir: <T>(l: readonly T[]) => T } {
  let a = semilla >>> 0;
  const siguiente = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { siguiente, entero: (min, max) => min + Math.floor(siguiente() * (max - min + 1)), elegir: (l) => l[Math.floor(siguiente() * l.length)] as never };
}

const PRODUCTOS_BASE = ["Arroz", "Aceite", "Leche", "Azúcar", "Harina", "Fideos", "Atún", "Sal", "Café", "Té", "Galletas", "Jabón", "Detergente", "Shampoo", "Papel higiénico", "Pan", "Queso", "Jamón", "Huevos", "Pollo", "Carne", "Pescado", "Gaseosa", "Jugo", "Agua", "Cerveza", "Yogurt", "Mantequilla", "Mermelada", "Cereal", "Lentejas", "Frejol", "Maíz", "Tomate", "Cebolla", "Papa", "Zanahoria", "Manzana", "Banano", "Naranja"];
const MARCAS = ["Don Pepe", "La Favorita", "Nestlé", "Ales", "Pronaca", "Gloria", "Toni", "Pilsener", "Supermaxi", "Del Valle", "Real", "Facundo", "Sumesa", "Oriental", "Inca"];
const PRESENTACIONES = ["250g", "500g", "1kg", "2kg", "1L", "2L", "750ml", "Pack x6", "Unidad", "Familiar"];
const NOMBRES = ["María", "José", "Luis", "Ana", "Carlos", "Rosa", "Jorge", "Elena", "Pedro", "Lucía", "Miguel", "Carmen", "Juan", "Sofía"];
const APELLIDOS = ["Pérez", "Gómez", "Torres", "Vera", "Mora", "Cedeño", "Zambrano", "Álvarez", "Andrade", "Salazar", "Quishpe", "Villacís", "Ramírez", "Castro"];

async function insertar<T>(filas: T[], tamano: number, escribir: (lote: T[]) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < filas.length; i += tamano) await escribir(filas.slice(i, i + tamano));
}

const digitos = (n: number, azar: () => number): string => Array.from({ length: n }, () => Math.floor(azar() * 10)).join("");
const redondear = (n: number): number => Math.round(n * 100) / 100;

export async function generarBase(prisma: PrismaClient, p: ParametrosBase, registrar: (m: string) => void = () => undefined): Promise<ResumenBase> {
  const inicio = Date.now();
  const azar = crearAzar(p.semilla);
  const empresa = await prisma.empresa.findFirstOrThrow();
  const sucursal = await prisma.sucursal.findFirstOrThrow({ where: { empresaId: empresa.id } });
  const consumidor = await prisma.cliente.findFirstOrThrow({ where: { identificacion: "9999999999999" } });
  const unidad = await prisma.unidadMedida.findUniqueOrThrow({ where: { codigo: "UN" } });
  const rolCajero = await prisma.rol.findUniqueOrThrow({ where: { nombre: "CAJERO" } });
  await prisma.$queryRawUnsafe("PRAGMA synchronous=OFF");

  // ── Categorías y productos ──
  const categorias = Array.from({ length: 40 }, (_, i) => ({ id: randomUUID(), nombre: `Categoría ${i + 1}`, descripcion: "" }));
  await prisma.categoria.createMany({ data: categorias });

  const productos: Prisma.ProductoCreateManyInput[] = [];
  for (let i = 0; i < p.productos; i++) {
    const costo = redondear(0.2 + azar.siguiente() * 40);
    const iva = azar.siguiente() < 0.7;
    productos.push({
      id: randomUUID(),
      codigo: `P${String(i + 1).padStart(6, "0")}`,
      codigoBarras: `786${String(i + 1).padStart(10, "0")}`,
      nombre: `${azar.elegir(PRODUCTOS_BASE)} ${azar.elegir(MARCAS)} ${azar.elegir(PRESENTACIONES)} ${i + 1}`,
      tipo: "BIEN",
      categoriaId: (categorias[i % categorias.length] as { id: string }).id,
      unidadMedidaId: unidad.id,
      precioCompra: costo,
      precioVenta: redondear(costo * (1.15 + azar.siguiente() * 0.5)),
      margen: 30,
      stockMinimo: 10,
      stockActual: 50_000,
      costoPromedio: costo,
      aplicaIva: iva,
      codigoIvaSRI: iva ? "4" : "0",
      requiereLote: i % 33 === 0, // ≈ 3 %: productos con lote (farmacia)
      tieneVencimiento: i % 33 === 0,
    });
  }
  await insertar(productos, 800, (data) => prisma.producto.createMany({ data }));
  registrar(`productos: ${productos.length}`);

  await insertar(
    productos.filter((_, i) => i % 20 === 0).map((x) => ({ id: randomUUID(), productoId: x.id as string, nombre: "Caja x12", factor: 12, codigoBarras: `787${(x.codigoBarras as string).slice(3)}` })),
    800,
    (data) => prisma.presentacionProducto.createMany({ data })
  );
  const conLote = productos.filter((x) => x.requiereLote === true);
  await insertar(
    conLote.flatMap((x) => [1, 2].map((n) => ({ id: randomUUID(), productoId: x.id as string, numeroLote: `L${n}-${(x.codigo as string).slice(1)}`, fechaVencimiento: new Date(Date.now() + (30 + n * 120) * 86_400_000), cantidadInicial: 25_000, cantidadActual: 25_000 }))),
    800,
    (data) => prisma.lote.createMany({ data })
  );

  // ── Clientes ──
  const clientes: Prisma.ClienteCreateManyInput[] = Array.from({ length: p.clientes }, (_, i) => ({
    id: randomUUID(),
    tipoIdentificacion: "05",
    identificacion: `17${String(1_000_000 + i).padStart(8, "0")}`,
    razonSocial: `${azar.elegir(NOMBRES)} ${azar.elegir(APELLIDOS)} ${azar.elegir(APELLIDOS)} ${i + 1}`,
    email: `cliente${i + 1}@ejemplo.ec`,
    telefono: `09${digitos(8, azar.siguiente)}`,
    limiteCredito: 500,
    diasCredito: 30,
  }));
  await insertar(clientes, 800, (data) => prisma.cliente.createMany({ data }));
  registrar(`clientes: ${clientes.length}`);

  // ── Cajeros y puntos de emisión (uno por cajero) ──
  const hash = await hashPassword(PASSWORD_CAJEROS);
  const cajeros = Array.from({ length: NUM_CAJEROS }, (_, i) => ({ id: randomUUID(), username: `cajero${i + 1}` }));
  await prisma.usuario.createMany({ data: cajeros.map((c) => ({ id: c.id, empresaId: empresa.id, rolId: rolCajero.id, username: c.username, passwordHash: hash, nombre: c.username, apellido: "Rendimiento" })) });
  const puntoSeed = await prisma.puntoEmision.findFirstOrThrow({ where: { sucursalId: sucursal.id } });
  const puntos = [puntoSeed, ...(await Promise.all(Array.from({ length: NUM_CAJEROS - 1 }, (_, i) => prisma.puntoEmision.create({ data: { sucursalId: sucursal.id, codigo: String(i + 2).padStart(3, "0"), descripcion: `Caja ${i + 2}` } }))))];

  // ── Historial de ventas ──
  const populares = productos.slice(0, Math.max(50, Math.floor(p.productos * 0.2))); // el 20 % concentra las ventas
  const contador = new Array<number>(NUM_CAJEROS).fill(0);
  let totalVentas = 0, totalLineas = 0, totalKardex = 0, totalComprobantes = 0;
  const hoy = new Date();
  const cajeroAbierto = NUM_CAJEROS - 1;

  for (let d = p.dias - 1; d >= 0; d--) {
    const ultimoDia = d === 0;
    const base = Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate() - d, 13, 0, 0); // 08:00 en Ecuador (UTC-5)
    const turnos = cajeros.map((c, i) => ({
      id: randomUUID(), sucursalId: sucursal.id, cajeroId: c.id, fechaApertura: new Date(base), montoApertura: 100,
      ...(ultimoDia && i === cajeroAbierto ? { estado: "ABIERTO" } : { estado: "CERRADO", fechaCierre: new Date(base + 12 * 3_600_000), montoCierreCiego: 0, montoCierreReal: 0, diferencia: 0 }),
    }));
    await prisma.turnoCaja.createMany({ data: turnos });

    const ventas: Prisma.VentaCreateManyInput[] = [];
    const lineas: Prisma.LineaVentaCreateManyInput[] = [];
    const pagos: Prisma.PagoVentaCreateManyInput[] = [];
    const kardex: Prisma.KardexCreateManyInput[] = [];
    const comprobantes: Prisma.ComprobanteElectronicoCreateManyInput[] = [];
    const cola: Prisma.ColaSRICreateManyInput[] = [];
    const cuentas: Prisma.CuentaPorCobrarCreateManyInput[] = [];

    const cantidad = p.ventasPorDia + (ultimoDia ? p.ventasTurnoAbierto : 0);
    for (let v = 0; v < cantidad; v++) {
      // Las ventas extra del último día van todas al cajero del turno abierto
      const iCajero = ultimoDia && v >= p.ventasPorDia ? cajeroAbierto : v % NUM_CAJEROS;
      contador[iCajero] = (contador[iCajero] as number) + 1;
      const secuencial = contador[iCajero] as number;
      const punto = puntos[iCajero] as (typeof puntos)[number];
      const fecha = new Date(base + Math.floor(azar.siguiente() * 12 * 3_600_000));
      const ventaId = randomUUID();
      const numero = `001-${punto.codigo}-${String(secuencial).padStart(9, "0")}`;

      let subtotal = 0, ivaTotal = 0;
      const n = azar.entero(1, 6);
      for (let l = 0; l < n; l++) {
        const prod = (azar.siguiente() < 0.8 ? azar.elegir(populares) : azar.elegir(productos)) as Prisma.ProductoCreateManyInput;
        const cant = azar.entero(1, 3);
        const precio = prod.precioVenta as number;
        const sub = redondear(cant * precio);
        const iva = prod.aplicaIva === false ? 0 : redondear(sub * 0.15);
        subtotal += sub;
        ivaTotal += iva;
        lineas.push({
          id: randomUUID(), ventaId, productoId: prod.id as string, descripcion: prod.nombre as string, cantidad: cant, precioUnitario: precio, subtotal: sub, iva,
          porcentajeIva: prod.aplicaIva === false ? 0 : 15, total: redondear(sub + iva), costoUnitario: prod.costoPromedio as number, codigoIvaSRI: prod.codigoIvaSRI as string, cantidadBase: cant,
        });
        kardex.push({
          id: randomUUID(), productoId: prod.id as string, fecha, tipoMovimiento: "VENTA", cantidad: -cant, costoUnitario: prod.costoPromedio as number, costoTotal: redondear(cant * (prod.costoPromedio as number)),
          stockAnterior: 50_000, stockResultante: 50_000 - cant, costoPromAnterior: prod.costoPromedio as number, costoPromResultante: prod.costoPromedio as number, referencia: ventaId,
        });
      }
      subtotal = redondear(subtotal);
      ivaTotal = redondear(ivaTotal);
      const total = redondear(subtotal + ivaTotal);
      const credito = azar.siguiente() < 0.03;
      const cliente = credito || azar.siguiente() < 0.3 ? (azar.elegir(clientes) as Prisma.ClienteCreateManyInput) : null;
      ventas.push({
        id: ventaId, numero, sucursalId: sucursal.id, puntoEmisionId: punto.id, turnoId: (turnos[iCajero] as { id: string }).id, cajeroId: (cajeros[iCajero] as { id: string }).id,
        clienteId: cliente?.id ?? consumidor.id, clienteRuc: cliente?.identificacion ?? "9999999999999", clienteNombre: cliente?.razonSocial ?? "CONSUMIDOR FINAL",
        subtotal, iva: ivaTotal, total, createdAt: fecha, updatedAt: fecha,
      });
      pagos.push({ id: randomUUID(), ventaId, formaPago: credito ? "CREDITO" : azar.siguiente() < 0.6 ? "EFECTIVO" : "TARJETA_CREDITO", monto: total, createdAt: fecha });
      if (credito && cliente !== null) {
        cuentas.push({ id: randomUUID(), ventaId, clienteId: cliente.id as string, montoTotal: total, saldo: total, fechaEmision: fecha, fechaVencimiento: new Date(fecha.getTime() + 30 * 86_400_000) });
      }
      const comprobanteId = randomUUID();
      const pendiente = ultimoDia && azar.siguiente() < 0.02;
      comprobantes.push({
        id: comprobanteId, ventaId, empresaId: empresa.id, sucursalId: sucursal.id, puntoEmisionId: punto.id, claveAcceso: digitos(49, azar.siguiente), tipoComprobante: "01", ambiente: "1",
        serie: `001-${punto.codigo}`, secuencial: String(secuencial).padStart(9, "0"), fechaEmision: fecha, estado: pendiente ? "PENDIENTE" : "AUTORIZADO",
        ...(pendiente ? {} : { numeroAutorizacion: digitos(49, azar.siguiente), fechaAutorizacion: fecha }), createdAt: fecha, updatedAt: fecha,
      });
      if (pendiente) cola.push({ id: randomUUID(), comprobanteId });
    }

    await prisma.$transaction([
      prisma.venta.createMany({ data: ventas }),
      ...chunks(lineas, 1500).map((data) => prisma.lineaVenta.createMany({ data })),
      prisma.pagoVenta.createMany({ data: pagos }),
      ...chunks(kardex, 1000).map((data) => prisma.kardex.createMany({ data })),
      ...chunks(comprobantes, 800).map((data) => prisma.comprobanteElectronico.createMany({ data })),
      ...(cola.length > 0 ? [prisma.colaSRI.createMany({ data: cola })] : []),
      ...(cuentas.length > 0 ? [prisma.cuentaPorCobrar.createMany({ data: cuentas })] : []),
    ]);
    totalVentas += ventas.length;
    totalLineas += lineas.length;
    totalKardex += kardex.length;
    totalComprobantes += comprobantes.length;
    if (d % 10 === 0) registrar(`día -${d}: ${totalVentas} ventas acumuladas`);
  }

  // Los contadores quedan donde terminó el historial, como si se hubiera vendido de verdad
  for (let i = 0; i < NUM_CAJEROS; i++) {
    const punto = puntos[i] as (typeof puntos)[number];
    await prisma.puntoEmision.update({ where: { id: punto.id }, data: { secuencialVenta: contador[i] as number } });
    await prisma.secuencialComprobante.upsert({ where: { puntoEmisionId_tipoComprobante: { puntoEmisionId: punto.id, tipoComprobante: "01" } }, create: { puntoEmisionId: punto.id, tipoComprobante: "01", ultimo: contador[i] as number }, update: { ultimo: contador[i] as number } });
  }
  await prisma.$queryRawUnsafe("PRAGMA synchronous=NORMAL");
  await prisma.$queryRawUnsafe("ANALYZE");

  return {
    productos: p.productos, clientes: p.clientes, ventas: totalVentas, lineas: totalLineas, kardex: totalKardex, comprobantes: totalComprobantes,
    cajeros: cajeros.map((c) => c.username), puntosEmision: puntos.map((x) => x.id), cajeroTurnoAbierto: (cajeros[cajeroAbierto] as { username: string }).username, segundos: Math.round((Date.now() - inicio) / 1000),
  };
}

function chunks<T>(l: T[], n: number): T[][] {
  const r: T[][] = [];
  for (let i = 0; i < l.length; i += n) r.push(l.slice(i, i + n));
  return r;
}

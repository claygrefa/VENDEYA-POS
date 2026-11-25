// ============================================================
// src/server/services/setup/instalacion.util.ts — Datos base de una instalación (roles, permisos, catálogos, empresa)
//
// Lo comparten el asistente de configuración inicial (SetupService) y el seed de desarrollo: una instalación nueva queda
// con exactamente lo mismo, sea creada por el asistente o por `npm run prisma:seed`. Todo es idempotente (upserts).
// ============================================================
import { TARIFAS_IVA, CONSUMIDOR_FINAL } from "../../../shared/constants/sri.constants";
import { FEATURE_FLAGS_POR_GIRO, type GiroNegocio } from "../../../shared/types/feature-flags.types";
import type { Db } from "../../repositories/kardex.repository";
import { hashPassword } from "../password.util";

export const ROLES_BASE = ["ADMIN", "SUPERVISOR", "CAJERO", "BODEGUERO", "CONTADOR", "MESERO", "COCINA"] as const;
type RolBase = (typeof ROLES_BASE)[number];

const MODULOS = [
  "ventas", "caja", "inventario", "clientes", "proveedores",
  "reportes", "sri", "configuracion", "usuarios", "restaurante",
] as const;
const ACCIONES = ["crear", "leer", "actualizar", "eliminar", "anular", "exportar"] as const;

/** Predicado sobre la clave "modulo:accion" que define los permisos de cada rol. */
const PERMISOS_POR_ROL: Record<RolBase, (clave: string) => boolean> = {
  ADMIN: () => true,
  SUPERVISOR: (p) =>
    !p.startsWith("usuarios:") && !p.startsWith("configuracion:") && !p.endsWith(":eliminar"),
  CAJERO: (p) =>
    [
      "ventas:crear", "ventas:leer", "caja:crear", "caja:leer", "clientes:crear", "clientes:leer", "inventario:leer",
      "restaurante:leer", "restaurante:crear", "restaurante:actualizar",
    ].includes(p),
  BODEGUERO: (p) =>
    p.startsWith("inventario:") || (p.startsWith("proveedores:") && !p.endsWith(":eliminar")),
  CONTADOR: (p) =>
    p.startsWith("reportes:") || ["sri:leer", "sri:exportar", "ventas:leer", "ventas:exportar"].includes(p),
  // Mesero: toma pedidos, los envía y entrega; ve el menú y los clientes. No cobra ni anula.
  MESERO: (p) =>
    ["restaurante:leer", "restaurante:crear", "restaurante:actualizar", "inventario:leer", "clientes:leer"].includes(p),
  // Cocina/barra: ve los pedidos pendientes y los marca como listos.
  COCINA: (p) => ["restaurante:leer", "restaurante:actualizar"].includes(p),
};

const DESCRIPCION_ROL: Record<RolBase, string> = {
  ADMIN: "Administrador con acceso total",
  SUPERVISOR: "Supervisor: anulaciones, arqueos y reportes",
  CAJERO: "Cajero: ventas y operación de caja",
  BODEGUERO: "Bodeguero: inventario y proveedores",
  CONTADOR: "Contador: reportes y comprobantes SRI",
  MESERO: "Mesero: toma pedidos y atiende mesas",
  COCINA: "Cocina/barra: prepara y marca pedidos como listos",
};

const UNIDADES = [
  { codigo: "UN", nombre: "Unidad", permiteDecimales: false },
  { codigo: "KG", nombre: "Kilogramo", permiteDecimales: true },
  { codigo: "LB", nombre: "Libra", permiteDecimales: true },
  { codigo: "L", nombre: "Litro", permiteDecimales: true },
  { codigo: "M", nombre: "Metro", permiteDecimales: true },
  { codigo: "PAQ", nombre: "Paquete", permiteDecimales: false },
  { codigo: "CJ", nombre: "Caja", permiteDecimales: false },
  { codigo: "SRV", nombre: "Servicio", permiteDecimales: false },
] as const;


/** Permisos, roles, unidades de medida y categoría por defecto. Devuelve el id de cada rol. */
export async function sembrarBase(db: Db): Promise<Map<string, string>> {
  const claves: string[] = [];
  const permisoIds = new Map<string, string>();
  for (const modulo of MODULOS) {
    for (const accion of ACCIONES) {
      const p = await db.permiso.upsert({
        where: { modulo_accion_recurso: { modulo, accion, recurso: "*" } },
        update: {},
        create: { modulo, accion, recurso: "*" },
      });
      claves.push(`${modulo}:${accion}`);
      permisoIds.set(`${modulo}:${accion}`, p.id);
    }
  }

  const rolIds = new Map<string, string>();
  for (const nombre of ROLES_BASE) {
    const rol = await db.rol.upsert({
      where: { nombre },
      update: { descripcion: DESCRIPCION_ROL[nombre] },
      create: { nombre, descripcion: DESCRIPCION_ROL[nombre] },
    });
    rolIds.set(nombre, rol.id);
    for (const clave of claves.filter(PERMISOS_POR_ROL[nombre])) {
      const permisoId = permisoIds.get(clave) as string;
      await db.rolPermiso.upsert({
        where: { rolId_permisoId: { rolId: rol.id, permisoId } },
        update: {},
        create: { rolId: rol.id, permisoId },
      });
    }
  }

  for (const u of UNIDADES) {
    await db.unidadMedida.upsert({ where: { codigo: u.codigo }, update: { permiteDecimales: u.permiteDecimales }, create: u });
  }
  if ((await db.categoria.findFirst({ where: { nombre: "General" } })) === null) {
    await db.categoria.create({ data: { nombre: "General", descripcion: "Categoría por defecto" } });
  }
  return rolIds;
}

export interface DatosInstalacion {
  empresa: {
    ruc: string;
    razonSocial: string;
    nombreComercial: string;
    direccionMatriz: string;
    telefono: string;
    email: string;
    tipoContribuyente: string;
    regimenTributario: string;
    obligadoContabilidad?: boolean;
    agenteRetencion?: boolean;
    resolucionAgente?: string | null | undefined;
    contribuyenteEspecial?: string | null | undefined;
    ambienteSRI: string;
  };
  sucursal: { nombre: string; direccion: string; telefono: string };
  giro: GiroNegocio;
  admin: { username: string; password: string; nombre: string; apellido: string };
}

export interface ResultadoInstalacion {
  empresaId: string;
  sucursalId: string;
  puntoEmisionId: string;
  adminId: string;
  clienteConsumidorFinalId: string;
}

/** Empresa, sucursal 001, punto de emisión 001, tarifas de IVA, administrador, Consumidor Final y módulos del giro. */
export async function crearInstalacion(db: Db, rolIds: Map<string, string>, d: DatosInstalacion): Promise<ResultadoInstalacion> {
  const e = d.empresa;
  const empresa = await db.empresa.upsert({
    where: { ruc: e.ruc },
    update: {},
    create: {
      ruc: e.ruc,
      razonSocial: e.razonSocial,
      nombreComercial: e.nombreComercial,
      direccionMatriz: e.direccionMatriz,
      telefono: e.telefono,
      email: e.email,
      tipoContribuyente: e.tipoContribuyente,
      regimenTributario: e.regimenTributario,
      ambienteSRI: e.ambienteSRI,
      ...(e.obligadoContabilidad !== undefined ? { obligadoContabilidad: e.obligadoContabilidad } : {}),
      ...(e.agenteRetencion !== undefined ? { agenteRetencion: e.agenteRetencion } : {}),
      ...(e.resolucionAgente != null ? { resolucionAgente: e.resolucionAgente } : {}),
      ...(e.contribuyenteEspecial != null ? { contribuyenteEspecial: e.contribuyenteEspecial } : {}),
    },
  });
  const sucursal = await db.sucursal.upsert({
    where: { empresaId_codigo: { empresaId: empresa.id, codigo: "001" } },
    update: {},
    create: { empresaId: empresa.id, codigo: "001", nombre: d.sucursal.nombre, direccion: d.sucursal.direccion, telefono: d.sucursal.telefono },
  });
  const punto = await db.puntoEmision.upsert({
    where: { sucursalId_codigo: { sucursalId: sucursal.id, codigo: "001" } },
    update: {},
    create: { sucursalId: sucursal.id, codigo: "001", descripcion: "Caja principal" },
  });

  for (const t of TARIFAS_IVA) {
    await db.tarifaImpuesto.upsert({
      where: { empresaId_tipoImpuesto_codigo: { empresaId: empresa.id, tipoImpuesto: "IVA", codigo: t.codigo } },
      update: { porcentaje: t.porcentaje, descripcion: t.descripcion, vigente: t.vigente },
      create: { empresaId: empresa.id, tipoImpuesto: "IVA", codigo: t.codigo, porcentaje: t.porcentaje, descripcion: t.descripcion, vigente: t.vigente },
    });
  }

  const adminExistente = await db.usuario.findUnique({ where: { username: d.admin.username } });
  const adminId =
    adminExistente !== null
      ? adminExistente.id
      : (
          await db.usuario.create({
            data: { empresaId: empresa.id, rolId: rolIds.get("ADMIN") as string, username: d.admin.username, passwordHash: await hashPassword(d.admin.password), nombre: d.admin.nombre, apellido: d.admin.apellido },
          })
        ).id;

  const consumidor = await db.cliente.upsert({
    where: { tipoIdentificacion_identificacion: { tipoIdentificacion: CONSUMIDOR_FINAL.tipoIdentificacion, identificacion: CONSUMIDOR_FINAL.identificacion } },
    update: {},
    create: { tipoIdentificacion: CONSUMIDOR_FINAL.tipoIdentificacion, identificacion: CONSUMIDOR_FINAL.identificacion, razonSocial: CONSUMIDOR_FINAL.razonSocial },
  });

  await db.configuracionGiro.upsert({ where: { empresaId: empresa.id }, update: {}, create: { empresaId: empresa.id, giroNegocio: d.giro, ...banderasDeGiro(d.giro) } });

  return { empresaId: empresa.id, sucursalId: sucursal.id, puntoEmisionId: punto.id, adminId, clienteConsumidorFinalId: consumidor.id };
}

/** Columnas de `ConfiguracionGiro` que fija cada giro de negocio. */
export function banderasDeGiro(giro: GiroNegocio) {
  const f = FEATURE_FLAGS_POR_GIRO[giro];
  return {
    moduloInventario: f.moduloInventario,
    moduloKardex: f.moduloKardex,
    moduloLotes: f.moduloLotes,
    moduloVencimientos: f.moduloVencimientos,
    moduloMesas: f.moduloMesas,
    moduloComandasCocina: f.moduloComandasCocina,
    moduloBalanza: f.moduloBalanza,
    moduloListasPrecios: f.moduloListasPrecios,
    moduloCuentasPorCobrar: f.moduloCuentasPorCobrar,
    moduloCuentasPorPagar: f.moduloCuentasPorPagar,
    emitirFacturas: f.emitirFacturas,
    emitirNotasCredito: f.emitirNotasCredito,
    emitirRetenciones: f.emitirRetenciones,
    emitirGuiasRemision: f.emitirGuiasRemision,
    emitirLiquidaciones: f.emitirLiquidaciones,
    impresionTermica: f.impresionTermica,
    aperturaGaveta: f.aperturaGaveta,
    lecturaCodigoBarras: f.lecturaCodigoBarras,
    sincronizacionLAN: f.sincronizacionLAN,
    modoTactil: f.modoTacticl,
  };
}

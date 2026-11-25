// ============================================================
// tests/helpers/renderer/entorno.tsx — Entorno de pruebas de la interfaz: API simulada, WebSocket simulado y render del POS
// ============================================================
import "@testing-library/jest-dom/vitest";
import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { WebSocketLike } from "../../../src/server/services/sync/syncCliente";
import { AplicacionPos, crearQueryClient } from "../../../src/renderer/App";
import { ProveedorPos, type ContextoPos } from "../../../src/renderer/services/contexto";
import { ApiCliente } from "../../../src/renderer/services/api";
import { PosApi } from "../../../src/renderer/services/pos.api";
import type { ProductoPos, PuntoEmisionPos, TurnoPos, UsuarioSesion } from "../../../src/renderer/services/tipos";
import { useCarrito } from "../../../src/renderer/store/carrito.store";
import { useNavegacion } from "../../../src/renderer/store/navegacion.store";
import { useSesion } from "../../../src/renderer/store/sesion.store";

// ── API simulada ─────────────────────────────────────────────

export interface PeticionSimulada {
  metodo: string;
  ruta: string;
  parametros: URLSearchParams;
  cuerpo: unknown;
  cabeceras: Record<string, string>;
}

export interface RespuestaSimulada {
  status?: number;
  cuerpo?: unknown;
  /** Respuesta que no es JSON (CSV, PDF, XML) */
  texto?: string;
  cabeceras?: Record<string, string>;
}

export type Manejador = (p: PeticionSimulada) => RespuestaSimulada | Promise<RespuestaSimulada>;

export class ApiSimulada {
  readonly manejadores = new Map<string, Manejador>();
  readonly llamadas: PeticionSimulada[] = [];

  /** Registra una respuesta para «METODO /ruta». */
  en(clave: string, manejador: Manejador | RespuestaSimulada): this {
    this.manejadores.set(clave, typeof manejador === "function" ? manejador : () => manejador);
    return this;
  }

  llamadasA(clave: string): PeticionSimulada[] {
    const [metodo, ruta] = clave.split(" ");
    return this.llamadas.filter((l) => l.metodo === metodo && l.ruta === ruta);
  }

  readonly fetchFn: typeof fetch = async (entrada, init) => {
    const url = new URL(String(entrada));
    const metodo = (init?.method ?? "GET").toUpperCase();
    const cabeceras: Record<string, string> = {};
    for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) cabeceras[k.toLowerCase()] = v;
    const cuerpo = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    const peticion: PeticionSimulada = { metodo, ruta: url.pathname, parametros: url.searchParams, cuerpo, cabeceras };
    this.llamadas.push(peticion);

    const m = this.manejadores.get(`${metodo} ${url.pathname}`);
    const r = m === undefined ? { status: 404, cuerpo: { error: "NO_ENCONTRADO", mensaje: `Sin respuesta simulada para ${metodo} ${url.pathname}` } } : await m(peticion);
    const status = r.status ?? 200;
    if (r.texto !== undefined) return new Response(r.texto, { status, headers: r.cabeceras ?? {} });
    return new Response(status === 204 ? null : JSON.stringify(r.cuerpo ?? {}), { status, headers: { "content-type": "application/json" } });
  };
}

// ── WebSocket simulado ───────────────────────────────────────

export class SocketSimulado implements WebSocketLike {
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason?: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  cerrado = false;
  constructor(readonly url: string) {}
  close(): void {
    this.cerrado = true;
  }
  /** El servidor acepta la conexión */
  abrir(): void {
    this.onopen?.({});
  }
  /** El servidor envía un mensaje */
  recibir(mensaje: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify(mensaje) });
  }
  /** El servidor cierra */
  cerrarDesdeServidor(code: number): void {
    this.onclose?.({ code });
  }
}

// ── Datos de ejemplo ─────────────────────────────────────────

export const USUARIO: UsuarioSesion = { id: "u1", empresaId: "e1", username: "caja1", nombre: "María", apellido: "Pérez", rol: "CAJERO", permisos: ["ventas:crear", "caja:leer", "caja:crear", "inventario:leer", "clientes:leer"] };
/** Permisos de los roles tal como los siembra el sistema (solo los que usa la interfaz). */
export const PERMISOS = {
  CAJERO: ["ventas:crear", "ventas:leer", "caja:crear", "caja:leer", "clientes:crear", "clientes:leer", "inventario:leer"],
  SUPERVISOR: ["ventas:crear", "ventas:leer", "ventas:anular", "ventas:actualizar", "caja:crear", "caja:leer", "caja:actualizar", "clientes:crear", "clientes:leer", "clientes:actualizar", "inventario:leer", "inventario:crear", "inventario:actualizar", "proveedores:leer", "proveedores:crear", "proveedores:actualizar", "reportes:leer", "reportes:exportar", "sri:leer", "sri:crear"],
  BODEGUERO: ["inventario:leer", "inventario:crear", "inventario:actualizar", "proveedores:leer", "proveedores:crear", "proveedores:actualizar"],
  CONTADOR: ["reportes:leer", "reportes:exportar", "sri:leer", "sri:exportar", "ventas:leer"],
} as const;

export const usuarioDe = (rol: keyof typeof PERMISOS): UsuarioSesion => ({ ...USUARIO, id: `u-${rol}`, username: rol.toLowerCase(), rol, permisos: [...PERMISOS[rol]] });

export const PUNTO: PuntoEmisionPos = { id: "11111111-1111-4111-8111-111111111111", codigo: "001", descripcion: "Caja 1", sucursal: { id: "22222222-2222-4222-8222-222222222222", codigo: "001", nombre: "Matriz" } };
export const TURNO: TurnoPos = { id: "33333333-3333-4333-8333-333333333333", sucursalId: PUNTO.sucursal.id, estado: "ABIERTO", montoApertura: 100 };

export function producto(extra: Partial<ProductoPos> & { id: string; codigo: string; nombre: string }): ProductoPos {
  return {
    codigoBarras: null,
    tipo: "BIEN",
    precioVenta: 10,
    stockActual: 50,
    aplicaIva: true,
    codigoIvaSRI: "4",
    unidadMedida: { codigo: "UN", nombre: "Unidad", permiteDecimales: false },
    tarifaImpuesto: null,
    ...extra,
  };
}

export const CAFE = producto({ id: "a0000000-0000-4000-8000-000000000001", codigo: "CAFE", nombre: "Café molido 250g", precioVenta: 10, codigoBarras: "7861234567890" });
export const ARROZ = producto({ id: "a0000000-0000-4000-8000-000000000002", codigo: "ARROZ", nombre: "Arroz 1kg", precioVenta: 1.2, aplicaIva: false, codigoIvaSRI: "0" });
export const QUESO = producto({ id: "a0000000-0000-4000-8000-000000000003", codigo: "QUESO", nombre: "Queso fresco", precioVenta: 8, aplicaIva: false, codigoIvaSRI: "0", unidadMedida: { codigo: "KG", nombre: "Kilogramo", permiteDecimales: true } });
export const CATALOGO = [CAFE, ARROZ, QUESO];

/** Respuestas habituales de un servidor sano: catálogo con búsqueda, puntos, balanza, impresora y cola del SRI. */
export function servidorBasico(api: ApiSimulada, catalogo: ProductoPos[] = CATALOGO): ApiSimulada {
  return api
    .en("GET /api/productos", (p) => {
      const q = (p.parametros.get("search") ?? "").toLowerCase();
      const items = catalogo.filter((x) => q === "" || [x.nombre, x.codigo, x.codigoBarras ?? ""].some((t) => t.toLowerCase().includes(q)));
      return { cuerpo: { items, total: items.length, page: 1, pageSize: 24 } };
    })
    .en("GET /api/setup/estado", { cuerpo: { configurado: true } })
    .en("GET /api/puntos-emision", { cuerpo: { items: [PUNTO] } })
    .en("GET /api/balanza", { cuerpo: { habilitada: true, puerto: "COM3" } })
    .en("GET /api/impresora", { cuerpo: { conexion: "RED", impresionTermica: true } })
    .en("GET /api/sri/cola", { cuerpo: { porEstado: {}, pendientes: [] } })
    .en("GET /api/clientes", { cuerpo: { items: [], total: 0, page: 1, pageSize: 10 } });
}

// ── Render ───────────────────────────────────────────────────

export interface OpcionesRender {
  /** Iniciar ya con sesión, turno y punto de emisión (default true) */
  conSesion?: boolean;
  /** Con sesión pero sin turno abierto (default: con turno) */
  sinTurno?: boolean;
  /** Usuario de la sesión (default: un cajero) */
  usuario?: UsuarioSesion;
  api?: ApiSimulada;
  baseUrl?: string;
  /** userEvent con pausa entre teclas en ms (null = lo más rápido posible, como un lector) */
  retardo?: number | null;
}

export function renderizarPos(o: OpcionesRender = {}) {
  const api = o.api ?? servidorBasico(new ApiSimulada());
  const baseUrl = o.baseUrl ?? "http://127.0.0.1:3001";
  const sockets: SocketSimulado[] = [];
  const noAutenticado = { veces: 0 };

  useCarrito.setState({ lineas: [], cliente: null });
  useNavegacion.setState({ vista: null });
  useSesion.setState({ token: null, usuario: null, turno: null, puntoEmision: null, modoTactil: false });
  if (o.conSesion !== false) useSesion.setState({ token: "token-prueba", usuario: o.usuario ?? USUARIO, turno: o.sinTurno === true ? null : TURNO, puntoEmision: o.sinTurno === true ? null : PUNTO });

  const contexto: ContextoPos = {
    api: new PosApi(
      new ApiCliente({
        baseUrl,
        cajaId: "caja-test",
        fetchFn: api.fetchFn,
        obtenerToken: () => useSesion.getState().token,
        alNoAutenticado: () => {
          noAutenticado.veces += 1;
          useSesion.getState().cerrar();
        },
      })
    ),
    crearSocket: (url) => {
      const s = new SocketSimulado(url);
      sockets.push(s);
      return s;
    },
    cajaId: "caja-test",
  };
  const queryClient = crearQueryClient();
  const vista = render(
    <QueryClientProvider client={queryClient}>
      <ProveedorPos valor={contexto}>
        <AplicacionPos baseUrl={baseUrl} />
      </ProveedorPos>
    </QueryClientProvider>
  );
  const usuario = userEvent.setup({ delay: o.retardo === undefined ? null : o.retardo });
  return { ...vista, api, usuario, sockets, queryClient, noAutenticado };
}

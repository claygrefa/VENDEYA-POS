// ============================================================
// src/renderer/services/pos.api.ts — Operaciones del POS contra el backend
// ============================================================
import type { VentaInput } from "../../shared/schemas/venta.schema";
import { ApiError, consulta, type ApiCliente } from "./api";
import type {
  ClientePos,
  ColaSriPos,
  ConfiguracionBalanzaPos,
  ConfiguracionImpresoraPos,
  Pagina,
  PesoLeidoPos,
  ProductoPos,
  PuntoEmisionPos,
  ResultadoEscaneoPos,
  TurnoPos,
  UsuarioSesion,
  VentaEmitidaPos,
} from "./tipos";

export class PosApi {
  constructor(readonly http: ApiCliente) {}

  login(username: string, password: string): Promise<{ token: string; usuario: UsuarioSesion }> {
    return this.http.post("/api/auth/login", { username, password });
  }

  logout(): Promise<void> {
    return this.http.post("/api/auth/logout");
  }

  async puntosEmision(): Promise<PuntoEmisionPos[]> {
    return (await this.http.get<{ items: PuntoEmisionPos[] }>("/api/puntos-emision")).items;
  }

  /** Turno abierto del usuario, o null si no tiene ninguno. */
  async turnoActual(): Promise<TurnoPos | null> {
    try {
      return await this.http.get<TurnoPos>("/api/turnos/actual");
    } catch (e) {
      if (e instanceof ApiError && (e.codigo === "TURNO_REQUERIDO" || e.codigo === "NO_ENCONTRADO")) return null;
      throw e;
    }
  }

  abrirTurno(sucursalId: string, montoApertura: number): Promise<TurnoPos> {
    return this.http.post("/api/turnos/abrir", { sucursalId, montoApertura });
  }

  productos(search: string, pageSize = 24): Promise<Pagina<ProductoPos>> {
    return this.http.get(`/api/productos${consulta({ search: search.trim(), pageSize })}`);
  }

  clientes(search: string): Promise<Pagina<ClientePos>> {
    return this.http.get(`/api/clientes${consulta({ search: search.trim(), pageSize: 10 })}`);
  }

  escanear(codigo: string): Promise<ResultadoEscaneoPos> {
    return this.http.get(`/api/escaneo/${encodeURIComponent(codigo)}`);
  }

  pesar(productoId: string, tara = 0): Promise<PesoLeidoPos> {
    return this.http.get(`/api/balanza/peso${consulta({ productoId, tara: tara > 0 ? tara : undefined })}`);
  }

  balanza(): Promise<ConfiguracionBalanzaPos> {
    return this.http.get("/api/balanza");
  }

  impresora(): Promise<ConfiguracionImpresoraPos> {
    return this.http.get("/api/impresora");
  }

  crearVenta(venta: VentaInput): Promise<VentaEmitidaPos> {
    return this.http.post("/api/ventas", venta);
  }

  reimprimir(ventaId: string): Promise<void> {
    return this.http.post(`/api/ventas/${ventaId}/imprimir`);
  }

  /** Estado de la cola del SRI; null si el usuario no tiene permiso para verla. */
  async colaSri(): Promise<ColaSriPos | null> {
    try {
      return await this.http.get<ColaSriPos>("/api/sri/cola");
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) return null;
      throw e;
    }
  }
}

// ============================================================
// tests/helpers/licencias.helper.ts — Servidor de licencias SIMULADO (firma de verdad con Ed25519) y claves de prueba
// Implementa el contrato de licencia.cliente.ts; `caido = true` simula que no hay conexión.
// ============================================================
import { generateKeyPairSync } from "crypto";
import { ErrorLicencias, type ClienteLicencias, type DatosDispositivo, type ListaDispositivos } from "../../src/server/services/licencia/licencia.cliente";
import { firmarLicencia, type LicenciaPayload } from "../../src/server/services/licencia/licencia.token";

export interface ClavesLicencia {
  privada: string;
  publica: string;
}

export function generarClavesLicencia(): ClavesLicencia {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return { privada: privateKey.export({ type: "pkcs8", format: "pem" }).toString(), publica: publicKey.export({ type: "spki", format: "pem" }).toString() };
}

interface LicenciaServidor {
  ruc: string;
  plan: string;
  maxDispositivos: number;
  vence: Date;
  /** Motivo de la revocación (undefined = vigente) */
  revocada?: string;
  dispositivos: Map<string, { nombre: string; plataforma: string; ultimoUso: Date }>;
}

export class ServidorLicenciasSimulado implements ClienteLicencias {
  readonly licencias = new Map<string, LicenciaServidor>();
  /** Sin conexión: todas las llamadas fallan con SIN_CONEXION */
  caido = false;
  readonly llamadas: string[] = [];

  constructor(private readonly claves: ClavesLicencia, private readonly ahora: () => Date = () => new Date()) {}

  /** Da de alta una clave de activación (como haría el proveedor al vender una suscripción). */
  alta(clave: string, o: { ruc: string; plan?: string; maxDispositivos?: number; vence: Date }): void {
    this.licencias.set(clave, { ruc: o.ruc, plan: o.plan ?? "PRO", maxDispositivos: o.maxDispositivos ?? 1, vence: o.vence, dispositivos: new Map() });
  }

  renovar(clave: string, vence: Date): void {
    this.exigir(clave).vence = vence;
  }

  revocar(clave: string, motivo: string): void {
    this.exigir(clave).revocada = motivo;
  }

  private exigir(clave: string): LicenciaServidor {
    const l = this.licencias.get(clave);
    if (l === undefined) throw new Error(`Clave de prueba inexistente: ${clave}`);
    return l;
  }

  private emitir(clave: string, dispositivoId: string): string {
    const l = this.exigir(clave);
    const payload: LicenciaPayload = {
      v: 1, licenciaId: clave, ruc: l.ruc, plan: l.plan, maxDispositivos: l.maxDispositivos, dispositivoId, emitida: this.ahora().toISOString(), vence: l.vence.toISOString(),
    };
    return firmarLicencia(payload, this.claves.privada);
  }

  private conectar(llamada: string): void {
    this.llamadas.push(llamada);
    if (this.caido) throw new ErrorLicencias("SIN_CONEXION");
  }

  /** Lee la clave y el equipo de una licencia ya emitida (el servidor sabe lo que firmó) */
  private leer(token: string): { clave: string; dispositivoId: string } {
    const cuerpo = JSON.parse(Buffer.from(token.split(".")[0] as string, "base64url").toString("utf8")) as LicenciaPayload;
    return { clave: cuerpo.licenciaId, dispositivoId: cuerpo.dispositivoId };
  }

  private estadoDe(l: LicenciaServidor): void {
    if (l.revocada !== undefined) throw new ErrorLicencias("REVOCADA", undefined, { error: "REVOCADA", motivo: l.revocada });
    if (l.vence.getTime() < this.ahora().getTime()) throw new ErrorLicencias("SUSCRIPCION_VENCIDA");
  }

  async activar(p: { clave: string; ruc: string; dispositivo: DatosDispositivo }): Promise<{ token: string }> {
    this.conectar("activar");
    const l = this.licencias.get(p.clave);
    if (l === undefined) throw new ErrorLicencias("CLAVE_INVALIDA");
    if (l.ruc !== p.ruc) throw new ErrorLicencias("RUC_NO_COINCIDE");
    this.estadoDe(l);
    if (!l.dispositivos.has(p.dispositivo.id) && l.dispositivos.size >= l.maxDispositivos) {
      throw new ErrorLicencias("LIMITE_DISPOSITIVOS", undefined, { maximo: l.maxDispositivos, dispositivos: [...l.dispositivos].map(([id, d]) => ({ id, nombre: d.nombre })) });
    }
    l.dispositivos.set(p.dispositivo.id, { nombre: p.dispositivo.nombre, plataforma: p.dispositivo.plataforma, ultimoUso: this.ahora() });
    return { token: this.emitir(p.clave, p.dispositivo.id) };
  }

  async validar(p: { token: string; dispositivo: DatosDispositivo }): Promise<{ token: string }> {
    this.conectar("validar");
    const { clave } = this.leer(p.token);
    const l = this.licencias.get(clave);
    if (l === undefined) throw new ErrorLicencias("CLAVE_INVALIDA");
    this.estadoDe(l);
    const d = l.dispositivos.get(p.dispositivo.id);
    if (d === undefined) throw new ErrorLicencias("DISPOSITIVO_NO_REGISTRADO");
    d.ultimoUso = this.ahora();
    return { token: this.emitir(clave, p.dispositivo.id) };
  }

  async desactivar(p: { token: string; dispositivoId: string }): Promise<void> {
    this.conectar("desactivar");
    const { clave } = this.leer(p.token);
    const l = this.licencias.get(clave);
    if (l === undefined || !l.dispositivos.delete(p.dispositivoId)) throw new ErrorLicencias("DISPOSITIVO_NO_REGISTRADO");
  }

  async dispositivos(p: { token: string }): Promise<ListaDispositivos> {
    this.conectar("dispositivos");
    const l = this.licencias.get(this.leer(p.token).clave);
    if (l === undefined) throw new ErrorLicencias("CLAVE_INVALIDA");
    return { maximo: l.maxDispositivos, dispositivos: [...l.dispositivos].map(([id, d]) => ({ id, nombre: d.nombre, plataforma: d.plataforma, ultimoUso: d.ultimoUso.toISOString() })) };
  }

  async liberar(p: { token: string; dispositivoId: string }): Promise<void> {
    this.conectar("liberar");
    const l = this.licencias.get(this.leer(p.token).clave);
    if (l === undefined || !l.dispositivos.delete(p.dispositivoId)) throw new ErrorLicencias("DISPOSITIVO_NO_REGISTRADO");
  }
}

export const dispositivoDePrueba = (id: string, nombre = `PC-${id}`): DatosDispositivo => ({ id, nombre, plataforma: "win32", version: "1.0.0" });

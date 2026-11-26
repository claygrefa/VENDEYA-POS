import { createHash, createPrivateKey, createPublicKey } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { firmarLicencia, verificarLicencia, type LicenciaPayload } from "../services/licencia/licencia.token";
import { transaccion } from "./database";

const Dispositivo = z.object({
  id: z.string().min(1).max(128), nombre: z.string().min(1).max(255),
  plataforma: z.string().min(1).max(64), version: z.string().min(1).max(64),
});
type Dispositivo = z.infer<typeof Dispositivo>;
export const Ruc = z.string().regex(/^\d{13}$/);
export const Activacion = z.object({ clave: z.string().regex(/^[A-Za-z0-9-]{8,64}$/), ruc: Ruc, dispositivo: Dispositivo });
export const Token = z.object({ token: z.string().min(1).max(8192) });
export const Validacion = Token.extend({ dispositivo: Dispositivo });
export const Destino = Token.extend({ dispositivoId: Dispositivo.shape.id });

interface Licencia {
  id: string;
  ruc: string;
  expires_at: Date;
  max_devices: number;
  revoked_at: Date | null;
}

export class RechazoLicencia extends Error {
  constructor(readonly codigo: string, readonly estado: number, readonly detalle = {}) {
    super(codigo);
  }
}

export const hashClave = (clave: string): string => createHash("sha256").update(clave).digest("hex");

export class LicenciasCloud {
  private readonly publica: string;

  constructor(private readonly pool: Pool, private readonly privada: string) {
    const clave = createPrivateKey(privada);
    if (clave.asymmetricKeyType !== "ed25519") throw new Error("Se requiere una clave Ed25519");
    this.publica = createPublicKey(clave).export({ type: "spki", format: "pem" }).toString();
  }

  private async bloquear(db: PoolClient, buscar: { id: string } | { hash: string }): Promise<Licencia> {
    const resultado = "id" in buscar
      ? await db.query<Licencia>("SELECT * FROM licenses WHERE id = $1 FOR UPDATE", [buscar.id])
      : await db.query<Licencia>("SELECT * FROM licenses WHERE key_hash = $1 FOR UPDATE", [buscar.hash]);
    const licencia = resultado.rows[0];
    if (!licencia) throw new RechazoLicencia("CLAVE_INVALIDA", 404);
    if (licencia.revoked_at) throw new RechazoLicencia("REVOCADA", 403);
    if (licencia.expires_at.getTime() <= Date.now()) throw new RechazoLicencia("SUSCRIPCION_VENCIDA", 402);
    return licencia;
  }

  private emitir(licencia: Licencia, id: string, ahora: Date): { token: string } {
    return { token: firmarLicencia({
      v: 1, licenciaId: licencia.id, ruc: licencia.ruc, plan: "PRO", maxDispositivos: licencia.max_devices,
      dispositivoId: id, emitida: ahora.toISOString(), vence: licencia.expires_at.toISOString(),
    }, this.privada) };
  }

  private async lista(db: PoolClient, licencia: Licencia) {
    const { rows } = await db.query<{ id: string; nombre: string; plataforma: string; ultimoUso: Date }>(
      'SELECT id, name AS nombre, platform AS plataforma, last_seen AS "ultimoUso" FROM license_devices WHERE license_id = $1 ORDER BY id',
      [licencia.id]);
    return { maximo: licencia.max_devices, dispositivos: rows };
  }

  activar({ clave, ruc, dispositivo }: z.infer<typeof Activacion>): Promise<{ token: string }> {
    return transaccion(this.pool, async (db) => {
      const licencia = await this.bloquear(db, { hash: hashClave(clave) });
      if (licencia.ruc !== ruc) throw new RechazoLicencia("RUC_NO_COINCIDE", 403);
      const lista = await this.lista(db, licencia);
      if (!lista.dispositivos.some((d) => d.id === dispositivo.id) && lista.dispositivos.length >= lista.maximo) {
        throw new RechazoLicencia("LIMITE_DISPOSITIVOS", 409, lista);
      }
      const ahora = new Date();
      await db.query(`INSERT INTO license_devices (license_id, id, name, platform, activated_at, last_seen)
        VALUES ($1,$2,$3,$4,$5,$5) ON CONFLICT (license_id,id)
        DO UPDATE SET last_seen=EXCLUDED.last_seen,name=EXCLUDED.name,platform=EXCLUDED.platform`,
      [licencia.id, dispositivo.id, dispositivo.nombre, dispositivo.plataforma, ahora]);
      return this.emitir(licencia, dispositivo.id, ahora);
    });
  }

  private autorizado<T>(token: string, usar: (db: PoolClient, licencia: Licencia, payload: LicenciaPayload) => Promise<T>): Promise<T> {
    const datos = verificarLicencia(token, this.publica);
    if (!datos.valida || !z.uuid().safeParse(datos.payload.licenciaId).success) throw new RechazoLicencia("CLAVE_INVALIDA", 401);
    const payload = datos.payload;
    return transaccion(this.pool, async (db) => {
      const licencia = await this.bloquear(db, { id: payload.licenciaId });
      const { rows } = await db.query<{ activated_at: Date }>(
        "SELECT activated_at FROM license_devices WHERE license_id=$1 AND id=$2", [licencia.id, payload.dispositivoId]);
      const alta = rows[0];
      if (!alta || Date.parse(payload.emitida) < alta.activated_at.getTime()) throw new RechazoLicencia("DISPOSITIVO_NO_REGISTRADO", 409);
      return usar(db, licencia, payload);
    });
  }

  validar({ token, dispositivo }: z.infer<typeof Validacion>): Promise<{ token: string }> {
    return this.autorizado(token, async (db, licencia, payload) => {
      if (dispositivo.id !== payload.dispositivoId) throw new RechazoLicencia("DISPOSITIVO_NO_REGISTRADO", 409);
      const ahora = new Date();
      await db.query("UPDATE license_devices SET last_seen=$3 WHERE license_id=$1 AND id=$2", [licencia.id, dispositivo.id, ahora]);
      return this.emitir(licencia, dispositivo.id, ahora);
    });
  }

  dispositivos(token: string) {
    return this.autorizado(token, (db, licencia) => this.lista(db, licencia));
  }

  liberar({ token, dispositivoId }: z.infer<typeof Destino>, propio: boolean): Promise<void> {
    return this.autorizado(token, async (db, licencia, payload) => {
      if (propio && dispositivoId !== payload.dispositivoId) throw new RechazoLicencia("DISPOSITIVO_NO_REGISTRADO", 409);
      const r = await db.query("DELETE FROM license_devices WHERE license_id=$1 AND id=$2", [licencia.id, dispositivoId]);
      if (!r.rowCount) throw new RechazoLicencia("DISPOSITIVO_NO_REGISTRADO", 409);
    });
  }
}

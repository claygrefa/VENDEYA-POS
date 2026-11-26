import { createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { crearCloud } from "./app";
import { conectar, migrar } from "./database";
import { hashClave, Ruc } from "./licencia.service";

async function inicializar(): Promise<void> {
  const dir = path.resolve(".release-private");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const archivo = path.join(dir, "license.env");
  const pareja = generateKeyPairSync("ed25519");
  const pem = pareja.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const nueva = Buffer.from(pem).toString("base64");
  try {
    await writeFile(archivo, `LICENSE_SIGNING_KEY_BASE64=${nueva}\n`, { mode: 0o600, flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const valor = /^LICENSE_SIGNING_KEY_BASE64=([A-Za-z0-9+/=]+)\s*$/.exec(await readFile(archivo, "utf8"))?.[1];
  if (!valor) throw new Error("La clave existente no tiene el formato esperado");
  const privada = createPrivateKey(Buffer.from(valor, "base64"));
  const publica = createPublicKey(privada).export({ type: "spki", format: "pem" });
  await writeFile(path.join(dir, "license-public.pem"), publica, { mode: 0o644 });
  console.log("Clave del servidor preparada en .release-private/license.env. Clave pública en .release-private/license-public.pem.");
}

async function ejecutar([comando = "serve", ...args]: string[]): Promise<void> {
  if (comando === "init") return inicializar();
  if (!["serve", "migrate", "issue", "revoke"].includes(comando)) throw new Error("Comandos: init, serve, migrate, issue, revoke");
  const pool = conectar();
  let atendiendo = false;
  try {
    await migrar(pool);
    if (comando === "migrate") {
      console.log("Migración PostgreSQL aplicada.");
      return;
    }
    if (comando === "issue") {
      const ruc = Ruc.parse(args[0]);
      const dias = z.coerce.number().int().min(1).max(3650).parse(args[1]);
      const equipos = z.coerce.number().int().min(1).max(1000).parse(args[2]);
      const id = randomUUID();
      const clave = randomBytes(24).toString("hex").toUpperCase();
      const vence = new Date(Date.now() + dias * 86_400_000);
      await pool.query("INSERT INTO licenses (id,key_hash,ruc,expires_at,max_devices) VALUES ($1,$2,$3,$4,$5)",
        [id, hashClave(clave), ruc, vence, equipos]);
      console.log(`ID ${id}\nClave de activación ${clave}\nVence ${vence.toISOString()}`);
      return;
    }
    if (comando === "revoke") {
      const r = await pool.query("UPDATE licenses SET revoked_at=COALESCE(revoked_at, now()) WHERE id=$1", [z.uuid().parse(args[0])]);
      if (!r.rowCount) throw new Error("Licencia inexistente");
      console.log("Licencia revocada.");
      return;
    }

    const puerto = z.coerce.number().int().min(1).max(65535).parse(process.env["PORT"] ?? 8080);
    const proxy = z.coerce.number().int().min(0).max(3).parse(process.env["CLOUD_TRUST_PROXY_HOPS"] ?? 0);
    const clave = process.env["LICENSE_SIGNING_KEY_BASE64"];
    if (!clave) throw new Error("Configura LICENSE_SIGNING_KEY_BASE64");
    const app = await crearCloud(pool, Buffer.from(clave, "base64").toString("utf8"), proxy || false);
    const purgar = async (): Promise<void> => {
      await pool.query("DELETE FROM telemetry_reports WHERE received_at < now() - interval '30 days'");
    };
    await purgar();
    let mantenimiento: NodeJS.Timeout | undefined;
    app.addHook("onClose", async () => {
      clearInterval(mantenimiento);
      await pool.end();
    });
    await app.listen({ host: "0.0.0.0", port: puerto });
    atendiendo = true;
    console.log(`Backend de licencias y telemetría listo en puerto ${puerto}`);
    mantenimiento = setInterval(() => void purgar().catch(() => app.log.warn("No se pudo depurar la telemetría")), 3_600_000);
    const cerrar = () => void app.close().catch(() => { process.exitCode = 1; });
    process.once("SIGINT", cerrar);
    process.once("SIGTERM", cerrar);
  } finally {
    if (!atendiendo) await pool.end();
  }
}

if (require.main === module) void ejecutar(process.argv.slice(2)).catch(() => {
  console.error("Operación cloud fallida. Revisa los argumentos, las variables de entorno y PostgreSQL.");
  process.exitCode = 1;
});

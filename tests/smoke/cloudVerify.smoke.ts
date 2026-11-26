import { createHash, createPublicKey, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { verificarLicencia } from "../../src/server/services/licencia/licencia.token";
import { pedirSecreto } from "./promptSecret.util";

async function ejecutar(): Promise<void> {
  const [base, ruc, archivo = ".release-private/license-public.pem"] = process.argv.slice(2);
  if (!base || !ruc || base === "--help") {
    console.log("Uso: npm run cloud:verify -- https://backend RUC [clave-publica.pem]");
    if (base !== "--help") process.exitCode = 1;
    return;
  }
  const url = new URL(base);
  if (url.protocol !== "https:" || url.username || url.password || url.href !== url.origin + "/") {
    throw new Error("Usa el origen HTTPS público del backend");
  }
  z.string().regex(/^\d{13}$/).parse(ruc);
  const publica = await readFile(archivo, "utf8");
  const pedir = async (ruta: string, cuerpo?: unknown): Promise<Response> => {
    const r = await fetch(new URL(ruta, url), {
      redirect: "error", signal: AbortSignal.timeout(15_000),
      ...(cuerpo === undefined ? {} : { method: "POST", body: JSON.stringify(cuerpo), headers: { "content-type": "application/json" } }),
    });
    if (!r.ok) throw new Error(`${ruta} respondió HTTP ${r.status}`);
    return r;
  };
  const salud = await pedir("/health");
  z.object({ status: z.literal("ok"), db: z.literal("ok") }).parse(await salud.json());
  const esquema = z.object({ token: z.string() });
  const clave = await pedirSecreto("Clave de activación de la licencia de prueba: ");
  const dispositivo = { id: randomUUID(), nombre: "Release Smoke", plataforma: "cli", version: "1.0.0" };
  const act = esquema.parse(await (await pedir("/v1/licencias/activar", { clave, ruc, dispositivo })).json());
  const activada = verificarLicencia(act.token, publica);
  if (!activada.valida || activada.payload.ruc !== ruc || activada.payload.dispositivoId !== dispositivo.id) {
    throw new Error("Token de activación inválido");
  }
  let token = act.token;
  try {
    const r = await pedir("/api/license/verify", { token, dispositivo });
    const renovada = esquema.parse(await r.json());
    const v = verificarLicencia(renovada.token, publica);
    if (!v.valida || v.payload.ruc !== ruc || v.payload.dispositivoId !== dispositivo.id || Date.parse(v.payload.vence) <= Date.now()) {
      throw new Error("La licencia devuelta por HTTPS es inválida o está vencida");
    }
    token = renovada.token;
    const fecha = new Date().toISOString();
    const telemetria = await pedir("/v1/telemetria", { instalacion: randomUUID(), reportes: [{
      id: randomUUID(), fecha, version: "1.0.0", plataforma: "cli", origen: "servidor",
      vista: null, mensaje: "Comprobación operativa de publicación", pila: null,
    }] });
    if (telemetria.status !== 204) throw new Error("Se esperaba HTTP 204 de telemetría");
  } finally {
    await pedir("/v1/licencias/desactivar", { token, dispositivoId: dispositivo.id });
  }
  await mkdir("evidence", { recursive: true });
  await writeFile("evidence/services.json", JSON.stringify({
    origin: url.origin, health: 200, licenseVerify: 200, telemetry: 204, checkedAt: new Date().toISOString(),
    licenseKeySha256: createHash("sha256").update(createPublicKey(publica).export({ type: "spki", format: "der" })).digest("hex"),
  }, null, 2), { mode: 0o600 });
  console.log("HTTPS, licencia firmada y telemetría verificados. Evidencia: evidence/services.json");
}

void ejecutar().catch((error: unknown) => {
  console.error(error instanceof Error && !(error instanceof z.ZodError) ? error.message : "Respuesta o argumentos de verificación inválidos");
  process.exitCode = 1;
});

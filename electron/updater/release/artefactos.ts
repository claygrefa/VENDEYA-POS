import { createHash, createPublicKey } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export const Hash = z.string().regex(/^[0-9a-f]{64}$/);
export const Sha = z.string().regex(/^[0-9a-f]{40}$/);
export const Run = z.string().regex(/^[1-9][0-9]{0,19}$/);
export const Version = z.string().regex(/^\d+\.\d+\.\d+(?:-[a-z0-9.]+)?$/);
export const Plataforma = z.enum(["windows", "macos"]);
export type Plataforma = z.infer<typeof Plataforma>;
const Nombre = z.string().regex(/^[a-zA-Z0-9][\w.-]*$/);
export const Activo = z.object({ name: Nombre, sha256: Hash });
export const Manifiesto = z.object({
  sha: Sha, run: Run, version: Version, platform: Plataforma, origin: z.string().url(),
  licenseKeySha256: Hash, assets: z.array(Activo).min(1),
});

export async function leerJson(ruta: string): Promise<unknown> {
  return JSON.parse((await readFile(ruta, "utf8")).replace(/^\uFEFF/, "")) as unknown;
}

export async function huella(ruta: string, algoritmo = "sha256", formato: "hex" | "base64" = "hex"): Promise<string> {
  const hash = createHash(algoritmo);
  for await (const trozo of createReadStream(ruta)) hash.update(trozo as Buffer);
  return hash.digest(formato);
}

function configuracion() {
  const servidor = new URL(process.env["LICENSE_SERVER_URL"] ?? "");
  const telemetria = new URL(process.env["TELEMETRY_URL"] ?? "");
  const pem = Buffer.from(process.env["LICENSE_PUBLIC_KEY_BASE64"] ?? "", "base64").toString("utf8").trim();
  if (!pem.startsWith("-----BEGIN PUBLIC KEY-----")) throw new Error("La variable debe contener el PEM público en Base64");
  const publica = createPublicKey(pem);
  if (servidor.protocol !== "https:" || servidor.href !== servidor.origin + "/" ||
      telemetria.href !== servidor.origin + "/v1/telemetria" || publica.asymmetricKeyType !== "ed25519") {
    throw new Error("Los servicios del candidato deben usar el mismo origen HTTPS y una clave pública Ed25519");
  }
  return {
    servidorUrl: servidor.origin, telemetriaUrl: telemetria.href,
    clavePublica: publica.export({ type: "spki", format: "pem" }).toString(),
    licenseKeySha256: createHash("sha256").update(publica.export({ type: "spki", format: "der" })).digest("hex"),
  };
}

async function ejecutar([comando, destino]: string[]): Promise<void> {
  const config = configuracion();
  if (comando === "config") {
    await writeFile("electron/licencia.config.json", JSON.stringify(config, null, 2));
    return;
  }
  const platform = Plataforma.parse(comando);
  if (!destino) throw new Error("Falta el directorio de artefactos");
  const version = z.object({ version: Version }).parse(await leerJson("package.json")).version;
  const channel = version.split("-")[1]?.split(".")[0] ?? "latest";
  const archivos = (await readdir(destino, { withFileTypes: true })).filter((f) => f.isFile()).map((f) => f.name).sort();
  const requeridos = platform === "windows"
    ? [`vendeyapos-Setup-${version}.exe`, `${channel}.yml`, "baseline.exe"]
    : [`${channel}-mac.yml`, ...["x64", "arm64"].flatMap((arch) => ["dmg", "zip"].map((ext) => `VENDEYA-POS-${version}-${arch}.${ext}`))];
  for (const nombre of requeridos) if (!archivos.includes(nombre)) throw new Error(`Falta ${nombre}`);
  const assets = await Promise.all(archivos.filter((f) => requeridos.includes(f) || f.endsWith(".blockmap"))
    .map(async (name) => ({ name, sha256: await huella(path.join(destino, name)) })));
  const manifiesto = Manifiesto.parse({
    sha: process.env["GITHUB_SHA"], run: process.env["GITHUB_RUN_ID"],
    version, platform, origin: config.servidorUrl, licenseKeySha256: config.licenseKeySha256, assets,
  });
  await mkdir(destino, { recursive: true });
  await writeFile(path.join(destino, "signing.json"), JSON.stringify(manifiesto, null, 2));
}

if (require.main === module) void ejecutar(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "No se pudo preparar el candidato");
  process.exitCode = 1;
});

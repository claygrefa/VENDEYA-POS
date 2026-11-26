import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { leerRespuestaAutorizacion } from "../../../src/server/services/sri/ws/sriSoap.client";
import { verificarFirmaXades } from "../../../src/server/services/sri/firma/xades.firma";
import { validarClaveAcceso } from "../../../src/server/services/sri/claveAcceso.util";
import { Activo, Hash, Manifiesto, Run, Sha, Version, huella, leerJson, type Plataforma } from "./artefactos";

const Repo = "claygrefa/VENDEYA-POS";
const plataformas = ["windows", "macos"] as const;
const Fecha = z.iso.datetime();
const Recibo = z.object({
  sha: Sha, run: Run, version: Version, windows: Hash, macos: Hash,
  servicios: Hash, sri: Hash, instalacion: Hash, actualizacion: Hash,
});
type Recibo = z.infer<typeof Recibo>;
type Manifiesto = z.infer<typeof Manifiesto>;

function comando(exe: string, args: string[]): string {
  return execFileSync(exe, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 4 * 1024 * 1024 }).trim();
}

function git(...args: string[]): string {
  return comando("git", args);
}

async function manifiestos(dir: string, sha: string, version: string) {
  const resultado = {} as Record<Plataforma, { info: Manifiesto; hash: string }>;
  for (const plataforma of plataformas) {
    const archivo = path.join(dir, plataforma, "signing.json");
    const info = Manifiesto.parse(await leerJson(archivo));
    if (info.sha !== sha || info.version !== version || info.platform !== plataforma) {
      throw new Error(`El candidato de ${plataforma} no corresponde al commit o la versión`);
    }
    const vistos = new Set<string>();
    for (const activo of info.assets) {
      if (vistos.has(activo.name) || !/\.(exe|dmg|zip|yml|blockmap)$/.test(activo.name) ||
          activo.sha256 !== await huella(path.join(dir, plataforma, activo.name))) {
        throw new Error(`Huella incorrecta o artefacto duplicado: ${activo.name}`);
      }
      vistos.add(activo.name);
    }
    resultado[plataforma] = { info, hash: await huella(archivo) };
  }
  if (resultado.windows.info.run !== resultado.macos.info.run ||
      resultado.windows.info.origin !== resultado.macos.info.origin ||
      resultado.windows.info.licenseKeySha256 !== resultado.macos.info.licenseKeySha256) {
    throw new Error("Los candidatos Windows y macOS difieren en ejecución o servicios configurados");
  }
  return resultado;
}

async function verificarEvidencia(sha: string, version: string): Promise<Recibo> {
  const base = "evidence";
  const candidatos = await manifiestos(path.join(base, "candidate"), sha, version);
  const windows = candidatos.windows.info;
  const servicios = z.object({
    origin: z.string().url(), health: z.literal(200), licenseVerify: z.literal(200),
    telemetry: z.literal(204), checkedAt: Fecha, licenseKeySha256: Hash,
  }).parse(await leerJson(path.join(base, "services.json")));
  if (new URL(servicios.origin).protocol !== "https:" ||
      servicios.origin !== windows.origin || servicios.licenseKeySha256 !== windows.licenseKeySha256) {
    throw new Error("El HTTPS y la clave pública verificados deben coincidir con el candidato");
  }

  const sri = z.object({
    status: z.literal("AUTORIZADO"), environment: z.literal("PRUEBAS"),
    accessKey: z.string().regex(/^\d{49}$/), file: z.string(), sha256: Hash, checkedAt: Fecha,
  }).parse(await leerJson(path.join(base, "sri.json")));
  if (!validarClaveAcceso(sri.accessKey) || sri.accessKey[23] !== "1" || sri.file !== `sri-${sri.accessKey}.xml`) {
    throw new Error("Clave o archivo de evidencia SRI fuera del ambiente de pruebas");
  }
  const xml = await readFile(path.join(base, sri.file), "utf8");
  const respuesta = leerRespuestaAutorizacion(xml);
  if (sri.sha256 !== await huella(path.join(base, sri.file)) || respuesta.claveAcceso !== sri.accessKey ||
      !respuesta.autorizaciones.some((a) => a.estado === "AUTORIZADO" && a.ambiente === "PRUEBAS" &&
        a.numeroAutorizacion && a.fechaAutorizacion && a.comprobante && verificarFirmaXades(a.comprobante).valida)) {
    throw new Error("La evidencia del SRI no contiene la autorización firmada esperada");
  }

  const instalacion = path.join(base, "windows-clean.json");
  const actualizacion = path.join(base, "windows-upgrade.json");
  const Smoke = z.object({ installerSha256: Hash, version: Version, checkedAt: Fecha, nsisExitCode: z.literal(0), healthy: z.literal(true) });
  const limpio = Smoke.extend({ mode: z.literal("clean") }).parse(await leerJson(instalacion));
  const upgrade = Smoke.extend({
    mode: z.literal("upgrade"), baselineSha256: Hash, baselineVersion: Version, dataPreserved: z.literal(true),
  }).parse(await leerJson(actualizacion));
  const instalador = windows.assets.find((a) => a.name === `vendeyapos-Setup-${version}.exe`);
  if (limpio.version !== version || upgrade.version !== version || !instalador ||
      limpio.installerSha256 !== instalador.sha256 || upgrade.installerSha256 !== instalador.sha256 ||
      upgrade.baselineSha256 !== windows.assets.find((a) => a.name === "baseline.exe")?.sha256) {
    throw new Error("La VM debe probar los instaladores exactos del candidato");
  }
  return {
    sha, version, run: windows.run, windows: candidatos.windows.hash, macos: candidatos.macos.hash,
    servicios: await huella(path.join(base, "services.json")), sri: sri.sha256,
    instalacion: await huella(instalacion), actualizacion: await huella(actualizacion),
  };
}

function verificarRun(recibo: Recibo): void {
  const datos = z.object({
    head_sha: Sha, event: z.literal("workflow_dispatch"), conclusion: z.literal("success"),
    path: z.string(),
  }).parse(JSON.parse(comando("gh", ["api", `repos/${Repo}/actions/runs/${recibo.run}`])));
  if (datos.head_sha !== recibo.sha || datos.path.split("@")[0] !== ".github/workflows/release.yml") {
    throw new Error("La ejecución de Actions no corresponde al candidato autorizado");
  }
}

async function descargar(recibo: Recibo, dir: string) {
  for (const plataforma of plataformas) {
    comando("gh", ["run", "download", recibo.run, "--repo", Repo, "--name", `release-${plataforma}`, "--dir", path.join(dir, plataforma)]);
  }
  const candidatos = await manifiestos(dir, recibo.sha, recibo.version);
  if (candidatos.windows.hash !== recibo.windows || candidatos.macos.hash !== recibo.macos ||
      candidatos.windows.info.run !== recibo.run) {
    throw new Error("El manifiesto de Actions difiere del aprobado");
  }
  return candidatos;
}

async function temporal<T>(usar: (dir: string) => Promise<T>): Promise<T> {
  const raiz = path.resolve(os.tmpdir());
  const dir = await mkdtemp(path.join(raiz, "vendeya-release-"));
  try {
    return await usar(dir);
  } finally {
    if (path.dirname(path.resolve(dir)) === raiz && /^vendeya-release-\w+$/.test(path.basename(dir))) {
      await rm(dir, { recursive: true, force: true, maxRetries: 3 });
    }
  }
}

function leerTag(tag: string): Recibo {
  const objeto = git("cat-file", "tag", `refs/tags/${tag}`);
  const mensaje = objeto.slice(objeto.indexOf("\n\n") + 2).split("\n", 1)[0];
  return Recibo.parse(JSON.parse(mensaje ?? ""));
}

async function promover(tag: string, version: string, sha: string): Promise<void> {
  if (process.env["GITHUB_ACTIONS"] !== "true" || process.env["GITHUB_REPOSITORY"] !== Repo ||
      process.env["GITHUB_REF"] !== `refs/tags/${tag}`) throw new Error("Promoción disponible en GitHub Actions para el tag");
  const recibo = leerTag(tag);
  if (recibo.sha !== sha || recibo.version !== version) throw new Error("El tag apunta a otro candidato");
  verificarRun(recibo);
  await temporal(async (dir) => {
    const candidatos = await descargar(recibo, dir);
    const activos: string[] = [];
    for (const p of plataformas) {
      for (const { name } of z.array(Activo).parse(candidatos[p].info.assets)) {
        if (name !== "baseline.exe") activos.push(path.join(dir, p, name));
      }
    }
    const consulta = spawnSync("gh", ["release", "view", tag, "--repo", Repo, "--json", "isDraft,assets"], { encoding: "utf8" });
    if (consulta.error) throw consulta.error;
    if (consulta.status === 0) {
      const existente = z.object({ isDraft: z.boolean(), assets: z.array(z.object({ name: z.string() })) }).parse(JSON.parse(consulta.stdout));
      if (!existente.isDraft) throw new Error("Ya existe un release publicado para este tag");
      const nombres = new Set(activos.map((f) => path.basename(f)));
      if (existente.assets.some((a) => !nombres.has(a.name))) throw new Error("El borrador contiene activos fuera del candidato");
      comando("gh", ["release", "upload", tag, ...activos, "--repo", Repo, "--clobber"]);
    } else {
      comando("gh", ["release", "create", tag, ...activos, "--repo", Repo, "--verify-tag", "--draft",
        "--title", `VendeYa POS ${version}`, "--generate-notes", ...(version.includes("-") ? ["--prerelease"] : [])]);
    }
    comando("gh", ["release", "edit", tag, "--repo", Repo, "--draft=false"]);
  });
  console.log(`Release ${tag} publicado con los artefactos verificados`);
}

async function ejecutar(args: string[]): Promise<void> {
  if (args[0] === "--help") {
    console.log("npm run release:publish [-- --publish]\nSin --publish valida la evidencia. Con --publish crea y sube el tag.");
    return;
  }
  const modo = z.enum(["--publish", "--promote"]).optional().parse(args[0]);
  if (args.length > 1) throw new Error("Argumentos inválidos");
  const version = z.object({ version: Version }).parse(JSON.parse(git("show", "HEAD:package.json"))).version;
  const tag = `v${version}`;
  const sha = Sha.parse(git("rev-parse", "HEAD"));
  if (modo === "--promote") return promover(tag, version, sha);
  const recibo = await verificarEvidencia(sha, version);
  if (modo !== "--publish") {
    console.log(`Evidencia local completa para ${tag}. Usa --publish para verificar Actions y subir el tag.`);
    return;
  }
  const remoto = git("remote", "get-url", "--push", "origin");
  if (remoto !== `https://github.com/${Repo}.git` && remoto !== `git@github.com:${Repo}.git`) {
    throw new Error("El destino de push de origin no corresponde a VendeYa POS");
  }
  verificarRun(recibo);
  await temporal((dir) => descargar(recibo, dir));
  if (git("ls-remote", "--tags", "origin", `refs/tags/${tag}`)) throw new Error(`El tag remoto ${tag} ya existe`);
  const existente = spawnSync("git", ["show-ref", "--verify", "--quiet", `refs/tags/${tag}`]).status;
  if (existente === 0) {
    if (JSON.stringify(leerTag(tag)) !== JSON.stringify(recibo) || git("rev-list", "-n", "1", tag) !== sha) {
      throw new Error(`El tag local ${tag} ya existe para otro candidato o evidencia`);
    }
  } else {
    git("tag", "-a", tag, sha, "-m", JSON.stringify(recibo));
  }
  git("push", "origin", `refs/tags/${tag}`);
  console.log(`Tag ${tag} enviado. Sigue el workflow Release en GitHub Actions.`);
}

if (require.main === module) void ejecutar(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "No se pudo continuar con el release");
  process.exitCode = 1;
});

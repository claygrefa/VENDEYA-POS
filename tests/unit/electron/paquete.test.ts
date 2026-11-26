// ============================================================
// tests/unit/electron/paquete.test.ts — Configuración de instaladores, firma, publicación y CI
// Vigila lo que NO se puede probar construyendo el instalador en cada ejecución: que no viaje nada de desarrollo, que los binarios nativos
// y los recursos estén declarados, que existan los íconos y que no haya secretos en el repositorio.
// ============================================================
import { existsSync, readdirSync, readFileSync } from "fs";
import path from "path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

const RAIZ = path.resolve(__dirname, "../../..");
const leer = (...p: string[]): string => readFileSync(path.join(RAIZ, ...p), "utf8");
const yaml = <T = Record<string, unknown>>(...p: string[]): T => load(leer(...p)) as T;

type Archivo = string | { from: string; to: string; filter?: string[] };
interface Config {
  appId: string;
  directories: { buildResources: string };
  asarUnpack: string[];
  npmRebuild: boolean;
  files: Archivo[];
  extraResources: Array<{ from: string; to: string }>;
  win: { target: Array<{ target: string; arch: string[] }>; icon: string; files: Archivo[]; requestedExecutionLevel: string; signingHashAlgorithms: string[] };
  nsis: Record<string, unknown>;
  mac: { target: Array<{ target: string; arch: string[] }>; icon: string; files: Archivo[]; hardenedRuntime: boolean; entitlements: string; entitlementsInherit: string; artifactName: string };
  publish: { provider: string; owner: string; repo: string };
}
const cfg = yaml<Config>("electron-builder.yml");
const cadenas = (l: Archivo[]): string[] => l.filter((x): x is string => typeof x === "string");
const conjuntos = (l: Archivo[]): Array<Exclude<Archivo, string>> => l.filter((x): x is Exclude<Archivo, string> => typeof x !== "string");
/** Lo común a todas las plataformas: sin los filtros propios de cada una (binarios nativos por sistema) */
const comunes = (l: Archivo[]): string[] => cadenas(l).filter((x) => !x.includes("bindings-cpp/prebuilds"));
const bin = (...p: string[]): Buffer => readFileSync(path.join(RAIZ, cfg.directories.buildResources, ...p));

describe("Qué entra en el paquete", () => {
  it("la lista de archivos común está repetida igual en Windows y macOS (electron-builder ignora la global si la plataforma define la suya)", () => {
    expect(comunes(cfg.win.files)).toEqual(comunes(cfg.files));
    expect(comunes(cfg.mac.files)).toEqual(comunes(cfg.files));
    expect(comunes(cfg.files).length).toBeGreaterThan(8);
  });

  it("deja fuera lo de desarrollo: código fuente, pruebas, .env, informes internos y bases de datos o certificados", () => {
    for (const lista of [cfg.files, cfg.win.files, cfg.mac.files]) {
      const texto = cadenas(lista).join("\n");
      // la exclusión de carpetas tiene la forma "!{src,tests,...}/**": cada carpeta debe figurar en esa lista
      const carpetas = /!\{([^}]*)\}\/\*\*/.exec(texto)?.[1]?.split(",") ?? [];
      for (const dir of ["src", "tests", "prisma", "release", "out", ".github"]) expect(carpetas, dir).toContain(dir);
      for (const f of [".env", "AUDIT_REPORT.md", "REVIEWER_AGENT.md", "PROJECT_STATUS.md", "AGENTS.md"]) expect(texto, f).toContain(f);
      expect(texto).toMatch(/!\*\*\/\*\.\{[^}]*\bdb\b[^}]*\bp12\b[^}]*\}/);
    }
  });

  it("solo lleva lo compilado: dist (interfaz), dist-electron (servidor y proceso principal) y la configuración de licencias", () => {
    const positivos = cadenas(cfg.files).filter((f) => !f.startsWith("!"));
    expect(positivos).toEqual(["dist/**/*", "dist-electron/**/*", "electron/licencia.config.json"]);
  });

  it("el cliente de Prisma generado y su motor nativo se copian explícitamente, cada plataforma solo con el suyo", () => {
    const win = conjuntos(cfg.win.files).find((c) => c.from === "node_modules/.prisma/client");
    const mac = conjuntos(cfg.mac.files).find((c) => c.from === "node_modules/.prisma/client");
    expect(win).toMatchObject({ to: "node_modules/.prisma/client", filter: ["**/*", "!libquery_engine-*"] });
    expect(mac).toMatchObject({ to: "node_modules/.prisma/client", filter: ["**/*", "!query_engine-windows.dll.node"] });
    const schema = leer("prisma", "schema.prisma");
    expect(schema).toMatch(/binaryTargets\s*=\s*\[[^\]]*"native"[^\]]*"darwin"[^\]]*"darwin-arm64"[^\]]*\]/);
  });

  it("los binarios nativos se desempaquetan del asar (no pueden ejecutarse desde dentro)", () => {
    expect(cfg.asarUnpack).toEqual(expect.arrayContaining(["node_modules/.prisma/**", "node_modules/@serialport/bindings-cpp/**", "node_modules/xmllint-wasm/**"]));
    expect(cfg.npmRebuild).toBe(false); // serialport usa N-API con prebuilds y better-sqlite3 no se usa
    expect(readdirSync(path.join(RAIZ, "node_modules", "@serialport", "bindings-cpp", "prebuilds"))).toEqual(expect.arrayContaining(["win32-x64", "darwin-x64+arm64"]));
  });

  it("serialport: Windows conserva solo win32-x64 y macOS solo el universal", () => {
    const win = cadenas(cfg.win.files).find((f) => f.includes("bindings-cpp/prebuilds")) ?? "";
    const mac = cadenas(cfg.mac.files).find((f) => f.includes("bindings-cpp/prebuilds")) ?? "";
    expect(win).toContain("darwin-*");
    expect(win).not.toContain("win32-x64");
    expect(mac).toContain("win32-*");
    expect(mac).not.toContain("darwin");
  });

  it("migraciones y schema viajan como recursos y existen; los XSD del SRI quedan en dist-electron", () => {
    expect(cfg.extraResources).toEqual(expect.arrayContaining([{ from: "prisma/migrations", to: "prisma/migrations" }, { from: "prisma/schema.prisma", to: "prisma/schema.prisma" }]));
    const migraciones = readdirSync(path.join(RAIZ, "prisma", "migrations"), { withFileTypes: true }).filter((d) => d.isDirectory());
    expect(migraciones.length).toBeGreaterThanOrEqual(11);
    for (const m of migraciones) expect(existsSync(path.join(RAIZ, "prisma", "migrations", m.name, "migration.sql")), m.name).toBe(true);
    expect(leer("package.json")).toContain("src/server/services/sri/xsd"); // build:main los copia a dist-electron
    expect(existsSync(path.join(RAIZ, "src", "server", "services", "sri", "xsd", "factura_V2.1.0.xsd"))).toBe(true);
  });

  it("las librerías que solo usa la interfaz (Vite las empaqueta) no viajan como dependencias del servidor", () => {
    const pkg = JSON.parse(leer("package.json")) as { dependencies: Record<string, string>; devDependencies: Record<string, string>; main: string; version: string; build?: unknown };
    for (const m of ["react", "react-dom", "@tanstack/react-query", "zustand", "lucide-react"]) {
      expect(pkg.dependencies[m], m).toBeUndefined();
      expect(pkg.devDependencies[m], m).toBeDefined();
    }
    for (const m of ["fastify", "@prisma/client", "electron-updater", "zod", "pdfkit", "xmllint-wasm"]) expect(pkg.dependencies[m], m).toBeDefined();
    expect(pkg.dependencies["pdfkit"]).toMatch(/^~0\.20\./); // 0.21+ exige fontkit ESM, que el Node de Electron 33 no puede require()
    expect(pkg.build).toBeUndefined(); // un solo origen de configuración: electron-builder.yml
    expect(pkg.main).toBe("dist-electron/electron/main.js");
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/);
  });
});

describe("Instalador de Windows (NSIS)", () => {
  it("es un instalador NSIS x64 de un clic, por usuario y sin pedir administrador", () => {
    expect(cfg.win.target).toEqual([{ target: "nsis", arch: ["x64"] }]);
    expect(cfg.nsis).toMatchObject({ oneClick: true, perMachine: false, createDesktopShortcut: "always", createStartMenuShortcut: true, shortcutName: "vendeyapos", runAfterFinish: true });
    expect(cfg.win.requestedExecutionLevel).toBe("asInvoker");
    expect(cfg.win.signingHashAlgorithms).toEqual(["sha256"]);
  });

  it("desinstalar NO borra los datos del negocio, está en español y el archivo no lleva espacios (debe coincidir con latest.yml)", () => {
    expect(cfg.nsis["deleteAppDataOnUninstall"]).toBe(false);
    expect(cfg.nsis["language"]).toBe("3082"); // es-ES
    const nombre = String(cfg.nsis["artifactName"]);
    expect(nombre).toContain("${version}");
    expect(nombre).not.toContain(" ");
    expect(cfg.mac.artifactName).not.toContain(" ");
  });

  it("los íconos existen y son válidos (ICO con imagen PNG, PNG de 512, ICNS)", () => {
    const ico = bin(path.basename(cfg.win.icon));
    expect([...ico.subarray(0, 4)]).toEqual([0, 0, 1, 0]);
    const png = bin("icon.png");
    expect(png.subarray(1, 4).toString("latin1")).toBe("PNG");
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([512, 512]); // electron-builder exige 512 como mínimo
    const icns = bin(path.basename(cfg.mac.icon));
    expect(icns.subarray(0, 4).toString("latin1")).toBe("icns");
    expect(icns.readUInt32BE(4)).toBe(icns.length);
  });
});

describe("macOS (.dmg) — configuración lista, NO construida ni probada (hace falta un Mac)", () => {
  it("firma con hardened runtime y permisos para Electron, y genera dmg x64 y arm64", () => {
    expect(cfg.mac.target).toEqual([{ target: "dmg", arch: ["x64", "arm64"] }]);
    expect(cfg.mac.hardenedRuntime).toBe(true);
    for (const e of [cfg.mac.entitlements, cfg.mac.entitlementsInherit]) {
      const plist = readFileSync(path.join(RAIZ, cfg.directories.buildResources, e), "utf8");
      for (const permiso of ["com.apple.security.cs.allow-jit", "com.apple.security.cs.allow-unsigned-executable-memory", "com.apple.security.cs.disable-library-validation", "com.apple.security.network.client", "com.apple.security.network.server"]) {
        expect(plist, permiso).toContain(permiso);
      }
      expect(plist).not.toMatch(/camera|microphone|addressbook|location/i);
    }
  });
});

describe("Firma, publicación y CI", () => {
  const release = readFileSync(path.join(RAIZ, ".github", "workflows", "release.yml"), "utf8");
  const ci = readFileSync(path.join(RAIZ, ".github", "workflows", "ci.yml"), "utf8");
  const wf = yaml<{ on: Record<string, unknown>; jobs: Record<string, { needs?: string; steps: Array<Record<string, unknown>> }> }>(".github", "workflows", "release.yml");

  it("las actualizaciones se publican como GitHub Release (latest.yml), con canal beta para las versiones con sufijo", () => {
    expect(cfg.publish).toMatchObject({ provider: "github", owner: "claygrefa", repo: "VENDEYA-POS" });
    expect(release).toContain("prerelease");
    expect(release).toContain("--publish always");
  });

  it("la publicación solo parte de una etiqueta vX.Y.Z, verifica antes de construir y exige que la etiqueta coincida con package.json", () => {
    expect(wf.on).toEqual({ push: { tags: ["v*"] } });
    expect(wf.jobs["windows"]?.needs).toBe("verificar");
    expect(wf.jobs["macos"]?.needs).toBe("verificar");
    expect(release).toContain("npm test");
    expect(release).toMatch(/package\.json[\s\S]*GITHUB_REF_NAME/);
  });

  it("nada se publica sin firmar: forceCodeSigning en Windows y macOS, y notarización en macOS", () => {
    expect(cfg.win).toMatchObject({ verifyUpdateCodeSignature: true });
    expect(release.match(/forceCodeSigning=true/g)).toHaveLength(2);
    expect(release).toContain("-c.mac.notarize=true");
  });

  it("los secretos llegan solo por `secrets.*` (nunca escritos) y no hay claves ni tokens en el repositorio", () => {
    for (const s of ["WIN_CSC_LINK", "WIN_CSC_KEY_PASSWORD", "MAC_CSC_LINK", "MAC_CSC_KEY_PASSWORD", "APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"]) {
      expect(release).toContain(`\${{ secrets.${s} }}`);
    }
    for (const texto of [release, ci, leer("electron-builder.yml"), leer("package.json")]) {
      expect(texto).not.toMatch(/-----BEGIN [A-Z ]*PRIVATE KEY-----/);
      expect(texto).not.toMatch(/\bgh[pousr]_[A-Za-z0-9]{20,}/);
      expect(texto).not.toMatch(/(CSC_KEY_PASSWORD|APPLE_APP_SPECIFIC_PASSWORD)\s*[:=]\s*(?!\$\{\{)\S+/);
    }
    // los certificados jamás entran al repositorio
    const ignorado = leer(".gitignore");
    for (const ext of ["*.p12", "*.pfx", "*.pem", "*.key", ".env"]) expect(ignorado, ext).toContain(ext);
  });

  it("el CI de cada cambio comprueba los 3 tsconfig, las pruebas y la compilación", () => {
    for (const paso of ["npx tsc --noEmit", "tsconfig.node.json", "tsconfig.electron.json", "npm test", "npm run build:main", "npm run build:vite", "npx prisma generate"]) expect(ci, paso).toContain(paso);
    expect(ci).toMatch(/permissions:\s*\n\s*contents: read/); // el CI no necesita escribir en el repositorio
  });
});

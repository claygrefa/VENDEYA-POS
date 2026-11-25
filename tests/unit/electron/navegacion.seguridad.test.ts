// ============================================================
// tests/unit/electron/navegacion.seguridad.test.ts — La ventana solo muestra la interfaz de la aplicación
// ============================================================
import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { esEnlaceExternoSeguro, esNavegacionPermitida } from "../../../electron/navegacion.seguridad";

const RAIZ = path.resolve(__dirname, "../../..");
const leer = (r: string): string => readFileSync(path.join(RAIZ, r), "utf8");

describe("Navegación de la ventana", () => {
  it("en producción solo se permite la interfaz empaquetada (file://)", () => {
    expect(esNavegacionPermitida("file:///C:/app/dist/index.html", false)).toBe(true);
    expect(esNavegacionPermitida("https://sitio-malicioso.example/", false)).toBe(false);
    expect(esNavegacionPermitida("http://localhost:5173/", false)).toBe(false);
    expect(esNavegacionPermitida("javascript:alert(1)", false)).toBe(false);
    expect(esNavegacionPermitida("data:text/html,<script>1</script>", false)).toBe(false);
    expect(esNavegacionPermitida("no es una url", false)).toBe(false);
  });

  it("en desarrollo se permite además el servidor de Vite, y solo ese origen", () => {
    expect(esNavegacionPermitida("http://localhost:5173/pos", true)).toBe(true);
    expect(esNavegacionPermitida("http://localhost:5174/", true)).toBe(false);
    expect(esNavegacionPermitida("http://localhost:5173.evil.example/", true)).toBe(false);
  });

  it("los enlaces externos solo son http(s) sin credenciales incrustadas", () => {
    expect(esEnlaceExternoSeguro("https://www.sri.gob.ec/")).toBe(true);
    expect(esEnlaceExternoSeguro("http://ejemplo.ec/ayuda")).toBe(true);
    expect(esEnlaceExternoSeguro("file:///C:/Windows/System32/calc.exe")).toBe(false);
    expect(esEnlaceExternoSeguro("ms-msdt:/id PCWDiagnostic")).toBe(false);
    expect(esEnlaceExternoSeguro("https://usuario:clave@ejemplo.ec/")).toBe(false);
  });
});

describe("Configuración de seguridad de Electron y de la interfaz", () => {
  const main = leer("electron/main.ts");

  it("la ventana usa aislamiento de contexto, sin Node en la interfaz y con sandbox", () => {
    expect(main).toMatch(/contextIsolation:\s*true/);
    expect(main).toMatch(/nodeIntegration:\s*false/);
    expect(main).toMatch(/sandbox:\s*true/);
    expect(main).not.toMatch(/webSecurity:\s*false|allowRunningInsecureContent|nodeIntegration:\s*true|contextIsolation:\s*false/);
  });

  it("bloquea la navegación externa, los webviews y todos los permisos del navegador", () => {
    expect(main).toContain("will-navigate");
    expect(main).toContain("will-attach-webview");
    expect(main).toContain("setPermissionRequestHandler");
    expect(main).toContain("esEnlaceExternoSeguro");
  });

  it("la política CSP de la interfaz prohíbe objetos, <base> y formularios externos y no permite scripts remotos ni eval", () => {
    const html = leer("src/renderer/index.html");
    expect(html).toContain("object-src 'none'");
    expect(html).toContain("base-uri 'none'");
    expect(html).toContain("form-action 'none'");
    expect(html).toMatch(/script-src 'self'(?![^;"]*unsafe)/);
  });

  it("el preload no expone ipcRenderer ni require completos a la página", () => {
    const preload = leer("electron/preload.ts");
    expect(preload).not.toMatch(/exposeInMainWorld\([^)]*ipcRenderer\s*[,)]/);
    expect(preload).not.toMatch(/exposeInMainWorld\([^,]+,\s*(?:require|process)\b/);
  });
});

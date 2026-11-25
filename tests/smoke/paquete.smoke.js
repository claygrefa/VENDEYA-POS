// ============================================================
// tests/smoke/paquete.smoke.js — Prueba de humo del paquete de Windows (sin red, sin tocar los datos reales)
//
//   npm run build && npx electron-builder --win --x64 --dir --publish never -c.directories.output=out/humo
//   npm run test:paquete -- out/humo/win-unpacked
//
// 1) Ejecuta el binario EMPAQUETADO como Node (ELECTRON_RUN_AS_NODE) y levanta el backend desde dentro del app.asar con una base vacía:
//    migraciones desde resources/, alta inicial, login, validación XSD, Code128, PDF y puerto serie.
// 2) Comprueba que el asar NO lleva nada de desarrollo (código fuente, pruebas, .env, bases de datos, informes internos).
// 3) Arranca el ejecutable completo con un userData temporal: el backend responde, queda sin configurar (primer arranque = asistente) y
//    crea la base de datos en userData/data.
// Es CommonJS a propósito: corre con el Node del propio Electron empaquetado.
// ============================================================
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const HIJO = process.env.VENDEYA_HUMO_HIJO === "1";
// Carpeta de trabajo de la prueba (por omisión, la temporal del sistema; configurable si el sistema restringe esa ruta a los ejecutables nuevos)
const BASE_TMP = process.env.VENDEYA_HUMO_TMP ? path.resolve(process.env.VENDEYA_HUMO_TMP) : os.tmpdir();

// ── Modo hijo: corre DENTRO del binario empaquetado ──────────
async function hijo(recursos) {
  const asar = path.join(recursos, "app.asar");
  fs.mkdirSync(BASE_TMP, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(BASE_TMP, "vendeya-humo-"));
  const resultado = {};
  const { iniciarBackend } = require(path.join(asar, "dist-electron", "src", "server", "index.js"));
  const b = await iniciarBackend({
    dbPath: path.join(tmp, "data", "vendeya.db"),
    migrationsDir: path.join(recursos, "prisma", "migrations"),
    backupsDir: path.join(tmp, "data", "backups"),
    directorioSecretos: path.join(tmp, "secretos"),
    port: 0,
    logLevel: "silent",
  });
  resultado.migraciones = b.migraciones.aplicadas.length;
  const json = { "content-type": "application/json" };
  resultado.estadoInicial = (await (await fetch(b.url + "/api/setup/estado")).json()).configurado;
  const alta = {
    empresa: { ruc: "1790016919001", razonSocial: "EMPRESA DE HUMO S.A.", nombreComercial: "HUMO", direccionMatriz: "Av. Siempre Viva 123", telefono: "022345678", email: "humo@ejemplo.ec", tipoContribuyente: "SOCIEDAD", regimenTributario: "GENERAL", obligadoContabilidad: false, ambienteSRI: "PRUEBAS" },
    sucursal: { nombre: "Matriz", direccion: "Av. Siempre Viva 123", telefono: "022345678" },
    giro: "RETAIL_GENERAL",
    admin: { username: "dueno", password: "Clave-Segura1", nombre: "Ana", apellido: "Torres" },
  };
  resultado.alta = (await fetch(b.url + "/api/setup", { method: "POST", headers: json, body: JSON.stringify(alta) })).status;
  const login = await (await fetch(b.url + "/api/auth/login", { method: "POST", headers: json, body: JSON.stringify({ username: "dueno", password: "Clave-Segura1" }) })).json();
  resultado.permisos = login.usuario ? login.usuario.permisos.length : 0;
  const licencia = await (await fetch(b.url + "/api/licencia", { headers: { authorization: "Bearer " + login.token } })).json();
  resultado.licencia = licencia.tipo;

  const { XsdValidatorService } = require(path.join(asar, "dist-electron", "src", "server", "services", "sri", "xsdValidator.service.js"));
  const v = await new XsdValidatorService().validar("factura", '<factura id="comprobante" version="2.1.0"></factura>');
  resultado.xsd = { valido: v.valido, errores: v.errores.length };
  const { barrasCode128 } = require(path.join(asar, "dist-electron", "src", "server", "services", "sri", "ride", "ride.pdf.js"));
  resultado.code128 = barrasCode128("1234567890").length;
  const PDFDocument = require(require.resolve("pdfkit", { paths: [asar] }));
  const pdf = await new Promise((res) => {
    const d = new PDFDocument();
    const c = [];
    d.on("data", (x) => c.push(x));
    d.on("end", () => res(Buffer.concat(c)));
    d.text("RIDE de prueba");
    d.end();
  });
  resultado.pdf = pdf.subarray(0, 5).toString();
  const sp = require(require.resolve("serialport", { paths: [asar] }));
  resultado.serialport = typeof sp.SerialPort === "function" && Array.isArray(await sp.SerialPort.list());
  const respaldo = await b.respaldos.crear("pre-actualizacion", "humo");
  resultado.respaldo = fs.existsSync(respaldo);
  await b.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("RESULTADO " + JSON.stringify(resultado));
  process.exit(0);
}

// ── Modo runner ──────────────────────────────────────────────
function fallo(mensaje) {
  console.error("✗ " + mensaje);
  process.exitCode = 1;
}
const ok = (mensaje) => console.log("✓ " + mensaje);

async function esperar(url, ms) {
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (r.ok) return await r.json();
    } catch {
      /* todavía no arranca */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

async function runner(carpeta) {
  const exe = path.join(carpeta, "VENDEYA POS.exe");
  const recursos = path.join(carpeta, "resources");
  if (!fs.existsSync(exe)) return fallo(`No existe ${exe}: genere antes el paquete con --dir`);
  // ELECTRON_RUN_AS_NODE lo define VS Code y haría que el ejecutable arranque como Node también en el paso 3
  const entorno = { ...process.env };
  delete entorno.ELECTRON_RUN_AS_NODE;

  // 1) Backend dentro del asar
  const r1 = spawnSync(exe, [__filename, recursos], { env: { ...entorno, ELECTRON_RUN_AS_NODE: "1", VENDEYA_HUMO_HIJO: "1" }, encoding: "utf8", timeout: 120_000 });
  const linea = (r1.stdout || "").split(/\r?\n/).find((l) => l.startsWith("RESULTADO "));
  if (r1.status !== 0 || !linea) return fallo("El backend empaquetado no arrancó:\n" + (r1.stderr || r1.stdout));
  const r = JSON.parse(linea.slice("RESULTADO ".length));
  const migraciones = fs.readdirSync(path.join(recursos, "prisma", "migrations"), { withFileTypes: true }).filter((d) => d.isDirectory()).length;
  const comprobar = (cond, texto) => (cond ? ok(texto) : fallo(texto));
  comprobar(r.migraciones === migraciones, `migraciones aplicadas desde resources/: ${r.migraciones} de ${migraciones}`);
  comprobar(r.estadoInicial === false, "base vacía: el sistema se informa sin configurar (primer arranque = asistente)");
  comprobar(r.alta === 201, "alta inicial 201");
  comprobar(r.permisos === 60, `login del administrador con ${r.permisos} permisos`);
  comprobar(r.licencia === "NO_REQUERIDA", `licenciamiento sin configurar no bloquea (${r.licencia})`);
  comprobar(r.xsd.valido === false && r.xsd.errores > 0, "validación XSD (xmllint-wasm desde el asar) rechaza un XML incompleto");
  comprobar(r.code128 > 20, `código de barras Code128 (bwip-js): ${r.code128} barras`);
  comprobar(r.pdf === "%PDF-", "PDF (pdfkit)");
  comprobar(r.serialport === true, "puerto serie (serialport) carga y lista");
  comprobar(r.respaldo === true, "respaldo de la base de datos con verificación");

  // 2) Nada de desarrollo dentro del asar
  const asar = require("@electron/asar");
  const entradas = asar.listPackage(path.join(recursos, "app.asar")).map((e) => e.split("\\").join("/"));
  const raiz = new Set(entradas.filter((e) => /^\/[^/]+$/.test(e)).map((e) => e.slice(1)));
  const permitidos = new Set(["dist", "dist-electron", "node_modules", "package.json"]);
  const sobran = [...raiz].filter((e) => !permitidos.has(e));
  comprobar(sobran.length === 0, `el app.asar solo lleva dist, dist-electron, node_modules y package.json${sobran.length ? " — sobran: " + sobran.join(", ") : ""}`);
  const prohibidos = entradas.filter((e) => /^\/(src|tests|prisma|release|out)(\/|$)|(^|\/)\.env(\.|$)|\.(db|db-journal|p12|pfx|pem)$/.test(e) && !e.startsWith("/node_modules/"));
  comprobar(prohibidos.length === 0, `sin bases de datos, certificados, .env ni código fuente${prohibidos.length ? ": " + prohibidos.slice(0, 5).join(", ") : ""}`);
  comprobar(fs.existsSync(path.join(recursos, "app.asar.unpacked", "node_modules", ".prisma", "client", "query_engine-windows.dll.node")), "motor de Prisma desempaquetado");

  // 3) El ejecutable completo, con un userData temporal
  if (process.env.VENDEYA_HUMO_GUI === "off") {
    console.log("• OMITIDO (VENDEYA_HUMO_GUI=off): arranque del ejecutable completo — NO verificado");
    console.log(process.exitCode ? "\nPAQUETE CON PROBLEMAS" : "\nPAQUETE OK (sin el arranque del ejecutable completo)");
    return;
  }
  fs.mkdirSync(BASE_TMP, { recursive: true });
  const ud = fs.mkdtempSync(path.join(BASE_TMP, "vendeya-ud-"));
  const puerto = 3900 + Math.floor(Math.random() * 90);
  const app = spawn(exe, [`--user-data-dir=${ud}`], { env: { ...entorno, SERVER_PORT: String(puerto) }, stdio: "ignore" });
  const estado = await esperar(`http://127.0.0.1:${puerto}/api/setup/estado`, 40_000);
  comprobar(estado !== null && estado.configurado === false, "el ejecutable arranca, el backend responde y queda sin configurar");
  comprobar(fs.existsSync(path.join(ud, "data", "vendeya.db")), "la base de datos se crea en userData/data");
  spawnSync("taskkill", ["/F", "/T", "/PID", String(app.pid)], { stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 1500));
  try {
    fs.rmSync(ud, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch {
    /* un temporal retenido no invalida la prueba */
  }
  console.log(process.exitCode ? "\nPAQUETE CON PROBLEMAS" : "\nPAQUETE OK");
}

if (HIJO) {
  hijo(process.argv[2]).catch((e) => {
    console.error(e && e.stack ? e.stack : e);
    process.exit(1);
  });
} else {
  const carpeta = path.resolve(process.argv[2] || "");
  if (!process.argv[2]) fallo("Uso: npm run test:paquete -- <carpeta win-unpacked>");
  else runner(carpeta);
}

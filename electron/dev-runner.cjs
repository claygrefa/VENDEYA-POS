// ============================================================
// electron/dev-runner.cjs — Lanzador de Electron en desarrollo
// Elimina ELECTRON_RUN_AS_NODE (heredado de terminales de VS Code)
// para asegurar que Electron inicie en modo GUI con su ventana interactiva.
// ============================================================
const { spawn } = require("child_process");
const electron = require("electron");

const env = { ...process.env, NODE_ENV: "development" };
delete env.ELECTRON_RUN_AS_NODE;

const proc = spawn(electron, ["."], {
  stdio: "inherit",
  env,
});

proc.on("close", (code) => {
  process.exit(code ?? 0);
});

proc.on("error", (err) => {
  console.error("[dev-runner] Error al lanzar Electron:", err);
  process.exit(1);
});

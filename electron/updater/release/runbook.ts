import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";

const pasos = [
  { titulo: "Servidores HTTPS", archivos: ["services.json"] },
  { titulo: "Facturación SRI celcer", archivos: ["sri.json"] },
  { titulo: "Windows limpio y upgrade", archivos: ["windows-clean.json", "windows-upgrade.json"] },
  { titulo: "Firma y notarización", archivos: ["candidate/windows/signing.json", "candidate/macos/signing.json"] },
  { titulo: "Verificación y publicación", archivos: [] },
];

async function ejecutar(): Promise<void> {
  const texto = readFileSync("docs/RELEASE_V1_RUNBOOK.md", "utf8");
  const secciones = texto.split(/(?=^## [1-5]\. )/m).slice(1);
  const pendientes = pasos.findIndex((paso) => paso.archivos.some((f) => !existsSync(`evidence/${f}`)));
  const sugerido = pendientes < 0 ? pasos.length : pendientes + 1;
  if (!process.stdin.isTTY) {
    console.log(secciones[sugerido - 1]);
    return;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (const [i, paso] of pasos.entries()) {
      const falta = paso.archivos.filter((f) => !existsSync(`evidence/${f}`));
      console.log(`${i + 1}. ${paso.titulo}${falta.length ? ` (pendiente: ${falta.join(", ")})` : " (paso disponible)"}`);
    }
    const eleccion = (await rl.question(`Paso a consultar [${sugerido}]: `)).trim();
    const n = eleccion === "" ? sugerido : Number(eleccion);
    if (!Number.isInteger(n) || n < 1 || n > pasos.length) throw new Error("Elige un paso entre 1 y 5");
    console.log(`\n${secciones[n - 1]}`);
  } finally {
    rl.close();
  }
}

void ejecutar().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "No se pudo abrir el runbook");
  process.exitCode = 1;
});

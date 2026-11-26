const variables = ["CSC_LINK", "CSC_KEY_PASSWORD"];
const faltantes = variables.filter((variable) => !process.env[variable]?.trim());

if (faltantes.length > 0) {
  console.error(`Firma comercial: configura ${faltantes.join(" y ")} antes de construir el release.`);
  process.exitCode = 1;
} else if (variables.some((variable) => process.env[`WIN_${variable}`] && process.env[`WIN_${variable}`] !== process.env[variable])) {
  console.error("Firma comercial: las variables WIN_CSC_* del proceso tienen prioridad. Usa CSC_LINK y CSC_KEY_PASSWORD para este release.");
  process.exitCode = 1;
}

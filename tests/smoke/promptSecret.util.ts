import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";

export async function pedirSecreto(mensaje: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Abre una terminal interactiva");
  const salidaSilenciosa = new Writable({ write(_chunk, _encoding, hecho) { hecho(); } });
  const teclado = createInterface({ input: process.stdin, output: salidaSilenciosa, terminal: true, historySize: 0 });
  const cancelacion = new AbortController();
  teclado.once("SIGINT", () => cancelacion.abort());
  process.stdout.write(mensaje);
  try {
    return await teclado.question("", { signal: cancelacion.signal });
  } finally {
    teclado.close();
    process.stdout.write("\n");
  }
}

import Fastify from "fastify";
import { z } from "zod";
import { ErrorLicencias } from "../../src/server/services/licencia/licencia.cliente";
import { verificarLicencia } from "../../src/server/services/licencia/licencia.token";
import { MAX_COLA } from "../../src/server/services/telemetria/telemetria.service";
import { MAX_MENSAJE, MAX_PILA } from "../../src/server/services/telemetria/telemetria.util";
import { generarClavesLicencia, ServidorLicenciasSimulado } from "./licencias.helper";

const Dispositivo = z.object({
  id: z.string().min(1).max(128), nombre: z.string().max(255),
  plataforma: z.string().max(50), version: z.string().max(50),
});
const Token = z.object({ token: z.string().min(1).max(8192) });
const Destino = Token.extend({ dispositivoId: Dispositivo.shape.id });
const Lote = z.object({
  instalacion: z.uuid(),
  reportes: z.array(z.object({
    id: z.uuid(), fecha: z.iso.datetime(), version: z.string().max(50), plataforma: z.string().max(50),
    origen: z.enum(["interfaz", "servidor"]), vista: z.string().max(40).nullable(),
    mensaje: z.string().max(MAX_MENSAJE + 1), pila: z.string().max(MAX_PILA + 1).nullable(),
  })).min(1).max(MAX_COLA),
});

export function crearReceptor(ruc: string, clave: string, registrar: (cantidad: number) => void) {
  const app = Fastify({ bodyLimit: 512 * 1024 });
  const claves = generarClavesLicencia();
  const licencias = new ServidorLicenciasSimulado(claves);
  licencias.alta(clave, { ruc, maxDispositivos: 2, vence: new Date(Date.now() + 30 * 86_400_000) });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof z.ZodError) return reply.code(400).send({ error: "VALIDACION" });
    if (error instanceof ErrorLicencias) {
      return reply.code(error.codigo === "CLAVE_INVALIDA" ? 404 : 409).send({ error: error.codigo });
    }
    return reply.send(error);
  });

  function autenticar(token: string) {
    const resultado = verificarLicencia(token, claves.publica);
    if (!resultado.valida) throw new ErrorLicencias("CLAVE_INVALIDA");
    return resultado.payload;
  }

  app.post("/v1/licencias/activar", async ({ body }) =>
    licencias.activar(z.object({ clave: z.string().min(1), ruc: z.string().regex(/^\d{13}$/), dispositivo: Dispositivo }).parse(body)));
  app.post("/v1/licencias/validar", async ({ body }) => {
    const datos = Token.extend({ dispositivo: Dispositivo }).parse(body);
    if (autenticar(datos.token).dispositivoId !== datos.dispositivo.id) throw new ErrorLicencias("DISPOSITIVO_NO_REGISTRADO");
    return licencias.validar(datos);
  });
  app.post("/v1/licencias/dispositivos", async ({ body }) => {
    const datos = Token.parse(body);
    autenticar(datos.token);
    return licencias.dispositivos(datos);
  });
  app.post("/v1/licencias/desactivar", async ({ body }, reply) => {
    const datos = Destino.parse(body);
    if (autenticar(datos.token).dispositivoId !== datos.dispositivoId) throw new ErrorLicencias("DISPOSITIVO_NO_REGISTRADO");
    await licencias.desactivar(datos);
    return reply.code(204).send();
  });
  app.post("/v1/licencias/liberar", async ({ body }, reply) => {
    const datos = Destino.parse(body);
    autenticar(datos.token);
    await licencias.liberar(datos);
    return reply.code(204).send();
  });
  app.post("/v1/telemetria", async ({ body }, reply) => {
    registrar(Lote.parse(body).reportes.length);
    return reply.code(204).send();
  });

  return { app, clavePublica: claves.publica };
}

async function iniciar(): Promise<void> {
  const ruc = z.string().regex(/^\d{13}$/).parse(process.argv[2]);
  const clave = "PRELANZAMIENTO-LOCAL";
  const { app, clavePublica } = crearReceptor(ruc, clave, (cantidad) => console.log(`Reportes recibidos: ${cantidad}`));
  const url = await app.listen({ host: "127.0.0.1", port: 4387 });
  console.log(`LICENSE_SERVER_URL=${url}\nTELEMETRY_URL=${url}/v1/telemetria`);
  console.log(`LICENSE_PUBLIC_KEY=${clavePublica.trim().replace(/\n/g, "\\n")}\nClave de activación local: ${clave}`);
}

if (require.main === module) void iniciar().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

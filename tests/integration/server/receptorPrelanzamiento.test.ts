import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { cargarConfigLicencia } from "../../../electron/licencia.config";
import { ClienteLicenciasHttp } from "../../../src/server/services/licencia/licencia.cliente";
import { verificarLicencia } from "../../../src/server/services/licencia/licencia.token";
import { TransporteHttp } from "../../../src/server/services/telemetria/telemetria.service";
import { crearReceptor } from "../../helpers/receptorPrelanzamiento.mock";
import { dispositivoDePrueba } from "../../helpers/licencias.helper";

it("intercambia licencias firmadas y telemetría con el receptor HTTP de pruebas", async () => {
  const ruc = "9999999999001";
  const clave = "PRELANZAMIENTO-LOCAL";
  const registrar = vi.fn();
  const { app, clavePublica } = crearReceptor(ruc, clave, registrar);
  try {
    const url = await app.listen({ host: "127.0.0.1", port: 0 });
    const config = cargarConfigLicencia({ rutas: [], env: { LICENSE_SERVER_URL: url, LICENSE_PUBLIC_KEY: clavePublica } });
    expect(config).not.toBeNull();
    const cliente = new ClienteLicenciasHttp(config!.servidorUrl);
    const dispositivo = dispositivoDePrueba("local");
    const { token } = await cliente.activar({ clave, ruc, dispositivo });
    const renovada = await cliente.validar({ token, dispositivo });
    expect(verificarLicencia(renovada.token, config!.clavePublica)).toMatchObject({ valida: true, payload: { ruc, dispositivoId: dispositivo.id } });
    await expect(cliente.validar({ token: "inválido", dispositivo })).rejects.toMatchObject({ codigo: "CLAVE_INVALIDA" });
    expect((await cliente.dispositivos({ token })).dispositivos).toHaveLength(1);
    await cliente.desactivar({ token, dispositivoId: dispositivo.id });
    await expect(cliente.validar({ token, dispositivo })).rejects.toMatchObject({ codigo: "DISPOSITIVO_NO_REGISTRADO" });

    const destino = new TransporteHttp(`${url}/v1/telemetria`);
    await destino.enviar({ instalacion: randomUUID(), reportes: [{
      id: randomUUID(), fecha: new Date().toISOString(), version: "1.0.0", plataforma: "win32-x64",
      origen: "servidor", vista: null, mensaje: "Error de prueba", pila: null,
    }] });
    expect(registrar).toHaveBeenCalledWith(1);
  } finally {
    await app.close();
  }
});

import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { operarCobroPendiente } from "../../../electron/ipc/cobroPendiente.ipc";

it("reabre el intento en disco por cajero y lo retira solo con el UUID resuelto", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "vendeya-cobro-"));
  const actor = { empresaId: randomUUID(), cajeroId: randomUUID() };
  const cobro = {
    intentoId: randomUUID(), puntoEmisionId: randomUUID(),
    pagos: [{ formaPago: "EFECTIVO", monto: 5 }],
    lineas: [{ productoId: randomUUID(), cantidad: 1 }],
  };
  try {
    expect(operarCobroPendiente(dir, { tipo: "leer", actor })).toBeNull();
    operarCobroPendiente(dir, { tipo: "guardar", actor, cobro });
    expect(operarCobroPendiente(dir, { tipo: "leer", actor })).toMatchObject(cobro);
    expect(operarCobroPendiente(dir, { tipo: "leer", actor: { ...actor, cajeroId: randomUUID() } })).toBeNull();
    expect(() => operarCobroPendiente(dir, { tipo: "guardar", actor, cobro: { ...cobro, intentoId: randomUUID() } })).toThrow("Ya existe");
    operarCobroPendiente(dir, { tipo: "retirar", actor, intentoId: randomUUID() });
    expect(operarCobroPendiente(dir, { tipo: "leer", actor })).toMatchObject(cobro);
    operarCobroPendiente(dir, { tipo: "retirar", actor, intentoId: cobro.intentoId });
    expect(operarCobroPendiente(dir, { tipo: "leer", actor })).toBeNull();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

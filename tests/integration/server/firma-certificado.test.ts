// ============================================================
// tests/integration/server/firma-certificado.test.ts
// Certificado digital (.p12) de la empresa, cifrado AES-256-GCM de su contraseña y firma XAdES-BES de
// comprobantes reales: carga y validación, manipulación de lo cifrado, rotación de la clave maestra y API.
// Los certificados se generan en el momento: jamás hay uno real en el repositorio.
// ============================================================
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Cliente, Producto } from "@prisma/client";
import { fechaHoraIsoEcuador } from "../../../src/server/services/sri/fechaEcuador.util";
import { ProveedorClaveMaestra } from "../../../src/server/services/sri/firma/claveMaestra.provider";
import { cifrarSecreto } from "../../../src/server/services/sri/firma/cifrado.util";
import { verificarFirmaXades } from "../../../src/server/services/sri/firma/xades.firma";
import { XsdValidatorService } from "../../../src/server/services/sri/xsdValidator.service";
import type { ActorCaja } from "../../../src/server/services/turno.service";
import { generarP12Prueba, type OpcionesP12 } from "../../helpers/certificados.helper";
import { abrirTurno, codigoError, crearActor, crearEntorno, crearProducto, PASSWORD_ADMIN, type Entorno } from "../helpers/entorno.helper";
import { verificarInvariantes } from "../helpers/invariantes.helper";

const RUC = "9999999999001"; // RUC de la empresa del seed
const PASSWORD_P12 = "Clave-Del-P12-ñ#1";

let env: Entorno;
let admin: ActorCaja;
let supervisor: ActorCaja;
let cajero: ActorCaja;
let producto: Producto;
let cliente: Cliente;
const xsd = new XsdValidatorService();

const carpetaCertificados = (): string => path.join(env.secretos, "certificados");
const archivosP12 = (): string[] => (existsSync(carpetaCertificados()) ? readdirSync(carpetaCertificados()).filter((f) => f.endsWith(".p12")) : []);
const configuracion = () => env.prisma.configuracionGiro.findUniqueOrThrow({ where: { empresaId: env.seed.empresaId } });

function cargaDe(o: OpcionesP12 = {}, extra: Record<string, unknown> = {}) {
  const p12 = generarP12Prueba({ identificacion: RUC, password: PASSWORD_P12, ...o });
  return { p12, entrada: { archivoBase64: p12.archivo.toString("base64"), password: p12.password, ...extra } };
}

async function nuevaFactura(): Promise<string> {
  const v = await env.servicios.ventas.crear(
    { puntoEmisionId: env.seed.puntoEmisionId, lineas: [{ productoId: producto.id, cantidad: 1 }], pagos: [{ formaPago: "EFECTIVO", monto: 12 }], emitirFactura: true, clienteId: cliente.id },
    cajero
  );
  return (await env.prisma.comprobanteElectronico.findUniqueOrThrow({ where: { ventaId: v.id } })).id;
}

const comprobante = (id: string) => env.prisma.comprobanteElectronico.findUniqueOrThrow({ where: { id }, include: { colaSRI: true } });

beforeAll(async () => {
  env = await crearEntorno();
  admin = await crearActor(env, "ADMIN", "firma.admin");
  supervisor = await crearActor(env, "SUPERVISOR", "firma.super");
  cajero = await crearActor(env, "CAJERO", "firma.caja");
  await abrirTurno(env, cajero.id);
  producto = await crearProducto(env, { codigo: "FIRMA1", precioVenta: 10, stock: 500, costo: 4 });
  cliente = await env.servicios.clientes.crear({ tipoIdentificacion: "05", identificacion: "1710034065", razonSocial: "Juan Pérez", direccion: "Calle 1", email: "juan@correo.ec" });
}, 60_000);

afterAll(async () => {
  await env.cerrar();
});

describe("Carga del certificado", () => {
  it("sin certificado: la consulta lo indica y firmar falla con un mensaje claro", async () => {
    expect(await env.servicios.certificados.informacion(admin)).toMatchObject({ cargado: false, titular: null, vencido: false });
    const id = await nuevaFactura();
    expect(await codigoError(env.servicios.firma.firmarComprobante(id, supervisor))).toBe("ESTADO_INVALIDO");
    expect((await comprobante(id)).xmlFirmado).toBeNull();
  });

  it("guarda el .p12 fuera de la BD, cifra la contraseña con IV/tag propios y no la deja en claro en ningún lado", async () => {
    const { p12, entrada } = cargaDe({ cn: "EMPRESA DE PRUEBA S.A." });
    const r = await env.servicios.certificados.guardar(entrada, admin);
    expect(r.advertencias).toEqual([]);
    expect(r.certificado).toMatchObject({ cargado: true, titular: "EMPRESA DE PRUEBA S.A.", vencido: false });
    expect(r.certificado.diasRestantes).toBeGreaterThan(600);
    expect(r.certificado.emisor).toContain("CN=AC DE PRUEBA");

    const c = await configuracion();
    expect(c.certPasswordEncriptado).not.toBeNull();
    expect(Buffer.from(c.certIv as string, "base64")).toHaveLength(12);
    expect(Buffer.from(c.certTag as string, "base64")).toHaveLength(16);
    expect(c.certVencimiento).toEqual(r.certificado.vencimiento);
    // la contraseña no aparece en ninguna columna de la configuración, ni en la respuesta del servicio
    expect(JSON.stringify(c)).not.toContain(PASSWORD_P12);
    expect(JSON.stringify(r)).not.toContain(PASSWORD_P12);
    expect(JSON.stringify(r)).not.toContain("BEGIN");
    // el archivo está en la carpeta de secretos y es idéntico al cargado; la ruta guardada es solo un nombre
    expect(c.rutaCertificadoP12).toMatch(/^[0-9a-f-]+-[0-9a-f]{8}\.p12$/);
    expect(readFileSync(path.join(carpetaCertificados(), c.rutaCertificadoP12 as string)).equals(p12.archivo)).toBe(true);
    expect(archivosP12()).toHaveLength(1);
    // la clave maestra no está en la BD
    expect(existsSync(path.join(env.secretos, "master.key"))).toBe(true);
    const clave = JSON.parse(readFileSync(path.join(env.secretos, "master.key"), "utf8")) as { clave: string };
    expect(JSON.stringify(c)).not.toContain(clave.clave);
  });

  it("dos cargas cifran con IV distinto y el segundo certificado reemplaza (y borra) el archivo anterior", async () => {
    const antes = await configuracion();
    const { entrada } = cargaDe({ cn: "SEGUNDO TITULAR" });
    await env.servicios.certificados.guardar(entrada, admin);
    const despues = await configuracion();
    expect(despues.certIv).not.toBe(antes.certIv);
    expect(despues.certHuella).not.toBe(antes.certHuella);
    expect(despues.certTitular).toBe("SEGUNDO TITULAR");
    expect(archivosP12()).toEqual([despues.rutaCertificadoP12]);
  });

  it("contraseña incorrecta, archivo corrupto y datos inválidos: se rechazan sin tocar lo ya guardado", async () => {
    const antes = await configuracion();
    const { p12 } = cargaDe();
    const b64 = p12.archivo.toString("base64");
    expect(await codigoError(env.servicios.certificados.guardar({ archivoBase64: b64, password: "otra" }, admin))).toBe("VALIDACION");
    expect(await codigoError(env.servicios.certificados.guardar({ archivoBase64: Buffer.from("no es un p12").toString("base64"), password: "x" }, admin))).toBe("VALIDACION");
    expect(await codigoError(env.servicios.certificados.guardar({ archivoBase64: "###", password: "x" }, admin))).toBe("VALIDACION");
    expect(await codigoError(env.servicios.certificados.guardar({ archivoBase64: b64 }, admin))).toBe("VALIDACION");
    expect(await codigoError(env.servicios.certificados.guardar({ archivoBase64: "A".repeat(400_000), password: "x" }, admin))).toBe("VALIDACION");
    const despues = await configuracion();
    expect(despues).toEqual(antes);
    expect(archivosP12()).toEqual([antes.rutaCertificadoP12]);
  });

  it("certificado vencido, aún no vigente, de otro RUC, de clave débil: rechazados", async () => {
    const antes = await configuracion();
    const vencido = cargaDe({ desde: new Date(Date.now() - 500 * 86_400_000), vigenciaDias: 100 });
    expect(await codigoError(env.servicios.certificados.guardar(vencido.entrada, admin))).toBe("VALIDACION");
    await expect(env.servicios.certificados.guardar(vencido.entrada, admin)).rejects.toThrow(/vencido desde el/);
    await expect(env.servicios.certificados.guardar(cargaDe({ desde: new Date(Date.now() + 5 * 86_400_000) }).entrada, admin)).rejects.toThrow(/aún no es válido/);
    await expect(env.servicios.certificados.guardar(cargaDe({ identificacion: "0992345678001" }).entrada, admin)).rejects.toThrow(/no corresponde al RUC 9999999999001/);
    await expect(env.servicios.certificados.guardar(cargaDe({ identificacion: "0992345678001" }, { confirmarTitular: true }).entrada, admin)).rejects.toThrow(/no corresponde al RUC/);
    await expect(env.servicios.certificados.guardar(cargaDe({ bits: 1024 }).entrada, admin)).rejects.toThrow(/1024 bits/);
    expect(await configuracion()).toEqual(antes);
    expect(archivosP12()).toEqual([antes.rutaCertificadoP12]);
  });

  it("certificado sin identificador: exige confirmación explícita; la cédula del titular vale para el RUC de persona natural", async () => {
    const sinId = cargaDe({ identificacion: undefined as unknown as string });
    await expect(env.servicios.certificados.guardar(sinId.entrada, admin)).rejects.toThrow(/Si el titular es correcto, confírmelo/);
    const confirmado = await env.servicios.certificados.guardar({ ...sinId.entrada, confirmarTitular: true }, admin);
    expect(confirmado.certificado.cargado).toBe(true);
    // restablece uno con RUC
    await env.servicios.certificados.guardar(cargaDe().entrada, admin);
  });

  it("avisa cuando el certificado vence en 30 días o menos", async () => {
    const { entrada } = cargaDe({ desde: new Date(Date.now() - 20 * 86_400_000), vigenciaDias: 40 });
    const r = await env.servicios.certificados.guardar(entrada, admin);
    expect(r.advertencias[0]).toMatch(/vence en 1\d día/);
    expect(r.certificado.advertencia).toMatch(/vence en 1\d día/);
    await env.servicios.certificados.guardar(cargaDe().entrada, admin);
    expect((await env.servicios.certificados.informacion(admin)).advertencia).toBeNull();
  });

  it("la empresa debe tener configuración de giro", async () => {
    const otra = { id: admin.id, empresaId: "empresa-inexistente", permisos: admin.permisos };
    expect(await codigoError(env.servicios.certificados.guardar(cargaDe().entrada, otra))).toBe("NO_ENCONTRADO");
  });
});

describe("Firma de comprobantes", () => {
  it("firma la factura: guarda xmlFirmado, el estado sigue PENDIENTE, la cola y el XML generado no cambian", async () => {
    const id = await nuevaFactura();
    const antes = await comprobante(id);
    const r = await env.servicios.firma.firmarComprobante(id, supervisor);
    expect(r).toMatchObject({ id, estado: "PENDIENTE", claveAcceso: antes.claveAcceso, refirmado: false });
    expect(r.firmadoEn).toMatch(/-05:00$/);

    const despues = await comprobante(id);
    expect(despues.estado).toBe("PENDIENTE");
    expect(despues.xmlGenerado).toBe(antes.xmlGenerado);
    expect(despues.colaSRI).toEqual(antes.colaSRI);
    expect(despues.xmlFirmado).not.toBeNull();
    const firmado = despues.xmlFirmado as string;
    expect(r.huellaCertificado).toBe((await configuracion()).certHuella);
    // verificación local, esquema oficial y el contenido original intacto dentro del firmado
    expect(verificarFirmaXades(firmado)).toMatchObject({ valida: true, errores: [], huellaCertificado: r.huellaCertificado });
    expect((await xsd.validar("factura", firmado)).errores).toEqual([]);
    expect(firmado).toContain(`<claveAcceso>${antes.claveAcceso}</claveAcceso>`);
    expect(firmado.replace(/<ds:Signature[\s\S]*<\/ds:Signature>/, "").replace(/<\?xml[^>]*\?>/, "")).toContain("<infoTributaria>");
    // alterar un byte del XML firmado guardado invalida la firma
    expect(verificarFirmaXades(firmado.replace("<importeTotal>11.50</importeTotal>", "<importeTotal>11.51</importeTotal>")).valida).toBe(false);
    expect(await verificarInvariantes(env)).toEqual([]);
  });

  it("firma la nota de crédito de una factura autorizada", async () => {
    const id = await nuevaFactura();
    const factura = await comprobante(id);
    await env.prisma.comprobanteElectronico.update({ where: { id }, data: { estado: "AUTORIZADO", numeroAutorizacion: factura.claveAcceso, fechaAutorizacion: new Date() } });
    await env.prisma.colaSRI.deleteMany({ where: { comprobanteId: id } });
    const venta = await env.prisma.venta.findUniqueOrThrow({ where: { id: factura.ventaId as string } });
    await env.servicios.ventas.anular(venta.id, { motivo: "Prueba de firma" }, supervisor);
    const nc = await env.prisma.comprobanteElectronico.findFirstOrThrow({ where: { comprobanteOrigenId: id, tipoComprobante: "04" } });
    const r = await env.servicios.firma.firmarComprobante(nc.id, supervisor);
    expect(r.estado).toBe("PENDIENTE");
    const firmado = (await comprobante(nc.id)).xmlFirmado as string;
    expect(verificarFirmaXades(firmado).valida).toBe(true);
    expect((await xsd.validar("notaCredito", firmado)).errores).toEqual([]);
  });

  it("re-firmar reemplaza la firma (refirmado) sin duplicarla; también se puede en RECHAZADO y DEVUELTO", async () => {
    const id = await nuevaFactura();
    const t0 = Date.now();
    const primera = await env.servicios.firma.firmarComprobante(id, supervisor, new Date(t0 + 3_600_000));
    const segunda = await env.servicios.firma.firmarComprobante(id, supervisor, new Date(t0 + 3_605_000));
    expect(primera.refirmado).toBe(false);
    expect(segunda.refirmado).toBe(true);
    const firmado = (await comprobante(id)).xmlFirmado as string;
    expect(firmado.match(/<ds:Signature /g)).toHaveLength(1);
    expect(segunda.firmadoEn).toBe(fechaHoraIsoEcuador(new Date(t0 + 3_605_000)));
    expect(primera.firmadoEn).not.toBe(segunda.firmadoEn);
    expect(verificarFirmaXades(firmado).valida).toBe(true);

    for (const estado of ["RECHAZADO", "DEVUELTO"]) {
      await env.prisma.comprobanteElectronico.update({ where: { id }, data: { estado } });
      expect((await env.servicios.firma.firmarComprobante(id, supervisor)).estado).toBe(estado);
    }
  });

  it("no firma comprobantes EN_PROCESO, AUTORIZADOS ni ANULADOS, ni de otra empresa, ni inexistentes", async () => {
    const id = await nuevaFactura();
    for (const estado of ["EN_PROCESO", "AUTORIZADO", "ANULADO"]) {
      await env.prisma.comprobanteElectronico.update({ where: { id }, data: { estado } });
      expect(await codigoError(env.servicios.firma.firmarComprobante(id, supervisor)), estado).toBe("ESTADO_INVALIDO");
    }
    await env.prisma.comprobanteElectronico.update({ where: { id }, data: { estado: "PENDIENTE" } });
    expect(await codigoError(env.servicios.firma.firmarComprobante(id, { ...supervisor, empresaId: "otra-empresa" }))).toBe("NO_ENCONTRADO");
    expect(await codigoError(env.servicios.firma.firmarComprobante("no-existe", supervisor))).toBe("NO_ENCONTRADO");
  });

  it("no hay firma si el certificado venció (aunque estuviera vigente al cargarlo)", async () => {
    const id = await nuevaFactura();
    const futuro = new Date(Date.now() + 5 * 365 * 86_400_000);
    await expect(env.servicios.firma.firmarComprobante(id, supervisor, futuro)).rejects.toThrow(/venció el \d{4}-\d\d-\d\d/);
    expect((await comprobante(id)).xmlFirmado).toBeNull();
    expect((await env.servicios.certificados.informacion(admin, futuro))).toMatchObject({ vencido: true });
    expect((await env.servicios.certificados.informacion(admin, futuro)).advertencia).toMatch(/venció el/);
  });
});

describe("Manipulación de lo cifrado y del archivo", () => {
  const mutar = (b64: string): string => {
    const b = Buffer.from(b64, "base64");
    b[0] = (b[0] as number) ^ 0x01;
    return b.toString("base64");
  };
  let id: string;

  beforeAll(async () => {
    id = await nuevaFactura();
    await env.servicios.firma.firmarComprobante(id, supervisor); // funciona antes de manipular
  });

  it("alterar el tag, el IV o el texto cifrado en la BD impide firmar; restaurarlo lo permite", async () => {
    const original = await configuracion();
    for (const campo of ["certTag", "certIv", "certPasswordEncriptado"] as const) {
      await env.prisma.configuracionGiro.update({ where: { empresaId: env.seed.empresaId }, data: { [campo]: mutar(original[campo] as string) } });
      await expect(env.servicios.firma.firmarComprobante(id, supervisor), campo).rejects.toThrow(/No se pudo descifrar la contraseña/);
      await env.prisma.configuracionGiro.update({ where: { empresaId: env.seed.empresaId }, data: { [campo]: original[campo] } });
    }
    expect((await env.servicios.firma.firmarComprobante(id, supervisor)).refirmado).toBe(true);
  });

  it("el secreto no se puede trasladar a otra empresa (el AAD lo enlaza a su dueño)", async () => {
    const c = await configuracion();
    const otro = await env.prisma.empresa.create({ data: { ruc: "1790011223001", razonSocial: "OTRA S.A.", nombreComercial: "OTRA", direccionMatriz: "Quito", telefono: "022", email: "otra@x.ec", tipoContribuyente: "SOCIEDAD", regimenTributario: "GENERAL" } });
    await env.prisma.configuracionGiro.create({
      data: { empresaId: otro.id, giroNegocio: "RETAIL_GENERAL", rutaCertificadoP12: c.rutaCertificadoP12, certPasswordEncriptado: c.certPasswordEncriptado, certIv: c.certIv, certTag: c.certTag, certVencimiento: c.certVencimiento },
    });
    await expect(env.servicios.certificados.obtenerMaterial(otro.id)).rejects.toThrow(/No se pudo descifrar/);
    await env.prisma.configuracionGiro.delete({ where: { empresaId: otro.id } });
    await env.prisma.empresa.delete({ where: { id: otro.id } });
  });

  it("archivo .p12 ausente o reemplazado por otro certificado: error claro, nunca una firma con el equivocado", async () => {
    const c = await configuracion();
    const ruta = path.join(carpetaCertificados(), c.rutaCertificadoP12 as string);
    const original = readFileSync(ruta);
    rmSync(ruta);
    await expect(env.servicios.firma.firmarComprobante(id, supervisor)).rejects.toThrow(/No se encuentra el archivo del certificado/);
    // otro certificado válido con la MISMA contraseña (sería abrible) pero que no es el registrado
    writeFileSync(ruta, generarP12Prueba({ identificacion: RUC, password: PASSWORD_P12 }).archivo);
    await expect(env.servicios.firma.firmarComprobante(id, supervisor)).rejects.toThrow(/no corresponde al registrado/);
    writeFileSync(ruta, original);
    expect((await env.servicios.firma.firmarComprobante(id, supervisor)).refirmado).toBe(true);
  });

  it("una ruta manipulada en la BD no sale de la carpeta de certificados", async () => {
    const original = await configuracion();
    await env.prisma.configuracionGiro.update({ where: { empresaId: env.seed.empresaId }, data: { rutaCertificadoP12: "../master.key" } });
    await expect(env.servicios.certificados.obtenerMaterial(env.seed.empresaId)).rejects.toThrow(/Ruta de certificado inválida/);
    await env.prisma.configuracionGiro.update({ where: { empresaId: env.seed.empresaId }, data: { rutaCertificadoP12: original.rutaCertificadoP12 } });
  });
});

describe("Rotación de la clave maestra", () => {
  const claveActual = (): string => (JSON.parse(readFileSync(path.join(env.secretos, "master.key"), "utf8")) as { clave: string }).clave;
  const aad = (): string => `vendeya:certificado-p12:${env.seed.empresaId}`;
  const firmaFunciona = async (): Promise<void> => {
    const id = await nuevaFactura();
    expect((await env.servicios.firma.firmarComprobante(id, supervisor)).estado).toBe("PENDIENTE");
  };

  it("re-cifra la contraseña con la clave nueva y todo sigue funcionando", async () => {
    const antes = { clave: claveActual(), cfg: await configuracion() };
    expect(await env.servicios.certificados.rotarClaveMaestra()).toEqual({ recifrados: 1 });
    const despues = await configuracion();
    expect(claveActual()).not.toBe(antes.clave);
    expect(despues.certPasswordEncriptado).not.toBe(antes.cfg.certPasswordEncriptado);
    expect(despues.certIv).not.toBe(antes.cfg.certIv);
    expect(existsSync(path.join(env.secretos, "master.key.nueva"))).toBe(false);
    await firmaFunciona();
  });

  it("corte tras actualizar la BD pero antes de promover la clave nueva: se recupera sola al firmar", async () => {
    const proveedor = new ProveedorClaveMaestra({ directorio: env.secretos });
    const nueva = proveedor.prepararRotacion();
    const s = cifrarSecreto(PASSWORD_P12, nueva, aad());
    await env.prisma.configuracionGiro.update({ where: { empresaId: env.seed.empresaId }, data: { certPasswordEncriptado: s.cifrado, certIv: s.iv, certTag: s.tag } });
    expect(proveedor.hayRotacionPendiente).toBe(true);

    await firmaFunciona(); // descifra con la pendiente y la confirma
    expect(proveedor.hayRotacionPendiente).toBe(false);
    expect(existsSync(path.join(env.secretos, "master.key.nueva"))).toBe(false);
    expect(Buffer.from(claveActual(), "base64")).toEqual(nueva);
    await firmaFunciona();
  });

  it("corte antes de tocar la BD: la clave pendiente se descarta y la rotación posterior funciona", async () => {
    const proveedor = new ProveedorClaveMaestra({ directorio: env.secretos });
    const vigente = claveActual();
    proveedor.prepararRotacion();
    await firmaFunciona(); // sigue descifrando con la vigente
    expect(claveActual()).toBe(vigente);
    expect(await env.servicios.certificados.rotarClaveMaestra()).toEqual({ recifrados: 1 });
    expect(claveActual()).not.toBe(vigente);
    expect(proveedor.hayRotacionPendiente).toBe(false);
    await firmaFunciona();
  });

  it("si un secreto está alterado la rotación se aborta sin tocar nada", async () => {
    const antes = await configuracion();
    const claveAntes = claveActual();
    await env.prisma.configuracionGiro.update({ where: { empresaId: env.seed.empresaId }, data: { certTag: Buffer.alloc(16).toString("base64") } });
    await expect(env.servicios.certificados.rotarClaveMaestra()).rejects.toThrow(/No se pudo descifrar/);
    expect(claveActual()).toBe(claveAntes);
    expect(existsSync(path.join(env.secretos, "master.key.nueva"))).toBe(false);
    await env.prisma.configuracionGiro.update({ where: { empresaId: env.seed.empresaId }, data: { certTag: antes.certTag } });
    await firmaFunciona();
  });
});

describe("API de certificado y firma", () => {
  const tokens: Record<string, string> = {};
  const api = (method: "GET" | "POST" | "PUT" | "DELETE", url: string, quien: string, payload?: unknown) =>
    env.backend.server.inject({
      method, url,
      headers: { authorization: `Bearer ${tokens[quien]}` },
      ...(payload !== undefined ? { payload: payload as object } : {}),
    });

  beforeAll(async () => {
    const login = async (username: string, password: string): Promise<void> => {
      const r = await env.backend.server.inject({ method: "POST", url: "/api/auth/login", payload: { username, password } });
      tokens[username] = (r.json() as { token: string }).token;
    };
    await login("admin", PASSWORD_ADMIN);
    for (const [rol, username] of [["SUPERVISOR", "firma.api.super"], ["CONTADOR", "firma.api.conta"], ["CAJERO", "firma.api.caja"]] as const) {
      await env.servicios.usuarios.crear({ empresaId: env.seed.empresaId, rol, username, password: "Clave12345", nombre: username, apellido: "Api" });
      await login(username, "Clave12345");
    }
  });

  it("solo el administrador carga, consulta, elimina el certificado y rota la clave", async () => {
    const { entrada } = cargaDe();
    for (const quien of ["firma.api.super", "firma.api.conta", "firma.api.caja"]) {
      expect((await api("PUT", "/api/configuracion/certificado", quien, entrada)).statusCode, quien).toBe(403);
      expect((await api("GET", "/api/configuracion/certificado", quien)).statusCode, quien).toBe(403);
      expect((await api("DELETE", "/api/configuracion/certificado", quien)).statusCode, quien).toBe(403);
      expect((await api("POST", "/api/configuracion/certificado/rotar-clave", quien, {})).statusCode, quien).toBe(403);
    }
  });

  it("PUT carga el certificado; la respuesta y la consulta no contienen contraseña, clave privada ni ruta", async () => {
    const { entrada } = cargaDe({ cn: "TITULAR API" });
    const put = await api("PUT", "/api/configuracion/certificado", "admin", entrada);
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({ certificado: { cargado: true, titular: "TITULAR API", vencido: false }, advertencias: [] });
    const get = await api("GET", "/api/configuracion/certificado", "admin");
    expect(get.statusCode).toBe(200);
    expect(get.json()).toMatchObject({ cargado: true, titular: "TITULAR API" });
    for (const cuerpo of [put.body, get.body]) {
      expect(cuerpo).not.toContain(PASSWORD_P12);
      expect(cuerpo).not.toMatch(/BEGIN|\.p12|certPassword|certIv|certTag|master/i);
    }
  });

  it("PUT con datos inválidos responde 400 con un mensaje útil", async () => {
    const mala = await api("PUT", "/api/configuracion/certificado", "admin", { ...cargaDe().entrada, password: "incorrecta" });
    expect(mala.statusCode).toBe(400);
    expect(mala.json()).toMatchObject({ error: "VALIDACION" });
    expect(mala.json<{ mensaje: string }>().mensaje).toMatch(/contraseña es incorrecta/);
    expect((await api("PUT", "/api/configuracion/certificado", "admin", {})).statusCode).toBe(400);
    const ajeno = await api("PUT", "/api/configuracion/certificado", "admin", cargaDe({ identificacion: "0992345678001" }).entrada);
    expect(ajeno.statusCode).toBe(400);
    expect(ajeno.json<{ mensaje: string }>().mensaje).toMatch(/no corresponde al RUC/);
    expect(ajeno.body).not.toContain(PASSWORD_P12);
  });

  it("POST /comprobantes/:id/firmar: supervisor sí, cajero y contador no; 404 y 409 con sus códigos", async () => {
    const id = await nuevaFactura();
    expect((await api("POST", `/api/comprobantes/${id}/firmar`, "firma.api.caja", {})).statusCode).toBe(403);
    expect((await api("POST", `/api/comprobantes/${id}/firmar`, "firma.api.conta", {})).statusCode).toBe(403);

    const ok = await api("POST", `/api/comprobantes/${id}/firmar`, "firma.api.super", {});
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ id, estado: "PENDIENTE", refirmado: false });
    expect(ok.json<{ firmadoEn: string }>().firmadoEn).toMatch(/-05:00$/);
    expect(ok.body).not.toContain("<ds:Signature"); // no devuelve el XML, solo el resultado

    const detalle = await api("GET", `/api/comprobantes/${id}`, "firma.api.conta");
    expect(verificarFirmaXades(detalle.json<{ xmlFirmado: string }>().xmlFirmado).valida).toBe(true);

    expect((await api("POST", "/api/comprobantes/no-existe/firmar", "firma.api.super", {})).statusCode).toBe(404);
    await env.prisma.comprobanteElectronico.update({ where: { id }, data: { estado: "AUTORIZADO" } });
    const conflicto = await api("POST", `/api/comprobantes/${id}/firmar`, "firma.api.super", {});
    expect(conflicto.statusCode).toBe(409);
    expect(conflicto.json()).toMatchObject({ error: "ESTADO_INVALIDO" });
  });

  it("POST rotar-clave y DELETE: eliminar borra el archivo y deja a la empresa sin certificado", async () => {
    const rot = await api("POST", "/api/configuracion/certificado/rotar-clave", "admin", {});
    expect(rot.statusCode).toBe(200);
    expect(rot.json()).toEqual({ recifrados: 1 });

    const id = await nuevaFactura();
    expect((await api("POST", `/api/comprobantes/${id}/firmar`, "firma.api.super", {})).statusCode).toBe(200);

    const del = await api("DELETE", "/api/configuracion/certificado", "admin");
    expect(del.statusCode).toBe(204);
    expect(archivosP12()).toEqual([]);
    expect((await api("GET", "/api/configuracion/certificado", "admin")).json()).toMatchObject({ cargado: false });
    const c = await configuracion();
    expect([c.rutaCertificadoP12, c.certPasswordEncriptado, c.certIv, c.certTag, c.certVencimiento, c.certHuella]).toEqual([null, null, null, null, null, null]);
    expect((await api("DELETE", "/api/configuracion/certificado", "admin")).statusCode).toBe(404);
    const sin = await api("POST", `/api/comprobantes/${id}/firmar`, "firma.api.super", {});
    expect(sin.statusCode).toBe(409);
    expect(sin.json<{ mensaje: string }>().mensaje).toMatch(/no tiene un certificado/);
  });

  it("la clave maestra del entorno no se puede rotar desde la API", async () => {
    process.env["VENDEYA_CLAVE_MAESTRA"] = Buffer.alloc(32, 7).toString("base64");
    try {
      const r = await api("POST", "/api/configuracion/certificado/rotar-clave", "admin", {});
      expect(r.statusCode).toBe(409);
      expect(r.json<{ mensaje: string }>().mensaje).toMatch(/entorno/);
    } finally {
      delete process.env["VENDEYA_CLAVE_MAESTRA"];
    }
  });
});

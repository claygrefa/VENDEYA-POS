// @vitest-environment jsdom
// ============================================================
// tests/unit/renderer/servicios.test.ts — Cliente HTTP, cálculos de pantalla y carrito
// ============================================================
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiCliente, ApiError, consulta } from "../../../src/renderer/services/api";
import { calcularCarrito, cantidadTexto, dinero, porcentajeIvaDe, resumirPagos, type LineaCarrito } from "../../../src/renderer/services/totales";
import { useCarrito } from "../../../src/renderer/store/carrito.store";
import { tienePermiso, useSesion } from "../../../src/renderer/store/sesion.store";
import { ARROZ, CAFE, QUESO, USUARIO } from "../../helpers/renderer/entorno";

const respuesta = (status: number, cuerpo?: unknown): Response => new Response(status === 204 ? null : JSON.stringify(cuerpo ?? {}), { status });

describe("ApiCliente", () => {
  it("envía el token y la caja, serializa el cuerpo y devuelve el JSON", async () => {
    const fetchFn = vi.fn(async () => respuesta(200, { ok: 1 }));
    const api = new ApiCliente({ baseUrl: "http://srv", cajaId: "caja-7", obtenerToken: () => "tok", fetchFn: fetchFn as unknown as typeof fetch });
    expect(await api.post("/api/x", { a: 1 })).toEqual({ ok: 1 });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://srv/api/x");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ authorization: "Bearer tok", "x-caja-id": "caja-7", "content-type": "application/json" });
    expect(init.body).toBe('{"a":1}');
  });

  it("sin token no envía autorización; un 204 devuelve undefined", async () => {
    const fetchFn = vi.fn(async () => respuesta(204));
    const api = new ApiCliente({ baseUrl: "http://srv", cajaId: "c", obtenerToken: () => null, fetchFn: fetchFn as unknown as typeof fetch });
    expect(await api.get("/api/y")).toBeUndefined();
    expect((fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].headers).not.toHaveProperty("authorization");
  });

  it("los errores del dominio llegan con su código, mensaje y estado", async () => {
    const api = new ApiCliente({ baseUrl: "http://srv", cajaId: "c", obtenerToken: () => "t", fetchFn: (async () => respuesta(409, { error: "STOCK_INSUFICIENTE", mensaje: "Stock insuficiente de Café" })) as unknown as typeof fetch });
    const e = await api.get("/api/z").catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ codigo: "STOCK_INSUFICIENTE", message: "Stock insuficiente de Café", status: 409 });
  });

  it("sin red: SIN_CONEXION; respuesta sin JSON: ERROR_INTERNO con el estado", async () => {
    const caida = new ApiCliente({ baseUrl: "http://srv", cajaId: "c", obtenerToken: () => null, fetchFn: (async () => Promise.reject(new TypeError("fetch failed"))) as unknown as typeof fetch });
    await expect(caida.get("/api/x")).rejects.toMatchObject({ codigo: "SIN_CONEXION", status: 0 });
    const rota = new ApiCliente({ baseUrl: "http://srv", cajaId: "c", obtenerToken: () => null, fetchFn: (async () => new Response("<html>", { status: 502 })) as unknown as typeof fetch });
    await expect(rota.get("/api/x")).rejects.toMatchObject({ codigo: "ERROR_INTERNO", status: 502 });
  });

  it("un 401 con una sesión activa avisa para volver a pedir el ingreso; sin sesión no (es un login fallido)", async () => {
    const alNoAutenticado = vi.fn();
    const f = (async () => respuesta(401, { error: "CREDENCIALES_INVALIDAS", mensaje: "Usuario o contraseña incorrectos" })) as unknown as typeof fetch;
    await new ApiCliente({ baseUrl: "h", cajaId: "c", obtenerToken: () => null, alNoAutenticado, fetchFn: f }).post("/api/auth/login").catch(() => undefined);
    expect(alNoAutenticado).not.toHaveBeenCalled();
    await new ApiCliente({ baseUrl: "h", cajaId: "c", obtenerToken: () => "viejo", alNoAutenticado, fetchFn: f }).get("/api/x").catch(() => undefined);
    expect(alNoAutenticado).toHaveBeenCalledTimes(1);
  });

  it("consulta() arma el query string solo con lo presente", () => {
    expect(consulta({ search: "café & té", pageSize: 24, vacio: "", nada: undefined })).toBe("?search=caf%C3%A9+%26+t%C3%A9&pageSize=24");
    expect(consulta({})).toBe("");
  });
});

const linea = (extra: Partial<LineaCarrito> = {}): LineaCarrito => ({
  clave: "l1", productoId: "p", presentacionId: null, codigo: "C", nombre: "N", unidad: "UN", permiteDecimales: false, cantidad: 1, precioUnitario: 10, porcentajeIva: 15, descuento: 0, tipoDescuento: "VALOR", ...extra,
});

describe("Cálculo del carrito", () => {
  it("IVA por tarifa: asignada al producto, la de su código SRI o ninguna", () => {
    expect(porcentajeIvaDe(CAFE)).toBe(15);
    expect(porcentajeIvaDe(ARROZ)).toBe(0);
    expect(porcentajeIvaDe({ ...CAFE, tarifaImpuesto: { porcentaje: 5 } })).toBe(5);
    expect(porcentajeIvaDe({ ...CAFE, codigoIvaSRI: "5" })).toBe(5);
    expect(porcentajeIvaDe({ ...CAFE, codigoIvaSRI: "99" })).toBe(0);
  });

  it("totales con descuento por valor y por porcentaje, y desglose de IVA por tarifa", () => {
    const c = calcularCarrito([
      linea({ clave: "a", cantidad: 2, precioUnitario: 10 }), // 20 + 3
      linea({ clave: "b", cantidad: 1, precioUnitario: 4, porcentajeIva: 0 }), // 4 + 0
      linea({ clave: "c", cantidad: 3, precioUnitario: 10, descuento: 10, tipoDescuento: "PORCENTAJE", porcentajeIva: 5 }), // 27 + 1.35
    ]);
    expect(c.totales).toEqual({ subtotal: 51, descuento: 3, iva: 4.35, total: 55.35 });
    expect(c.ivaPorTarifa).toEqual([{ porcentaje: 0, base: 4, iva: 0 }, { porcentaje: 5, base: 27, iva: 1.35 }, { porcentaje: 15, base: 20, iva: 3 }]);
    expect(c.hayErrores).toBe(false);
  });

  it("un descuento mayor que la línea marca el error y no entra en los totales", () => {
    const c = calcularCarrito([linea({ clave: "a" }), linea({ clave: "b", descuento: 50 }), linea({ clave: "c", descuento: 150, tipoDescuento: "PORCENTAJE" })]);
    expect(c.hayErrores).toBe(true);
    expect(c.lineas[1]).toBeNull();
    expect(c.lineas[2]).toBeNull();
    expect(c.totales.total).toBe(11.5);
  });

  it("carrito vacío: todo en cero", () => {
    expect(calcularCarrito([])).toMatchObject({ totales: { subtotal: 0, descuento: 0, iva: 0, total: 0 }, hayErrores: false, ivaPorTarifa: [] });
  });

  it("formato de dinero y cantidades", () => {
    expect(dinero(1234.5)).toMatch(/1[.,\s]?234[.,]50/);
    expect(dinero(0.005)).toMatch(/0[.,]01/);
    expect(cantidadTexto(2)).toBe("2");
    expect(cantidadTexto(1.2345)).toBe("1.235");
  });
});

describe("Resumen de pagos (cambio y faltante)", () => {
  it("pago exacto, parcial y con cambio en efectivo", () => {
    expect(resumirPagos(23, [{ formaPago: "TARJETA_CREDITO", monto: 23 }])).toEqual({ pagado: 23, falta: 0, cambio: 0, excedenteInvalido: false });
    expect(resumirPagos(23, [{ formaPago: "EFECTIVO", monto: 10 }])).toEqual({ pagado: 10, falta: 13, cambio: 0, excedenteInvalido: false });
    expect(resumirPagos(23, [{ formaPago: "EFECTIVO", monto: 30 }])).toEqual({ pagado: 30, falta: 0, cambio: 7, excedenteInvalido: false });
  });

  it("pago mixto: el cambio sale del efectivo; si el excedente no es devolvible se marca inválido", () => {
    expect(resumirPagos(23, [{ formaPago: "TARJETA_DEBITO", monto: 15 }, { formaPago: "EFECTIVO", monto: 10 }])).toMatchObject({ falta: 0, cambio: 2 });
    expect(resumirPagos(23, [{ formaPago: "TARJETA_CREDITO", monto: 30 }])).toMatchObject({ falta: 0, excedenteInvalido: true });
    expect(resumirPagos(23, [{ formaPago: "TARJETA_CREDITO", monto: 20 }, { formaPago: "EFECTIVO", monto: 2 }])).toMatchObject({ falta: 1 });
  });
});

describe("Carrito (store)", () => {
  beforeEach(() => useCarrito.setState({ lineas: [], cliente: null }));

  it("agregar el mismo producto suma la cantidad; productos distintos son líneas distintas", () => {
    const { agregar } = useCarrito.getState();
    agregar({ producto: CAFE });
    agregar({ producto: CAFE });
    agregar({ producto: ARROZ, cantidad: 3 });
    const l = useCarrito.getState().lineas;
    expect(l).toHaveLength(2);
    expect(l[0]).toMatchObject({ productoId: CAFE.id, cantidad: 2, precioUnitario: 10, porcentajeIva: 15, unidad: "UN" });
    expect(l[1]).toMatchObject({ productoId: ARROZ.id, cantidad: 3, porcentajeIva: 0 });
  });

  it("presentaciones: línea propia con el precio de la presentación o el del producto por su factor", () => {
    const { agregar } = useCarrito.getState();
    agregar({ producto: CAFE, presentacion: { id: "pr1", nombre: "Caja x12", factor: 12, precioVenta: null } });
    agregar({ producto: CAFE, presentacion: { id: "pr2", nombre: "Paquete x6", factor: 6, precioVenta: 55 } });
    agregar({ producto: CAFE });
    const l = useCarrito.getState().lineas;
    expect(l.map((x) => [x.nombre, x.precioUnitario, x.presentacionId])).toEqual([
      ["Café molido 250g — Caja x12", 120, "pr1"],
      ["Café molido 250g — Paquete x6", 55, "pr2"],
      ["Café molido 250g", 10, null],
    ]);
  });

  it("cantidad, descuento, quitar, cantidad cero elimina, cliente y vaciar", () => {
    const s = useCarrito.getState();
    const k = s.agregar({ producto: QUESO, cantidad: 1.25 });
    expect(useCarrito.getState().lineas[0]).toMatchObject({ cantidad: 1.25, permiteDecimales: true, unidad: "KG" });
    s.fijarCantidad(k, 2.5);
    s.fijarDescuento(k, 10, "PORCENTAJE");
    expect(useCarrito.getState().lineas[0]).toMatchObject({ cantidad: 2.5, descuento: 10, tipoDescuento: "PORCENTAJE" });
    s.fijarDescuento(k, -5, "VALOR");
    expect(useCarrito.getState().lineas[0]?.descuento).toBe(0);
    s.fijarCliente({ id: "c1", tipoIdentificacion: "05", identificacion: "1710034065", razonSocial: "Juan" });
    expect(useCarrito.getState().cliente?.razonSocial).toBe("Juan");
    s.fijarCantidad(k, 0);
    expect(useCarrito.getState().lineas).toEqual([]);
    useCarrito.getState().agregar({ producto: CAFE });
    useCarrito.getState().vaciar();
    expect(useCarrito.getState()).toMatchObject({ lineas: [], cliente: null });
  });

  it("una línea con descuento no se mezcla con la misma sin descuento", () => {
    const s = useCarrito.getState();
    const k = s.agregar({ producto: CAFE });
    s.fijarDescuento(k, 1, "VALOR");
    s.agregar({ producto: CAFE });
    expect(useCarrito.getState().lineas).toHaveLength(2);
  });
});

describe("Sesión (store)", () => {
  it("permisos del usuario y modo táctil que se recuerda", () => {
    expect(tienePermiso(USUARIO, "ventas:crear")).toBe(true);
    expect(tienePermiso(USUARIO, "sri:crear")).toBe(false);
    expect(tienePermiso(null, "ventas:crear")).toBe(false);
    useSesion.setState({ modoTactil: false });
    useSesion.getState().alternarTactil();
    expect(useSesion.getState().modoTactil).toBe(true);
    expect(localStorage.getItem("vendeya.modoTactil")).toBe("1");
    useSesion.getState().alternarTactil();
    expect(localStorage.getItem("vendeya.modoTactil")).toBe("0");
  });

  it("cerrar sesión borra usuario, turno y punto de emisión", () => {
    useSesion.getState().iniciar("t", USUARIO);
    expect(useSesion.getState()).toMatchObject({ token: "t", turno: null });
    useSesion.getState().cerrar();
    expect(useSesion.getState()).toMatchObject({ token: null, usuario: null, turno: null, puntoEmision: null });
  });
});

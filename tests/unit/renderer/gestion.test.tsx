// @vitest-environment jsdom
// ============================================================
// tests/unit/renderer/gestion.test.tsx — Vistas de gestión: menú por rol, inventario, clientes, compras, caja, reportes y SRI
// ============================================================
import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSesion } from "../../../src/renderer/store/sesion.store";
import { ApiSimulada, CAFE, PUNTO, TURNO, renderizarPos, servidorBasico, usuarioDe } from "../../helpers/renderer/entorno";

const dineroRx = (n: string): RegExp => new RegExp(n.replace(".", "[.,]"));
const paginado = <T,>(items: T[]) => ({ cuerpo: { items, total: items.length, page: 1, pageSize: 15 } });

let descargas: Array<{ nombre: string }>;
beforeEach(() => {
  descargas = [];
  URL.createObjectURL = vi.fn(() => "blob:prueba");
  URL.revokeObjectURL = vi.fn();
  // El enlace de descarga se intercepta: jsdom no navega
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    descargas.push({ nombre: this.download });
  });
});

const PRODUCTO_G = { ...CAFE, stockMinimo: 5, precioCompra: 4, categoriaId: "c1", unidadMedidaId: "u1", requiereLote: false, tieneVencimiento: false, status: "ACTIVO" };

function servidor(): ApiSimulada {
  return servidorBasico(new ApiSimulada())
    .en("GET /api/catalogos", { cuerpo: { categorias: [{ id: "c1", nombre: "General" }, { id: "c2", nombre: "Bebidas" }], unidades: [{ id: "u1", codigo: "UN", nombre: "Unidad", permiteDecimales: false }, { id: "u2", codigo: "KG", nombre: "Kilogramo", permiteDecimales: true }] } })
    .en("GET /api/turnos/actual", { cuerpo: TURNO });
}

describe("Menú según el rol", () => {
  it("el cajero ve Venta, Caja y Clientes; no Inventario, Compras, Reportes ni Comprobantes", async () => {
    renderizarPos({ api: servidor() });
    const menu = await screen.findByRole("navigation", { name: "Menú principal" });
    expect(within(menu).getAllByRole("button").map((b) => b.textContent)).toEqual(["Venta", "Caja", "Clientes"]);
  });

  it("el supervisor ve todas las vistas; el bodeguero y el contador entran sin turno directo a las suyas", async () => {
    const a = renderizarPos({ api: servidor(), usuario: usuarioDe("SUPERVISOR") });
    expect(within(await screen.findByRole("navigation", { name: "Menú principal" })).getAllByRole("button").map((b) => b.textContent)).toEqual(["Venta", "Caja", "Clientes", "Inventario", "Compras", "Reportes", "Comprobantes SRI"]);
    a.unmount();

    const b = renderizarPos({ api: servidor(), usuario: usuarioDe("BODEGUERO"), sinTurno: true });
    expect(await screen.findByRole("region", { name: "Inventario" })).toBeInTheDocument(); // sin pedir apertura de turno
    expect(within(screen.getByRole("navigation", { name: "Menú principal" })).getAllByRole("button").map((x) => x.textContent)).toEqual(["Inventario", "Compras"]);
    b.unmount();

    renderizarPos({ api: servidor(), usuario: usuarioDe("CONTADOR"), sinTurno: true });
    expect(await screen.findByRole("region", { name: "Reportes" })).toBeInTheDocument();
    expect(within(screen.getByRole("navigation", { name: "Menú principal" })).getAllByRole("button").map((x) => x.textContent)).toEqual(["Reportes", "Comprobantes SRI"]);
  });

  it("Ctrl+número y los botones cambian de vista; un número fuera del menú no hace nada", async () => {
    const { usuario } = renderizarPos({ api: servidor(), usuario: usuarioDe("SUPERVISOR") });
    await screen.findByLabelText("Buscar producto");
    await usuario.keyboard("{Control>}2{/Control}");
    expect(await screen.findByRole("region", { name: "Caja" })).toBeInTheDocument();
    await usuario.keyboard("{Control>}4{/Control}");
    expect(await screen.findByRole("region", { name: "Inventario" })).toBeInTheDocument();
    await usuario.keyboard("{Control>}9{/Control}");
    expect(screen.getByRole("region", { name: "Inventario" })).toBeInTheDocument();
    await usuario.click(screen.getByRole("button", { name: "Venta" }));
    expect(await screen.findByLabelText("Buscar producto")).toBeInTheDocument();
  });

  it("el carrito se conserva al cambiar de vista", async () => {
    const { usuario } = renderizarPos({ api: servidor() });
    await usuario.click(await screen.findByRole("button", { name: "Agregar Arroz 1kg" }));
    await usuario.click(screen.getByRole("button", { name: "Clientes" }));
    await screen.findByRole("region", { name: "Clientes" });
    await usuario.click(screen.getByRole("button", { name: "Venta" }));
    expect(await screen.findByLabelText("Cantidad de Arroz 1kg")).toBeInTheDocument();
  });
});

describe("Inventario", () => {
  const abrir = async (api: ApiSimulada) => {
    const r = renderizarPos({ api, usuario: usuarioDe("SUPERVISOR") });
    await r.usuario.click(await screen.findByRole("button", { name: "Inventario" }));
    await screen.findByRole("table", { name: "Productos" });
    return r;
  };

  it("lista, busca en el servidor y marca en ámbar lo que está en el mínimo", async () => {
    const api = servidor().en("GET /api/productos", (p) => paginado(p.parametros.get("search") === "caf" ? [PRODUCTO_G] : [PRODUCTO_G, { ...PRODUCTO_G, id: "x2", codigo: "OTRO", nombre: "Otro producto", stockActual: 3 }]));
    const { usuario } = await abrir(api);
    const tabla = screen.getByRole("table", { name: "Productos" });
    expect(within(tabla).getAllByRole("row")).toHaveLength(3);
    expect(within(tabla).getByText("3 UN")).toHaveClass("text-amber-300");
    await usuario.type(screen.getByLabelText("Buscar producto"), "caf");
    await waitFor(() => expect(within(screen.getByRole("table", { name: "Productos" })).getAllByRole("row")).toHaveLength(2));
  });

  it("nuevo producto: valida, envía los datos al servidor y refresca; los errores del servidor se muestran", async () => {
    const api = servidor().en("GET /api/productos", paginado([PRODUCTO_G])).en("POST /api/productos", { status: 201, cuerpo: PRODUCTO_G });
    const { usuario } = await abrir(api);
    await usuario.click(screen.getByRole("button", { name: "Nuevo producto" }));
    const d = await screen.findByRole("dialog", { name: "Nuevo producto" });
    await usuario.type(within(d).getByLabelText("Código"), "NUEVO1");
    await usuario.type(within(d).getByLabelText("Nombre"), "Producto nuevo");
    await usuario.click(within(d).getByRole("button", { name: "Guardar" }));
    expect(await within(d).findByRole("alert")).toHaveTextContent("El precio de venta debe ser mayor que cero");

    await usuario.type(within(d).getByLabelText("Precio de venta (sin IVA)"), "12.5");
    await usuario.type(within(d).getByLabelText("Código de barras"), "7860001112223");
    await usuario.clear(within(d).getByLabelText("Costo de compra"));
    await usuario.type(within(d).getByLabelText("Costo de compra"), "7");
    await usuario.click(within(d).getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(api.llamadasA("POST /api/productos")).toHaveLength(1));
    expect(api.llamadasA("POST /api/productos")[0]?.cuerpo).toMatchObject({ codigo: "NUEVO1", codigoBarras: "7860001112223", nombre: "Producto nuevo", tipo: "BIEN", categoriaId: "c1", unidadMedidaId: "u1", precioCompra: 7, precioVenta: 12.5, aplicaIva: true, codigoIvaSRI: "4", stockMinimo: 0 });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    api.en("POST /api/productos", { status: 409, cuerpo: { error: "DUPLICADO", mensaje: "Ya existe un producto con el código NUEVO1" } });
    await usuario.click(screen.getByRole("button", { name: "Nuevo producto" }));
    const d2 = await screen.findByRole("dialog", { name: "Nuevo producto" });
    await usuario.type(within(d2).getByLabelText("Código"), "NUEVO1");
    await usuario.type(within(d2).getByLabelText("Nombre"), "Producto nuevo");
    await usuario.type(within(d2).getByLabelText("Precio de venta (sin IVA)"), "5");
    await usuario.click(within(d2).getByRole("button", { name: "Guardar" }));
    expect(await within(d2).findByRole("alert")).toHaveTextContent("Ya existe un producto con el código NUEVO1");
  });

  it("editar manda un PATCH con los datos cambiados; sin IVA, el código SRI es 0", async () => {
    const api = servidor().en("GET /api/productos", paginado([PRODUCTO_G])).en(`PATCH /api/productos/${PRODUCTO_G.id}`, { cuerpo: PRODUCTO_G });
    const { usuario } = await abrir(api);
    await usuario.click(screen.getByRole("button", { name: "Editar Café molido 250g" }));
    const d = await screen.findByRole("dialog", { name: "Editar Café molido 250g" });
    expect(within(d).getByLabelText("Código")).toHaveValue("CAFE");
    await usuario.clear(within(d).getByLabelText("Precio de venta (sin IVA)"));
    await usuario.type(within(d).getByLabelText("Precio de venta (sin IVA)"), "11");
    await usuario.click(within(d).getByRole("checkbox", { name: "Aplica IVA" }));
    await usuario.click(within(d).getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(api.llamadasA(`PATCH /api/productos/${PRODUCTO_G.id}`)).toHaveLength(1));
    expect(api.llamadasA(`PATCH /api/productos/${PRODUCTO_G.id}`)[0]?.cuerpo).toMatchObject({ precioVenta: 11, aplicaIva: false, codigoIvaSRI: "0", codigo: "CAFE" });
  });

  it("ajuste de inventario: motivo obligatorio, costo solo en entradas y mensaje del servidor", async () => {
    const api = servidor().en("GET /api/productos", paginado([PRODUCTO_G])).en("POST /api/inventario/ajustes", { status: 201, cuerpo: {} });
    const { usuario } = await abrir(api);
    await usuario.click(screen.getByRole("button", { name: "Ajustar Café molido 250g" }));
    const d = await screen.findByRole("dialog", { name: "Ajuste de Café molido 250g" });
    await usuario.type(within(d).getByLabelText("Cantidad"), "3");
    await usuario.selectOptions(within(d).getByLabelText("Tipo de ajuste"), "SALIDA");
    expect(within(d).queryByLabelText("Costo unitario")).not.toBeInTheDocument();
    await usuario.type(within(d).getByLabelText("Motivo"), "Rotura");
    api.en("POST /api/inventario/ajustes", { status: 400, cuerpo: { error: "VALIDACION", mensaje: "motivo: El motivo debe tener al menos 5 caracteres" } });
    await usuario.click(within(d).getByRole("button", { name: "Registrar ajuste" }));
    expect(await within(d).findByRole("alert")).toHaveTextContent("al menos 5 caracteres");

    await usuario.type(within(d).getByLabelText("Motivo"), " en bodega");
    api.en("POST /api/inventario/ajustes", { status: 201, cuerpo: {} });
    await usuario.click(within(d).getByRole("button", { name: "Registrar ajuste" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.llamadasA("POST /api/inventario/ajustes").at(-1)?.cuerpo).toEqual({ productoId: PRODUCTO_G.id, tipo: "SALIDA", cantidad: 3, motivo: "Rotura en bodega" });
  });

  it("kardex del producto con existencia, costo promedio y movimientos", async () => {
    const api = servidor().en("GET /api/productos", paginado([PRODUCTO_G])).en(`GET /api/inventario/productos/${PRODUCTO_G.id}/kardex`, {
      cuerpo: { producto: { nombre: PRODUCTO_G.nombre, stockActual: 47, costoPromedio: 4.2 }, total: 2, page: 1, pageSize: 10, items: [
        { id: "m1", fecha: "2026-11-20T15:00:00.000Z", tipoMovimiento: "COMPRA", cantidad: 50, costoUnitario: 4, stockResultante: 50, observacion: "Compra 001-001-000000777" },
        { id: "m2", fecha: "2026-11-21T15:00:00.000Z", tipoMovimiento: "AJUSTE_SALIDA", cantidad: 3, costoUnitario: 4, stockResultante: 47, observacion: "Rotura" },
      ] },
    });
    const { usuario } = await abrir(api);
    await usuario.click(screen.getByRole("button", { name: "Kardex Café molido 250g" }));
    const d = await screen.findByRole("dialog", { name: "Kardex de Café molido 250g" });
    expect(await within(d).findByText("COMPRA")).toBeInTheDocument();
    expect(within(d).getByText("AJUSTE SALIDA")).toBeInTheDocument();
    expect(d).toHaveTextContent(dineroRx("4.20"));
    expect(within(d).getAllByRole("row")).toHaveLength(3);
  });

  it("alertas: stock bajo y lotes vencidos / por vencer", async () => {
    const api = servidor().en("GET /api/productos", paginado([PRODUCTO_G]))
      .en("GET /api/inventario/alertas-stock", { cuerpo: { total: 1, items: [{ productoId: "p", codigo: "ARROZ", nombre: "Arroz 1kg", stockActual: 2, stockMinimo: 10, faltante: 8 }] } })
      .en("GET /api/inventario/alertas-vencimiento", { cuerpo: { dias: 30, vencidos: [{ loteId: "l1", numeroLote: "L-01", codigo: "AMOX", nombre: "Amoxicilina", cantidadActual: 4, fechaVencimiento: "2026-11-01T00:00:00.000Z", diasRestantes: -23 }], porVencer: [{ loteId: "l2", numeroLote: "L-02", codigo: "PARA", nombre: "Paracetamol", cantidadActual: 20, fechaVencimiento: "2026-12-10T00:00:00.000Z", diasRestantes: 16 }] } });
    const { usuario } = await abrir(api);
    await usuario.click(screen.getByRole("tab", { name: "Alertas" }));
    expect(await screen.findByText("Vencido hace 23 día(s)")).toBeInTheDocument();
    expect(screen.getByText("Vence en 16 día(s)")).toBeInTheDocument();
    expect(within(screen.getByRole("table", { name: "Productos bajo el mínimo" })).getByText("Arroz 1kg")).toBeInTheDocument();
  });

  it("el rol sin inventario:crear no ve «Nuevo producto»", async () => {
    const usuarioSolo = { ...usuarioDe("BODEGUERO"), permisos: ["inventario:leer", "inventario:actualizar"] };
    const r = renderizarPos({ api: servidor().en("GET /api/productos", paginado([PRODUCTO_G])), usuario: usuarioSolo, sinTurno: true });
    await r.usuario.click(await screen.findByRole("button", { name: "Inventario" }));
    await screen.findByRole("table", { name: "Productos" });
    expect(screen.queryByRole("button", { name: "Nuevo producto" })).not.toBeInTheDocument();
  });
});

describe("Clientes y cuentas por cobrar", () => {
  const CLIENTE = { id: "c1", tipoIdentificacion: "05", identificacion: "1710034065", razonSocial: "Juan Pérez", email: null, telefono: "0999999999", direccion: null, limiteCredito: 500, diasCredito: 30, descuentoHabitual: 0 };
  const CF = { ...CLIENTE, id: "cf", tipoIdentificacion: "07", identificacion: "9999999999999", razonSocial: "CONSUMIDOR FINAL", limiteCredito: 0, diasCredito: 0 };

  it("el cajero da de alta pero no edita; el supervisor edita; el Consumidor Final no se edita", async () => {
    const api = servidor().en("GET /api/clientes", paginado([CF, CLIENTE])).en("POST /api/clientes", { status: 201, cuerpo: CLIENTE });
    const caja = renderizarPos({ api, usuario: usuarioDe("CAJERO") });
    await caja.usuario.click(await screen.findByRole("button", { name: "Clientes" }));
    await screen.findByRole("table", { name: "Clientes" });
    expect(screen.getByRole("button", { name: "Nuevo cliente" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Editar/ })).not.toBeInTheDocument();
    caja.unmount();

    const sup = renderizarPos({ api, usuario: usuarioDe("SUPERVISOR") });
    await sup.usuario.click(await screen.findByRole("button", { name: "Clientes" }));
    await screen.findByRole("table", { name: "Clientes" });
    expect(screen.getAllByRole("button", { name: /^Editar/ })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Editar Juan Pérez" })).toBeInTheDocument();
  });

  it("alta de cliente: envía los datos limpios y muestra el error de validación del servidor (cédula inválida)", async () => {
    const api = servidor().en("GET /api/clientes", paginado([CLIENTE])).en("POST /api/clientes", { status: 400, cuerpo: { error: "VALIDACION", mensaje: "identificacion: Cédula ecuatoriana inválida" } });
    const { usuario } = renderizarPos({ api, usuario: usuarioDe("CAJERO") });
    await usuario.click(await screen.findByRole("button", { name: "Clientes" }));
    await usuario.click(await screen.findByRole("button", { name: "Nuevo cliente" }));
    const d = await screen.findByRole("dialog", { name: "Nuevo cliente" });
    await usuario.type(within(d).getByLabelText("Identificación"), "1234567890");
    await usuario.type(within(d).getByLabelText("Razón social"), "María Zambrano");
    await usuario.type(within(d).getByLabelText("Teléfono"), "0988888888");
    await usuario.click(within(d).getByRole("button", { name: "Guardar" }));
    expect(await within(d).findByRole("alert")).toHaveTextContent("Cédula ecuatoriana inválida");
    expect(api.llamadasA("POST /api/clientes")[0]?.cuerpo).toEqual({ tipoIdentificacion: "05", identificacion: "1234567890", razonSocial: "María Zambrano", limiteCredito: 0, diasCredito: 0, descuentoHabitual: 0, email: null, telefono: "0988888888", direccion: null });

    api.en("POST /api/clientes", { status: 201, cuerpo: CLIENTE });
    await usuario.clear(within(d).getByLabelText("Identificación"));
    await usuario.type(within(d).getByLabelText("Identificación"), "0926687856");
    await usuario.click(within(d).getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("cuentas por cobrar: abono con validación contra el saldo y filtro de vencidas", async () => {
    const cuenta = { id: "cc1", montoTotal: 50, saldo: 30, fechaVencimiento: "2026-12-01T00:00:00.000Z", estado: "PARCIAL", cliente: { id: "c1", razonSocial: "Juan Pérez" }, venta: { numero: "001-001-000000042" } };
    const api = servidor().en("GET /api/clientes", paginado([CLIENTE])).en("GET /api/cuentas-por-cobrar", paginado([cuenta])).en("POST /api/cuentas-por-cobrar/cc1/abonos", { status: 201, cuerpo: cuenta });
    const { usuario } = renderizarPos({ api });
    await usuario.click(await screen.findByRole("button", { name: "Clientes" }));
    await usuario.click(await screen.findByRole("tab", { name: "Cuentas por cobrar" }));
    await screen.findByRole("table", { name: "Cuentas por cobrar" });
    await usuario.click(screen.getByRole("button", { name: "Abonar 001-001-000000042" }));
    const d = await screen.findByRole("dialog", { name: "Abono a Juan Pérez" });
    expect(within(d).getByLabelText("Monto")).toHaveValue(30);
    await usuario.clear(within(d).getByLabelText("Monto"));
    await usuario.type(within(d).getByLabelText("Monto"), "45");
    await usuario.click(within(d).getByRole("button", { name: "Registrar" }));
    expect(await within(d).findByRole("alert")).toHaveTextContent(/supera el saldo/);
    await usuario.clear(within(d).getByLabelText("Monto"));
    await usuario.type(within(d).getByLabelText("Monto"), "12.5");
    await usuario.selectOptions(within(d).getByLabelText("Forma de pago"), "TRANSFERENCIA");
    await usuario.type(within(d).getByLabelText("Referencia"), "TRX-9");
    await usuario.click(within(d).getByRole("button", { name: "Registrar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.llamadasA("POST /api/cuentas-por-cobrar/cc1/abonos")[0]?.cuerpo).toEqual({ monto: 12.5, formaPago: "TRANSFERENCIA", referencia: "TRX-9" });

    await usuario.click(screen.getByRole("checkbox", { name: "Solo vencidas" }));
    await waitFor(() => expect(api.llamadasA("GET /api/cuentas-por-cobrar").some((l) => l.parametros.get("vencidas") === "true")).toBe(true));
  });
});

describe("Compras, proveedores y cuentas por pagar", () => {
  const PROVEEDOR = { id: "pv1", ruc: "1790012345001", razonSocial: "Distribuidora Andina", email: null, telefono: null, diasPago: 30, status: "ACTIVO" };

  it("registrar una compra: proveedor, documento, líneas con costo; envía la sucursal de la caja y refresca", async () => {
    const api = servidor()
      .en("GET /api/compras", paginado([{ id: "co1", numeroFactura: "001-001-000000777", fecha: "2026-11-20T10:00:00.000Z", proveedor: "Distribuidora Andina", formaPago: "CREDITO", total: 46, estado: "REGISTRADA", tipoDocumento: "FACTURA" }]))
      .en("GET /api/proveedores", paginado([PROVEEDOR]))
      .en("POST /api/compras", { status: 201, cuerpo: { id: "co2", numeroFactura: "001-001-000000800", total: 23 } });
    const { usuario } = renderizarPos({ api, usuario: usuarioDe("SUPERVISOR") });
    await usuario.click(await screen.findByRole("button", { name: "Compras" }));
    expect(await screen.findByText("001-001-000000777")).toBeInTheDocument();
    await usuario.click(screen.getByRole("button", { name: "Registrar compra" }));
    const d = await screen.findByRole("dialog", { name: "Registrar compra" });
    await usuario.click(within(d).getByRole("button", { name: "Registrar compra" }));
    expect(await within(d).findByRole("alert")).toHaveTextContent("Elija el proveedor");

    await usuario.selectOptions(await within(d).findByLabelText("Proveedor"), "pv1");
    await usuario.type(within(d).getByLabelText("Número de documento"), "001-001-000000800");
    await usuario.type(within(d).getByLabelText("Autorización del proveedor"), "0805202401099234567800110010020000001231234567811");
    await usuario.selectOptions(within(d).getByLabelText("Forma de pago"), "CREDITO");
    await usuario.type(within(d).getByLabelText("Días de crédito"), "45");
    await usuario.click(within(d).getByRole("button", { name: "Registrar compra" }));
    expect(await within(d).findByRole("alert")).toHaveTextContent("Agregue al menos un producto");

    await usuario.type(within(d).getByLabelText("Buscar producto a comprar"), "caf");
    await usuario.click(await within(d).findByRole("button", { name: "Agregar Café molido 250g" }));
    await usuario.click(within(d).getByRole("button", { name: "Registrar compra" }));
    expect(await within(d).findByRole("alert")).toHaveTextContent("cantidad y costo mayores que cero");
    await usuario.clear(within(d).getByLabelText("Cantidad de Café molido 250g"));
    await usuario.type(within(d).getByLabelText("Cantidad de Café molido 250g"), "10");
    await usuario.type(within(d).getByLabelText("Costo de Café molido 250g"), "4.5");
    expect(d).toHaveTextContent(dineroRx("45.00"));
    await usuario.click(within(d).getByRole("button", { name: "Registrar compra" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.llamadasA("POST /api/compras")[0]?.cuerpo).toEqual({
      proveedorId: "pv1", sucursalId: PUNTO.sucursal.id, numeroFactura: "001-001-000000800", tipoDocumento: "FACTURA", formaPago: "CREDITO", diasCredito: 45,
      autorizacion: "0805202401099234567800110010020000001231234567811", lineas: [{ productoId: CAFE.id, cantidad: 10, costoUnitario: 4.5 }],
    });
  });

  it("un error del servidor al registrar la compra se muestra sin cerrar el formulario", async () => {
    const api = servidor().en("GET /api/compras", paginado([])).en("GET /api/proveedores", paginado([PROVEEDOR])).en("POST /api/compras", { status: 409, cuerpo: { error: "DUPLICADO", mensaje: "La factura 001-001-000000800 del proveedor ya fue registrada" } });
    const { usuario } = renderizarPos({ api, usuario: usuarioDe("SUPERVISOR") });
    await usuario.click(await screen.findByRole("button", { name: "Compras" }));
    await usuario.click(await screen.findByRole("button", { name: "Registrar compra" }));
    const d = await screen.findByRole("dialog", { name: "Registrar compra" });
    await usuario.selectOptions(await within(d).findByLabelText("Proveedor"), "pv1");
    await usuario.type(within(d).getByLabelText("Número de documento"), "001-001-000000800");
    await usuario.type(within(d).getByLabelText("Buscar producto a comprar"), "caf");
    await usuario.click(await within(d).findByRole("button", { name: "Agregar Café molido 250g" }));
    await usuario.type(within(d).getByLabelText("Costo de Café molido 250g"), "4");
    await usuario.click(within(d).getByRole("button", { name: "Registrar compra" }));
    expect(await within(d).findByRole("alert")).toHaveTextContent("ya fue registrada");
    expect(screen.getByRole("dialog", { name: "Registrar compra" })).toBeInTheDocument();
  });

  it("proveedores: alta con RUC y plazo, edición y desactivación; errores del servidor", async () => {
    const api = servidor().en("GET /api/compras", paginado([])).en("GET /api/proveedores", paginado([PROVEEDOR])).en("POST /api/proveedores", { status: 409, cuerpo: { error: "DUPLICADO", mensaje: "Ya existe un proveedor con RUC 1790012345001" } }).en("PATCH /api/proveedores/pv1", { cuerpo: PROVEEDOR });
    const { usuario } = renderizarPos({ api, usuario: usuarioDe("BODEGUERO"), sinTurno: true });
    await usuario.click(await screen.findByRole("button", { name: "Compras" }));
    await usuario.click(await screen.findByRole("tab", { name: "Proveedores" }));
    await screen.findByRole("table", { name: "Proveedores" });
    await usuario.click(screen.getByRole("button", { name: "Nuevo proveedor" }));
    const d = await screen.findByRole("dialog", { name: "Nuevo proveedor" });
    await usuario.type(within(d).getByLabelText("RUC"), "1790012345001");
    await usuario.type(within(d).getByLabelText("Razón social"), "Otra S.A.");
    await usuario.click(within(d).getByRole("button", { name: "Guardar" }));
    expect(await within(d).findByRole("alert")).toHaveTextContent("Ya existe un proveedor");
    expect(api.llamadasA("POST /api/proveedores")[0]?.cuerpo).toMatchObject({ ruc: "1790012345001", razonSocial: "Otra S.A.", diasPago: 30, email: null });
    await usuario.click(within(d).getByRole("button", { name: "Cancelar" }));

    await usuario.click(screen.getByRole("button", { name: "Editar Distribuidora Andina" }));
    const e = await screen.findByRole("dialog", { name: "Editar Distribuidora Andina" });
    await usuario.selectOptions(within(e).getByLabelText("Estado"), "INACTIVO");
    await usuario.click(within(e).getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(api.llamadasA("PATCH /api/proveedores/pv1")).toHaveLength(1));
    expect(api.llamadasA("PATCH /api/proveedores/pv1")[0]?.cuerpo).toMatchObject({ status: "INACTIVO", ruc: "1790012345001" });
  });

  it("cuentas por pagar: pago al proveedor", async () => {
    const cuenta = { id: "cp1", montoTotal: 46, saldo: 46, fechaVencimiento: "2026-12-20T00:00:00.000Z", estado: "PENDIENTE", proveedor: { id: "pv1", razonSocial: "Distribuidora Andina" }, compra: { numeroFactura: "001-001-000000777" } };
    const api = servidor().en("GET /api/compras", paginado([])).en("GET /api/cuentas-por-pagar", paginado([cuenta])).en("POST /api/cuentas-por-pagar/cp1/pagos", { status: 201, cuerpo: cuenta });
    const { usuario } = renderizarPos({ api, usuario: usuarioDe("SUPERVISOR") });
    await usuario.click(await screen.findByRole("button", { name: "Compras" }));
    await usuario.click(await screen.findByRole("tab", { name: "Cuentas por pagar" }));
    await usuario.click(await screen.findByRole("button", { name: "Pagar 001-001-000000777" }));
    const d = await screen.findByRole("dialog", { name: "Pago a Distribuidora Andina" });
    await usuario.click(within(d).getByRole("button", { name: "Registrar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.llamadasA("POST /api/cuentas-por-pagar/cp1/pagos")[0]?.cuerpo).toEqual({ monto: 46, formaPago: "EFECTIVO" });
  });

  it("sin proveedores:leer no se ven las pestañas de proveedores ni de cuentas por pagar", async () => {
    const solo = { ...usuarioDe("BODEGUERO"), permisos: ["inventario:crear", "inventario:actualizar", "inventario:leer"] };
    const api = servidor().en("GET /api/compras", paginado([]));
    const { usuario } = renderizarPos({ api, usuario: solo, sinTurno: true });
    await usuario.click(await screen.findByRole("button", { name: "Compras" }));
    await screen.findByRole("table", { name: "Compras" });
    expect(screen.queryByRole("tab", { name: "Proveedores" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Cuentas por pagar" })).not.toBeInTheDocument();
  });
});

describe("Caja", () => {
  const VENTAS = [
    { id: "v1", numero: "001-001-000000041", createdAt: "2026-11-24T15:10:00.000Z", estado: "COMPLETADA", total: 23, propina: 0, clienteNombre: null, cajero: "María Pérez", turnoId: TURNO.id, comprobante: { id: "c1", estado: "PENDIENTE" } },
    { id: "v2", numero: "001-001-000000042", createdAt: "2026-11-24T15:20:00.000Z", estado: "ANULADA", total: 11.5, propina: 0, clienteNombre: "Juan Pérez", cajero: "María Pérez", turnoId: TURNO.id, comprobante: null },
  ];
  const REPORTE = (ciego: boolean) => ({
    turno: { id: TURNO.id, sucursal: "Matriz", cajero: "María Pérez", estado: "ABIERTO", montoApertura: 100, fechaApertura: "2026-11-24T13:00:00.000Z", fechaCierre: null },
    ventas: { cantidad: 1, total: 23, subtotal: 20, iva: 3, descuento: 0, anuladas: { cantidad: 1, total: 11.5 } },
    porFormaPago: [{ formaPago: "EFECTIVO", neto: 23 }], movimientos: { ingresos: 20, egresos: 10, detalle: [] },
    efectivo: ciego ? null : { esperado: 133, contado: null, diferencia: null },
  });
  const apiCaja = () => servidor().en(`GET /api/turnos/${TURNO.id}/reporte`, { cuerpo: REPORTE(true) }).en("GET /api/ventas", paginado(VENTAS));

  it("resumen del turno con cierre ciego: el cajero no ve el efectivo esperado; el supervisor sí", async () => {
    const a = renderizarPos({ api: apiCaja() });
    await a.usuario.click(await screen.findByRole("button", { name: "Caja" }));
    const resumen = await screen.findByLabelText("Resumen del turno");
    expect(resumen).toHaveTextContent("Ventas (1)");
    expect(resumen).toHaveTextContent("Anuladas (1)");
    expect(resumen).toHaveTextContent(/cierre ciego/);
    expect(resumen).not.toHaveTextContent("Efectivo esperado");
    a.unmount();

    const api = apiCaja().en(`GET /api/turnos/${TURNO.id}/reporte`, { cuerpo: REPORTE(false) });
    const b = renderizarPos({ api, usuario: usuarioDe("SUPERVISOR") });
    await b.usuario.click(await screen.findByRole("button", { name: "Caja" }));
    expect(await screen.findByLabelText("Resumen del turno")).toHaveTextContent("Efectivo esperado");
  });

  it("ventas del turno: reimprimir; anular solo con permiso, con motivo, y refresca", async () => {
    const api = apiCaja().en("POST /api/ventas/v1/imprimir", { status: 204 }).en("POST /api/ventas/v1/anular", { cuerpo: {} });
    const cajero = renderizarPos({ api });
    await cajero.usuario.click(await screen.findByRole("button", { name: "Caja" }));
    await screen.findByRole("table", { name: "Ventas del turno" });
    expect(screen.queryByRole("button", { name: /^Anular/ })).not.toBeInTheDocument(); // el cajero no anula
    await cajero.usuario.click(screen.getByRole("button", { name: "Reimprimir 001-001-000000041" }));
    expect(await screen.findByText("Ticket 001-001-000000041 enviado a la impresora")).toBeInTheDocument();
    cajero.unmount();

    const sup = renderizarPos({ api, usuario: usuarioDe("SUPERVISOR") });
    await sup.usuario.click(await screen.findByRole("button", { name: "Caja" }));
    await screen.findByRole("table", { name: "Ventas del turno" });
    expect(screen.queryByRole("button", { name: "Anular 001-001-000000042" })).not.toBeInTheDocument(); // ya está anulada
    await sup.usuario.click(screen.getByRole("button", { name: "Anular 001-001-000000041" }));
    const d = await screen.findByRole("dialog", { name: "Anular venta 001-001-000000041" });
    await sup.usuario.type(within(d).getByLabelText("Motivo de la anulación"), "Err");
    await sup.usuario.click(within(d).getByRole("button", { name: "Anular venta" }));
    expect(await within(d).findByRole("alert")).toHaveTextContent("al menos 5 caracteres");
    await sup.usuario.type(within(d).getByLabelText("Motivo de la anulación"), "or de precio");
    await sup.usuario.click(within(d).getByRole("button", { name: "Anular venta" }));
    expect(await screen.findByText("Venta 001-001-000000041 anulada")).toBeInTheDocument();
    expect(api.llamadasA("POST /api/ventas/v1/anular")[0]?.cuerpo).toEqual({ motivo: "Error de precio" });
  });

  it("si el servidor rechaza la anulación (p. ej. factura a Consumidor Final autorizada) se informa el motivo", async () => {
    const api = apiCaja().en("POST /api/ventas/v1/anular", { status: 409, cuerpo: { error: "ESTADO_INVALIDO", mensaje: "La factura a Consumidor Final no puede anularse automáticamente" } });
    const { usuario } = renderizarPos({ api, usuario: usuarioDe("SUPERVISOR") });
    await usuario.click(await screen.findByRole("button", { name: "Caja" }));
    await usuario.click(await screen.findByRole("button", { name: "Anular 001-001-000000041" }));
    const d = await screen.findByRole("dialog");
    await usuario.type(within(d).getByLabelText("Motivo de la anulación"), "Devolución del cliente");
    await usuario.click(within(d).getByRole("button", { name: "Anular venta" }));
    expect(await within(d).findByRole("alert")).toHaveTextContent("no puede anularse automáticamente");
  });

  it("ingreso/egreso de caja y arqueo impreso", async () => {
    const api = apiCaja().en(`POST /api/turnos/${TURNO.id}/movimientos`, { status: 201, cuerpo: {} }).en(`POST /api/turnos/${TURNO.id}/imprimir`, { status: 204 });
    const { usuario } = renderizarPos({ api });
    await usuario.click(await screen.findByRole("button", { name: "Caja" }));
    await screen.findByLabelText("Resumen del turno");
    await usuario.click(screen.getByRole("button", { name: "Ingreso / egreso" }));
    const d = await screen.findByRole("dialog", { name: "Ingreso o egreso de caja" });
    await usuario.type(within(d).getByLabelText("Concepto"), "Pago mensajero");
    await usuario.click(within(d).getByRole("button", { name: "Registrar" }));
    expect(await within(d).findByRole("alert")).toHaveTextContent("monto mayor que cero");
    await usuario.type(within(d).getByLabelText("Monto"), "8.5");
    await usuario.click(within(d).getByRole("button", { name: "Registrar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.llamadasA(`POST /api/turnos/${TURNO.id}/movimientos`)[0]?.cuerpo).toEqual({ tipo: "EGRESO", concepto: "Pago mensajero", monto: 8.5 });
    await usuario.click(screen.getByRole("button", { name: "Imprimir arqueo" }));
    expect(await screen.findByText("Arqueo enviado a la impresora")).toBeInTheDocument();
  });

  it("cierre ciego: pide el efectivo contado, muestra el resultado con la diferencia y recién al aceptar vuelve a la apertura de turno", async () => {
    const cerrado = { ...REPORTE(false), turno: { ...REPORTE(false).turno, estado: "CERRADO", fechaCierre: "2026-11-24T22:00:00.000Z" }, efectivo: { esperado: 133, contado: 130, diferencia: -3 } };
    const api = apiCaja().en(`POST /api/turnos/${TURNO.id}/cerrar`, { cuerpo: cerrado }).en("GET /api/turnos/actual", { status: 409, cuerpo: { error: "TURNO_REQUERIDO", mensaje: "Sin turno" } });
    const { usuario } = renderizarPos({ api });
    await usuario.click(await screen.findByRole("button", { name: "Caja" }));
    await screen.findByLabelText("Resumen del turno");
    await usuario.click(screen.getByRole("button", { name: "Cerrar turno" }));
    const d = await screen.findByRole("dialog", { name: "Cerrar turno" });
    await usuario.click(within(d).getByRole("button", { name: "Cerrar turno" }));
    expect(await within(d).findByRole("alert")).toHaveTextContent("Indique el efectivo contado");
    await usuario.type(within(d).getByLabelText("Efectivo contado"), "130");
    await usuario.type(within(d).getByLabelText("Observaciones"), "Faltan 3 dólares");
    await usuario.click(within(d).getByRole("button", { name: "Cerrar turno" }));

    const resultado = await screen.findByRole("region", { name: "Turno cerrado" });
    expect(resultado).toHaveTextContent("Efectivo esperado");
    expect(resultado).toHaveTextContent(dineroRx("133.00"));
    expect(resultado).toHaveTextContent("Diferencia");
    expect(api.llamadasA(`POST /api/turnos/${TURNO.id}/cerrar`)[0]?.cuerpo).toEqual({ efectivoContado: 130, observaciones: "Faltan 3 dólares" });
    await usuario.click(within(resultado).getByRole("button", { name: "Aceptar" }));
    expect(await screen.findByRole("form", { name: "Apertura de turno" })).toBeInTheDocument();
    expect(useSesion.getState().turno).toBeNull();
  });

  it("si el servidor no deja cerrar (turno de otro cajero o ya cerrado) el diálogo sigue abierto con el motivo", async () => {
    const api = apiCaja().en(`POST /api/turnos/${TURNO.id}/cerrar`, { status: 409, cuerpo: { error: "ESTADO_INVALIDO", mensaje: "El turno ya está cerrado" } });
    const { usuario } = renderizarPos({ api });
    await usuario.click(await screen.findByRole("button", { name: "Caja" }));
    await screen.findByLabelText("Resumen del turno");
    await usuario.click(screen.getByRole("button", { name: "Cerrar turno" }));
    const d = await screen.findByRole("dialog", { name: "Cerrar turno" });
    await usuario.type(within(d).getByLabelText("Efectivo contado"), "100");
    await usuario.click(within(d).getByRole("button", { name: "Cerrar turno" }));
    expect(await within(d).findByRole("alert")).toHaveTextContent("El turno ya está cerrado");
    expect(screen.queryByRole("region", { name: "Turno cerrado" })).not.toBeInTheDocument();
  });
});

describe("Reportes", () => {
  const REPORTE = {
    tipo: "ventas", titulo: "Ventas por día", desde: "2026-10-25", hasta: "2026-11-24",
    columnas: [{ clave: "grupo", titulo: "Día", tipo: "texto" }, { clave: "cantidad", titulo: "Ventas", tipo: "numero" }, { clave: "total", titulo: "Total", tipo: "dinero" }],
    filas: [{ grupo: "2026-11-23", cantidad: 3, total: 69.5 }, { grupo: "2026-11-24", cantidad: 2, total: 40 }], totales: { cantidad: 5, total: 109.5 },
  };

  it("genera el reporte con el periodo y la agrupación elegidos y muestra sus totales", async () => {
    const api = servidor().en("GET /api/reportes/ventas", { cuerpo: REPORTE });
    const { usuario } = renderizarPos({ api, usuario: usuarioDe("CONTADOR"), sinTurno: true });
    const region = await screen.findByRole("region", { name: "Reportes" });
    await usuario.selectOptions(within(region).getByLabelText("Agrupar"), "producto");
    await usuario.clear(within(region).getByLabelText("Desde"));
    await usuario.type(within(region).getByLabelText("Desde"), "2026-11-01");
    await usuario.click(within(region).getByRole("button", { name: "Generar" }));
    const tabla = await screen.findByRole("table", { name: "Ventas por día" });
    expect(within(tabla).getAllByRole("row")).toHaveLength(3);
    expect(screen.getByLabelText("Totales del reporte")).toHaveTextContent(dineroRx("109.50"));
    const llamada = api.llamadasA("GET /api/reportes/ventas")[0];
    expect(llamada?.parametros.get("agrupar")).toBe("producto");
    expect(llamada?.parametros.get("desde")).toBe("2026-11-01");
  });

  it("descarga CSV (con reportes:exportar); sin ese permiso el botón no aparece", async () => {
    const api = servidor().en("GET /api/reportes/ventas", { texto: "﻿Día,Ventas,Total\r\n", cabeceras: { "content-type": "text/csv", "content-disposition": 'attachment; filename="reporte-ventas.csv"' } });
    const { usuario } = renderizarPos({ api, usuario: usuarioDe("CONTADOR"), sinTurno: true });
    await screen.findByRole("region", { name: "Reportes" });
    await usuario.click(screen.getByRole("button", { name: "Descargar CSV" }));
    expect(await screen.findByText("Archivo reporte-ventas.csv descargado")).toBeInTheDocument();
    expect(descargas).toEqual([{ nombre: "reporte-ventas.csv" }]);
    expect(api.llamadasA("GET /api/reportes/ventas")[0]?.parametros.get("formato")).toBe("csv");

    const solo = { ...usuarioDe("CONTADOR"), permisos: ["reportes:leer"] };
    renderizarPos({ api: servidor(), usuario: solo, sinTurno: true });
    await waitFor(() => expect(screen.getAllByRole("region", { name: "Reportes" }).length).toBeGreaterThan(0));
    expect(screen.queryByRole("button", { name: "Descargar CSV" })).not.toBeInTheDocument();
  });

  it("reportes sin periodo (stock y cartera) y errores del servidor", async () => {
    const api = servidor().en("GET /api/reportes/cartera", { cuerpo: { tipo: "cartera", titulo: "Cartera (por cobrar y por pagar)", desde: null, hasta: null, columnas: [{ clave: "tipo", titulo: "Tipo", tipo: "texto" }, { clave: "saldo", titulo: "Saldo", tipo: "dinero" }], filas: [{ tipo: "Por cobrar", saldo: 11.5 }], totales: { porCobrar: 11.5, porPagar: 46 } } })
      .en("GET /api/reportes/stock", { status: 403, cuerpo: { error: "SIN_PERMISO", mensaje: "Permiso requerido: reportes:leer" } });
    const { usuario } = renderizarPos({ api, usuario: usuarioDe("CONTADOR"), sinTurno: true });
    const region = await screen.findByRole("region", { name: "Reportes" });
    await usuario.selectOptions(within(region).getByLabelText("Reporte"), "cartera");
    expect(within(region).queryByLabelText("Desde")).not.toBeInTheDocument();
    await usuario.click(within(region).getByRole("button", { name: "Generar" }));
    expect(await screen.findByLabelText("Totales del reporte")).toHaveTextContent(dineroRx("46.00"));
    await usuario.selectOptions(within(region).getByLabelText("Reporte"), "stock");
    await usuario.click(within(region).getByRole("button", { name: "Generar" }));
    expect(await within(region).findByRole("alert")).toHaveTextContent("Permiso requerido: reportes:leer");
  });
});

describe("Monitor de comprobantes del SRI", () => {
  const comp = (extra: Record<string, unknown>) => ({ id: "c1", tipoComprobante: "01", serie: "001-001", secuencial: "000000041", claveAcceso: "1".repeat(49), fechaEmision: "2026-11-24T15:00:00.000Z", estado: "PENDIENTE", ambiente: "1", intentosEnvio: 0, proximoIntento: null, mensajesRespuesta: null, colaSRI: null, ...extra });
  const LISTA = [
    comp({}),
    comp({ id: "c2", secuencial: "000000042", estado: "DEVUELTO", intentosEnvio: 1, mensajesRespuesta: JSON.stringify([{ identificador: "35", mensaje: "ARCHIVO NO CUMPLE ESTRUCTURA XML", informacionAdicional: "Falta el nodo X", tipo: "ERROR" }]) }),
    comp({ id: "c3", secuencial: "000000043", estado: "AUTORIZADO" }),
  ];
  const apiSri = () => servidor().en("GET /api/comprobantes", (p) => paginado(LISTA.filter((c) => (p.parametros.get("estado") ?? c.estado) === c.estado))).en("GET /api/sri/cola", { cuerpo: { porEstado: { PENDIENTE: 1, DEVUELTO: 1, AUTORIZADO: 1 }, pendientes: [] } });

  it("lista con estados, resumen por estado y último mensaje del SRI; el filtro consulta al servidor", async () => {
    const api = apiSri();
    const { usuario } = renderizarPos({ api, usuario: usuarioDe("SUPERVISOR") });
    await usuario.click(await screen.findByRole("button", { name: "Comprobantes SRI" }));
    const tabla = await screen.findByRole("table", { name: "Comprobantes" });
    expect(within(tabla).getAllByRole("row")).toHaveLength(4);
    expect(within(tabla).getByText("ARCHIVO NO CUMPLE ESTRUCTURA XML")).toBeInTheDocument();
    expect(await within(screen.getByRole("list", { name: "Resumen por estado" })).findByText("PENDIENTE")).toBeInTheDocument();
    await usuario.selectOptions(screen.getByLabelText("Estado"), "DEVUELTO");
    await waitFor(() => expect(within(screen.getByRole("table", { name: "Comprobantes" })).getAllByRole("row")).toHaveLength(2));
    expect(api.llamadasA("GET /api/comprobantes").at(-1)?.parametros.get("estado")).toBe("DEVUELTO");
  });

  it("detalle con la clave de acceso y los mensajes del SRI; «Reintentar» solo en estados corregibles", async () => {
    const api = apiSri().en("POST /api/comprobantes/c2/reintentar", { cuerpo: { id: "c2", estado: "PENDIENTE" } });
    const { usuario } = renderizarPos({ api, usuario: usuarioDe("SUPERVISOR") });
    await usuario.click(await screen.findByRole("button", { name: "Comprobantes SRI" }));
    await screen.findByRole("table", { name: "Comprobantes" });
    expect(screen.queryByRole("button", { name: "Reintentar 001-001-000000043" })).not.toBeInTheDocument(); // autorizado
    await usuario.click(screen.getByRole("button", { name: "Detalle 001-001-000000042" }));
    const d = await screen.findByRole("dialog", { name: "Factura 001-001-000000042" });
    expect(within(d).getByText("1".repeat(49))).toBeInTheDocument();
    expect(within(within(d).getByRole("list", { name: "Mensajes del SRI" })).getByText(/ERROR 35/)).toBeInTheDocument();
    expect(d).toHaveTextContent("Falta el nodo X");
    await usuario.click(within(d).getByRole("button", { name: "Reintentar envío" }));
    expect(await screen.findByText(/Comprobante en cola/)).toBeInTheDocument();
    expect(api.llamadasA("POST /api/comprobantes/c2/reintentar")).toHaveLength(1);
  });

  it("sin sri:crear no hay botones de reintento; con error del servidor se informa", async () => {
    const contador = renderizarPos({ api: apiSri(), usuario: usuarioDe("CONTADOR"), sinTurno: true });
    await contador.usuario.click(await screen.findByRole("button", { name: "Comprobantes SRI" }));
    await screen.findByRole("table", { name: "Comprobantes" });
    expect(screen.queryByRole("button", { name: /^Reintentar/ })).not.toBeInTheDocument();
    contador.unmount();

    const api = apiSri().en("POST /api/comprobantes/c1/reintentar", { status: 409, cuerpo: { error: "ESTADO_INVALIDO", mensaje: "El comprobante está en proceso: no se puede reenviar" } });
    const sup = renderizarPos({ api, usuario: usuarioDe("SUPERVISOR") });
    await sup.usuario.click(await screen.findByRole("button", { name: "Comprobantes SRI" }));
    await sup.usuario.click(await screen.findByRole("button", { name: "Reintentar 001-001-000000041" }));
    expect(await screen.findByText("El comprobante está en proceso: no se puede reenviar")).toBeInTheDocument();
  });

  it("descarga del RIDE en PDF y del ATS del periodo (con reportes:exportar)", async () => {
    const api = apiSri()
      .en("GET /api/comprobantes/c3/ride", { texto: "%PDF-1.3", cabeceras: { "content-type": "application/pdf", "content-disposition": 'attachment; filename="factura-001-001-000000043.pdf"' } })
      .en("GET /api/reportes/ats", { texto: "<iva/>", cabeceras: { "content-type": "application/xml", "content-disposition": 'attachment; filename="ATS-2026-11.xml"' } });
    const { usuario } = renderizarPos({ api, usuario: usuarioDe("SUPERVISOR") });
    await usuario.click(await screen.findByRole("button", { name: "Comprobantes SRI" }));
    await usuario.click(await screen.findByRole("button", { name: "RIDE 001-001-000000043" }));
    await waitFor(() => expect(descargas).toContainEqual({ nombre: "factura-001-001-000000043.pdf" }));
    expect(api.llamadasA("GET /api/comprobantes/c3/ride")[0]?.parametros.get("descargar")).toBe("1");

    const form = screen.getByRole("form", { name: "Anexo transaccional" });
    await usuario.clear(within(form).getByLabelText("Mes"));
    await usuario.type(within(form).getByLabelText("Mes"), "11");
    await usuario.click(within(form).getByRole("button", { name: "Descargar ATS" }));
    expect(await within(form).findByText(/ATS-2026-11\.xml descargado/)).toBeInTheDocument();
    expect(api.llamadasA("GET /api/reportes/ats")[0]?.parametros.get("mes")).toBe("11");
  });

  it("el ATS incompleto muestra qué hay que corregir", async () => {
    const api = apiSri().en("GET /api/reportes/ats", { status: 400, cuerpo: { error: "VALIDACION", mensaje: "No se puede generar el ATS: compra F-1 de Proveedor: falta el número de autorización" } });
    const { usuario } = renderizarPos({ api, usuario: usuarioDe("SUPERVISOR") });
    await usuario.click(await screen.findByRole("button", { name: "Comprobantes SRI" }));
    const form = await screen.findByRole("form", { name: "Anexo transaccional" });
    await usuario.click(within(form).getByRole("button", { name: "Descargar ATS" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent("falta el número de autorización");
  });
});

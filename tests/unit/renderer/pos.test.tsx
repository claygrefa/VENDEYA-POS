// @vitest-environment jsdom
// ============================================================
// tests/unit/renderer/pos.test.tsx — Pantalla de venta: búsqueda, escáner, atajos, cobro y errores del servidor
// ============================================================
import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VentaInputSchema } from "../../../src/shared/schemas/venta.schema";
import { useCarrito } from "../../../src/renderer/store/carrito.store";
import { useSesion } from "../../../src/renderer/store/sesion.store";
import { ApiSimulada, CAFE, PUNTO, QUESO, renderizarPos, servidorBasico } from "../../helpers/renderer/entorno";

const dineroRx = (n: string): RegExp => new RegExp(n.replace(".", "[.,]"));
const total = (): HTMLElement => screen.getByTestId("total");

beforeEach(() => localStorage.clear());

/** Servidor con venta, escaneo y peso simulados. */
function servidor(extra?: (api: ApiSimulada) => void): ApiSimulada {
  const api = servidorBasico(new ApiSimulada())
    .en("POST /api/ventas", (p) => ({
      status: 201,
      cuerpo: { id: "v1", numero: "001-001-000000042", subtotal: 20, descuento: 0, iva: 3, propina: 0, total: 23, pagos: (p.cuerpo as { pagos: Array<{ formaPago: string; monto: number }> }).pagos.map((x) => ({ ...x, cambio: x.formaPago === "EFECTIVO" ? 7 : 0 })), comprobante: { id: "c1", estado: "PENDIENTE", claveAcceso: "1".repeat(49) }, advertencias: [] },
    }))
    .en("GET /api/escaneo/7861234567890", { cuerpo: { tipo: "PRODUCTO", producto: CAFE, presentacion: null, cantidad: 1, etiqueta: null } })
    .en("GET /api/escaneo/2000003012509", { cuerpo: { tipo: "BALANZA", producto: QUESO, presentacion: null, cantidad: 1.25, etiqueta: { plu: "000003", tipo: "PESO", pesoKg: 1.25, importe: null } } })
    .en("GET /api/escaneo/0000000000000", { status: 404, cuerpo: { error: "NO_ENCONTRADO", mensaje: "Sin producto para el código 0000000000000" } })
    .en("GET /api/balanza/peso", { cuerpo: { brutoKg: 2.5, taraKg: 0, netoKg: 2.5, cantidad: 2.5, unidad: "KG" } })
    .en("POST /api/ventas/v1/imprimir", { status: 204 });
  extra?.(api);
  return api;
}

describe("Búsqueda y carrito", () => {
  it("muestra el catálogo, agrega con un toque y calcula el total con IVA", async () => {
    const { usuario } = renderizarPos({ api: servidor() });
    await usuario.click(await screen.findByRole("button", { name: "Agregar Café molido 250g" }));
    expect(within(screen.getByRole("list", { name: "Líneas de la venta" })).getByText("Café molido 250g")).toBeInTheDocument();
    expect(total()).toHaveTextContent(dineroRx("11.50")); // 10 + 15 %
    await usuario.click(screen.getByRole("button", { name: "Agregar Café molido 250g" }));
    expect(total()).toHaveTextContent(dineroRx("23.00"));
    await usuario.click(screen.getByRole("button", { name: "Agregar Arroz 1kg" }));
    expect(total()).toHaveTextContent(dineroRx("24.20")); // arroz 0 %
    expect(within(screen.getByLabelText("Totales")).getByText("IVA 15%")).toBeInTheDocument();
  });

  it("aumentar, disminuir (hasta quitar) y quitar líneas", async () => {
    const { usuario } = renderizarPos({ api: servidor() });
    await usuario.click(await screen.findByRole("button", { name: "Agregar Arroz 1kg" }));
    await usuario.click(screen.getByRole("button", { name: "Aumentar Arroz 1kg" }));
    expect(screen.getByLabelText("Cantidad de Arroz 1kg")).toHaveTextContent("2");
    await usuario.click(screen.getByRole("button", { name: "Disminuir Arroz 1kg" }));
    await usuario.click(screen.getByRole("button", { name: "Disminuir Arroz 1kg" }));
    expect(screen.queryByRole("button", { name: "Quitar Arroz 1kg" })).not.toBeInTheDocument();
    await usuario.click(screen.getByRole("button", { name: "Agregar Arroz 1kg" }));
    await usuario.click(screen.getByRole("button", { name: "Quitar Arroz 1kg" }));
    expect(screen.getByText(/Escanee o busque un producto/)).toBeInTheDocument();
  });

  it("escribir filtra el catálogo en el servidor y sin coincidencias lo dice", async () => {
    const api = servidor();
    const { usuario } = renderizarPos({ api, retardo: 0 });
    await screen.findByRole("button", { name: "Agregar Arroz 1kg" });
    await usuario.type(screen.getByLabelText("Buscar producto"), "queso");
    // Margen amplio: la consulta es diferida y, con la máquina cargada, el dibujo puede tardar más de 1 s
    await waitFor(() => expect(screen.queryByRole("button", { name: "Agregar Arroz 1kg" })).not.toBeInTheDocument(), { timeout: 8_000 });
    expect(screen.getByRole("button", { name: "Agregar Queso fresco" })).toBeInTheDocument();
    expect(api.llamadas.some((l) => l.ruta === "/api/productos" && l.parametros.get("search") === "queso")).toBe(true);
    await usuario.clear(screen.getByLabelText("Buscar producto"));
    await usuario.type(screen.getByLabelText("Buscar producto"), "zzz");
    expect(await screen.findByText(/Sin resultados/, undefined, { timeout: 8_000 })).toBeInTheDocument();
  });

  it("editar una línea: descuento en porcentaje y cantidad recalculan los totales; un descuento inválido se rechaza", async () => {
    const { usuario } = renderizarPos({ api: servidor() });
    await usuario.click(await screen.findByRole("button", { name: "Agregar Café molido 250g" }));
    await usuario.click(screen.getByRole("button", { name: "Editar Café molido 250g" }));
    const dialogo = screen.getByRole("dialog", { name: "Café molido 250g" });
    await usuario.clear(within(dialogo).getByLabelText("Cantidad"));
    await usuario.type(within(dialogo).getByLabelText("Cantidad"), "2");
    await usuario.type(within(dialogo).getByLabelText("Descuento"), "10");
    await usuario.selectOptions(within(dialogo).getByLabelText("Tipo de descuento"), "PORCENTAJE");
    await usuario.click(within(dialogo).getByRole("button", { name: "Aceptar" }));
    expect(total()).toHaveTextContent(dineroRx("20.70")); // 20 - 10 % = 18 + 15 %
    expect(screen.getByText(/desc\. 10%/)).toBeInTheDocument();

    await usuario.click(screen.getByRole("button", { name: "Editar Café molido 250g" }));
    const d2 = screen.getByRole("dialog");
    await usuario.clear(within(d2).getByLabelText("Descuento"));
    await usuario.type(within(d2).getByLabelText("Descuento"), "150");
    await usuario.click(within(d2).getByRole("button", { name: "Aceptar" }));
    expect(within(d2).getByRole("alert")).toHaveTextContent(/no puede superar 100%/);
  });
});

describe("Escáner y teclado", () => {
  afterEach(() => vi.restoreAllMocks());

  it("una ráfaga rápida + Enter es un escaneo: se resuelve en el servidor y no queda texto en la búsqueda", async () => {
    const api = servidor();
    const { usuario } = renderizarPos({ api });
    await screen.findByRole("button", { name: "Agregar Arroz 1kg" });
    await usuario.click(screen.getByLabelText("Buscar producto"));
    // El detector mide el tiempo entre teclas: con la máquina cargada, las teclas «instantáneas» de la prueba llegarían con pausas de
    // cientos de ms y parecerían digitación. Reloj propio: cada lectura avanza 2 ms, como un lector real.
    let t = performance.now();
    vi.spyOn(performance, "now").mockImplementation(() => (t += 2));
    await usuario.keyboard("7861234567890{Enter}");
    vi.restoreAllMocks();
    await waitFor(() => expect(screen.getByRole("list", { name: "Líneas de la venta" })).toHaveTextContent("Café molido 250g"));
    expect(api.llamadasA("GET /api/escaneo/7861234567890")).toHaveLength(1);
    expect(screen.getByLabelText("Buscar producto")).toHaveValue("");
  });

  it("el mismo código TECLEADO con pausas es digitación: se busca como texto, sin pasar por el escáner", async () => {
    const api = servidor();
    const { usuario } = renderizarPos({ api, retardo: 90 });
    await screen.findByRole("button", { name: "Agregar Arroz 1kg" });
    await usuario.click(screen.getByLabelText("Buscar producto"));
    await usuario.keyboard("78612{Enter}"); // pausas de 90 ms entre teclas
    await waitFor(() => expect(api.llamadas.some((l) => l.ruta === "/api/productos" && l.parametros.get("search") === "78612")).toBe(true));
    expect(api.llamadasA("GET /api/escaneo/78612")).toHaveLength(0);
    expect(api.llamadas.filter((l) => l.ruta.startsWith("/api/escaneo"))).toHaveLength(0);
  }, 20_000);

  it("Enter tras escribir un nombre agrega el producto si es el único resultado; con varios, no agrega", async () => {
    const { usuario } = renderizarPos({ api: servidor(), retardo: 70 });
    await screen.findByRole("button", { name: "Agregar Arroz 1kg" });
    const campo = screen.getByLabelText("Buscar producto");
    await usuario.click(campo);
    await usuario.keyboard("arr{Enter}");
    await waitFor(() => expect(screen.getByRole("list", { name: "Líneas de la venta" })).toHaveTextContent("Arroz 1kg"));
    await usuario.keyboard("e{Enter}"); // «e» coincide con varios productos
    await new Promise((r) => setTimeout(r, 100));
    expect(within(screen.getByRole("list", { name: "Líneas de la venta" })).getAllByRole("listitem")).toHaveLength(1);
  }, 20_000);

  it("el escáner funciona aunque ningún campo tenga el foco", async () => {
    const api = servidor();
    const { usuario } = renderizarPos({ api });
    await screen.findByRole("button", { name: "Agregar Arroz 1kg" });
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.body).toHaveFocus();
    await usuario.keyboard("7861234567890{Enter}");
    await waitFor(() => expect(screen.getByRole("list", { name: "Líneas de la venta" })).toHaveTextContent("Café molido 250g"));
  });

  it("la etiqueta de la balanza agrega el producto con su peso, sin pedir nada", async () => {
    const { usuario } = renderizarPos({ api: servidor() });
    await screen.findByRole("button", { name: "Agregar Arroz 1kg" });
    await usuario.click(screen.getByLabelText("Buscar producto"));
    await usuario.keyboard("2000003012509{Enter}");
    await waitFor(() => expect(screen.getByLabelText("Cantidad de Queso fresco")).toHaveTextContent("1.25"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(total()).toHaveTextContent(dineroRx("10.00")); // 1,25 kg × 8
  });

  it("un código desconocido avisa con el mensaje del servidor y no toca el carrito", async () => {
    const { usuario } = renderizarPos({ api: servidor() });
    await screen.findByRole("button", { name: "Agregar Arroz 1kg" });
    await usuario.click(screen.getByLabelText("Buscar producto"));
    await usuario.keyboard("0000000000000{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("Sin producto para el código 0000000000000");
    expect(useCarrito.getState().lineas).toEqual([]);
  });

  it("con un diálogo abierto el escáner no modifica el carrito de fondo", async () => {
    const api = servidor();
    const { usuario } = renderizarPos({ api });
    await usuario.click(await screen.findByRole("button", { name: "Agregar Arroz 1kg" }));
    await usuario.keyboard("{F4}");
    expect(await screen.findByRole("dialog", { name: "Cliente de la venta" })).toBeInTheDocument();
    (document.activeElement as HTMLElement | null)?.blur();
    await usuario.keyboard("7861234567890{Enter}");
    await new Promise((r) => setTimeout(r, 80));
    expect(api.llamadas.filter((l) => l.ruta.startsWith("/api/escaneo"))).toHaveLength(0);
    expect(useCarrito.getState().lineas).toHaveLength(1);
  });

  it("F2 enfoca la búsqueda, F4 abre el cliente, F8 abre el cobro (solo con carrito) y ESC cierra", async () => {
    const { usuario } = renderizarPos({ api: servidor() });
    await usuario.click(await screen.findByRole("button", { name: "Agregar Arroz 1kg" }));
    (document.activeElement as HTMLElement | null)?.blur();
    await usuario.keyboard("{F2}");
    expect(screen.getByLabelText("Buscar producto")).toHaveFocus();

    await usuario.keyboard("{F4}");
    expect(screen.getByRole("dialog", { name: "Cliente de la venta" })).toBeInTheDocument();
    await usuario.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Buscar producto")).toHaveFocus(); // el foco vuelve a la búsqueda

    await usuario.keyboard("{F8}");
    expect(screen.getByRole("dialog", { name: "Cobrar" })).toBeInTheDocument();
    await usuario.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await usuario.click(screen.getByRole("button", { name: "Quitar Arroz 1kg" }));
    await usuario.keyboard("{F8}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); // carrito vacío: no hay qué cobrar
  });

  it("ESC en la búsqueda borra el texto", async () => {
    const { usuario } = renderizarPos({ api: servidor(), retardo: 0 });
    await screen.findByRole("button", { name: "Agregar Arroz 1kg" });
    await usuario.type(screen.getByLabelText("Buscar producto"), "caf");
    await usuario.keyboard("{Escape}");
    expect(screen.getByLabelText("Buscar producto")).toHaveValue("");
  });
});

describe("Productos a granel y balanza", () => {
  it("un producto en kilos pide el peso: «Pesar» lee la balanza y lo agrega con esa cantidad", async () => {
    const api = servidor();
    const { usuario } = renderizarPos({ api });
    await usuario.click(await screen.findByRole("button", { name: "Agregar Queso fresco" }));
    const dialogo = await screen.findByRole("dialog", { name: "Queso fresco" });
    await usuario.click(within(dialogo).getByRole("button", { name: "Pesar" }));
    await waitFor(() => expect(within(dialogo).getByLabelText("Cantidad")).toHaveValue("2.5"));
    expect(api.llamadasA("GET /api/balanza/peso")[0]?.parametros.get("productoId")).toBe(QUESO.id);
    await usuario.click(within(dialogo).getByRole("button", { name: "Aceptar" }));
    expect(screen.getByLabelText("Cantidad de Queso fresco")).toHaveTextContent("2.5");
    expect(total()).toHaveTextContent(dineroRx("20.00"));
  });

  it("también se puede teclear el peso a mano; las unidades enteras no admiten decimales", async () => {
    const { usuario } = renderizarPos({ api: servidor() });
    await usuario.click(await screen.findByRole("button", { name: "Agregar Queso fresco" }));
    const dialogo = await screen.findByRole("dialog", { name: "Queso fresco" });
    await usuario.type(within(dialogo).getByLabelText("Cantidad"), "0,75");
    await usuario.click(within(dialogo).getByRole("button", { name: "Aceptar" }));
    expect(screen.getByLabelText("Cantidad de Queso fresco")).toHaveTextContent("0.75");

    await usuario.click(await screen.findByRole("button", { name: "Agregar Café molido 250g" }));
    await usuario.click(screen.getByRole("button", { name: "Editar Café molido 250g" }));
    const d = screen.getByRole("dialog");
    await usuario.clear(within(d).getByLabelText("Cantidad"));
    await usuario.type(within(d).getByLabelText("Cantidad"), "1.5");
    await usuario.click(within(d).getByRole("button", { name: "Aceptar" }));
    expect(within(d).getByRole("alert")).toHaveTextContent(/no admite decimales/);
  });

  it("un error de la balanza se muestra en el diálogo y se puede escribir el peso", async () => {
    const api = servidor((a) => a.en("GET /api/balanza/peso", { status: 409, cuerpo: { error: "ESTADO_INVALIDO", mensaje: "La balanza no responde: revise el cable" } }));
    const { usuario } = renderizarPos({ api });
    await usuario.click(await screen.findByRole("button", { name: "Agregar Queso fresco" }));
    const dialogo = await screen.findByRole("dialog", { name: "Queso fresco" });
    await usuario.click(within(dialogo).getByRole("button", { name: "Pesar" }));
    expect(await within(dialogo).findByRole("alert")).toHaveTextContent("La balanza no responde");
  });

  it("sin balanza configurada no aparece el botón «Pesar»", async () => {
    const api = servidor((a) => a.en("GET /api/balanza", { cuerpo: { habilitada: false, puerto: null } }));
    const { usuario } = renderizarPos({ api });
    await screen.findByRole("button", { name: "Agregar Queso fresco" });
    await waitFor(() => expect(api.llamadasA("GET /api/balanza").length).toBeGreaterThan(0));
    await usuario.click(screen.getByRole("button", { name: "Agregar Queso fresco" }));
    const dialogo = await screen.findByRole("dialog", { name: "Queso fresco" });
    expect(within(dialogo).queryByRole("button", { name: "Pesar" })).not.toBeInTheDocument();
  });
});

describe("Cliente", () => {
  it("F4: busca, elige y muestra al cliente; «Consumidor Final» lo quita", async () => {
    const api = servidor((a) => a.en("GET /api/clientes", (p) => ({ cuerpo: { items: p.parametros.get("search") === "juan" ? [{ id: "c1", tipoIdentificacion: "05", identificacion: "1710034065", razonSocial: "Juan Pérez" }] : [], total: 1, page: 1, pageSize: 10 } })));
    const { usuario } = renderizarPos({ api, retardo: 0 });
    await usuario.click(await screen.findByRole("button", { name: "Agregar Arroz 1kg" }));
    expect(screen.getByText("Consumidor Final")).toBeInTheDocument();
    await usuario.keyboard("{F4}");
    const dialogo = await screen.findByRole("dialog", { name: "Cliente de la venta" });
    await usuario.type(within(dialogo).getByLabelText("Buscar cliente"), "juan");
    await usuario.click(await within(dialogo).findByRole("button", { name: "Elegir Juan Pérez" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("Juan Pérez")).toBeInTheDocument();
    await usuario.keyboard("{F4}");
    await usuario.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Consumidor Final" }));
    expect(screen.getByText("Consumidor Final")).toBeInTheDocument();
  });
});

describe("Cobro", () => {
  async function conCafe(api = servidor(), retardo?: number | null) {
    const r = renderizarPos({ api, ...(retardo !== undefined ? { retardo } : {}) });
    await r.usuario.click(await screen.findByRole("button", { name: "Agregar Café molido 250g" }));
    await r.usuario.click(screen.getByRole("button", { name: "Aumentar Café molido 250g" })); // 2 × 10 + 15 % = 23
    await r.usuario.keyboard("{F8}");
    return { ...r, dialogo: await screen.findByRole("dialog", { name: "Cobrar" }) };
  }

  it("arranca con el total en efectivo; el cambio se calcula al recibir más", async () => {
    const { usuario, dialogo } = await conCafe();
    expect(within(dialogo).getByTestId("total-cobro")).toHaveTextContent(dineroRx("23.00"));
    expect(within(dialogo).getByLabelText("Monto 1")).toHaveValue("23.00");
    expect(within(dialogo).getByTestId("cambio")).toHaveTextContent(dineroRx("0.00"));
    await usuario.clear(within(dialogo).getByLabelText("Monto 1"));
    await usuario.type(within(dialogo).getByLabelText("Monto 1"), "30");
    expect(within(dialogo).getByTestId("cambio")).toHaveTextContent(dineroRx("7.00"));
    await usuario.clear(within(dialogo).getByLabelText("Monto 1"));
    await usuario.type(within(dialogo).getByLabelText("Monto 1"), "10");
    expect(within(dialogo).getByTestId("falta")).toHaveTextContent(dineroRx("13.00"));
    expect(within(dialogo).getByRole("button", { name: "Confirmar cobro" })).toBeDisabled();
  });

  it("pago mixto (tarjeta + efectivo) con «Exacto»; envía al servidor sin precios y con los datos validados por el esquema compartido", async () => {
    const api = servidor();
    const { usuario, dialogo } = await conCafe(api);
    await usuario.selectOptions(within(dialogo).getByLabelText("Forma de pago 1"), "TARJETA_DEBITO");
    await usuario.clear(within(dialogo).getByLabelText("Monto 1"));
    await usuario.type(within(dialogo).getByLabelText("Monto 1"), "15");
    await usuario.click(within(dialogo).getByRole("button", { name: "+ Agregar otra forma de pago" }));
    await usuario.selectOptions(within(dialogo).getByLabelText("Forma de pago 2"), "EFECTIVO");
    await usuario.click(within(dialogo).getByRole("button", { name: "Completar pago 2" }));
    expect(within(dialogo).getByLabelText("Monto 2")).toHaveValue("8.00");
    await usuario.type(within(dialogo).getByLabelText("Propina"), "1.5");
    expect(within(dialogo).getByTestId("total-cobro")).toHaveTextContent(dineroRx("24.50"));
    expect(within(dialogo).getByTestId("falta")).toHaveTextContent(dineroRx("1.50"));
    await usuario.click(within(dialogo).getByRole("button", { name: "Completar pago 2" }));
    await usuario.click(within(dialogo).getByRole("button", { name: "Confirmar cobro" }));

    await screen.findByRole("region", { name: "Venta registrada" });
    const venta = api.llamadasA("POST /api/ventas")[0];
    expect(venta?.cabeceras).toMatchObject({ authorization: "Bearer token-prueba", "x-caja-id": "caja-test" });
    const cuerpo = venta?.cuerpo as Record<string, unknown>;
    expect(VentaInputSchema.safeParse(cuerpo).success).toBe(true);
    expect(cuerpo).toMatchObject({
      puntoEmisionId: PUNTO.id,
      propina: 1.5,
      emitirFactura: true,
      pagos: [{ formaPago: "TARJETA_DEBITO", monto: 15 }, { formaPago: "EFECTIVO", monto: 9.5 }],
    });
    expect(cuerpo["lineas"]).toEqual([{ productoId: CAFE.id, cantidad: 2, descuento: 0, tipoDescuento: "VALOR" }]); // sin precio: lo resuelve el servidor
    expect(cuerpo).not.toHaveProperty("clienteId"); // Consumidor Final
  });

  it("al terminar: confirmación con el número, el cambio y la factura; el carrito queda vacío; reimprimir y nueva venta", async () => {
    const api = servidor();
    const { usuario, dialogo } = await conCafe(api);
    await usuario.clear(within(dialogo).getByLabelText("Monto 1"));
    await usuario.type(within(dialogo).getByLabelText("Monto 1"), "30");
    await usuario.click(within(dialogo).getByRole("button", { name: "Confirmar cobro" }));

    const confirmacion = await screen.findByRole("region", { name: "Venta registrada" });
    expect(within(confirmacion).getByRole("status")).toHaveTextContent("Venta 001-001-000000042 registrada");
    expect(within(confirmacion).getByTestId("cambio-confirmado")).toHaveTextContent(dineroRx("7.00"));
    expect(within(confirmacion).getByText(/se enviará al SRI en segundo plano/)).toBeInTheDocument();
    expect(useCarrito.getState().lineas).toEqual([]);

    await usuario.click(within(confirmacion).getByRole("button", { name: "Reimprimir ticket" }));
    expect(await screen.findByText("Ticket enviado a la impresora")).toBeInTheDocument();
    expect(api.llamadasA("POST /api/ventas/v1/imprimir")).toHaveLength(1);

    await usuario.keyboard("{Escape}"); // ESC también deja lista la caja para la siguiente venta
    expect(screen.queryByRole("region", { name: "Venta registrada" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Buscar producto")).toHaveFocus();
  });

  it("sin impresora la factura igual se guarda: «Guardar factura (PDF)» descarga el archivo de la venta", async () => {
    const descargas: string[] = [];
    URL.createObjectURL = vi.fn(() => "blob:prueba");
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      descargas.push(this.download);
    });
    const api = servidor((a) =>
      a
        .en("POST /api/ventas/v1/imprimir", { status: 409, cuerpo: { error: "ESTADO_INVALIDO", mensaje: "No hay una impresora configurada" } })
        .en("GET /api/ventas/v1/ride", { texto: "%PDF-1.4", cabeceras: { "content-type": "application/pdf", "content-disposition": 'attachment; filename="factura-001-001-000000042.pdf"' } })
    );
    const { usuario, dialogo } = await conCafe(api);
    await usuario.clear(within(dialogo).getByLabelText("Monto 1"));
    await usuario.type(within(dialogo).getByLabelText("Monto 1"), "30");
    await usuario.click(within(dialogo).getByRole("button", { name: "Confirmar cobro" }));

    const confirmacion = await screen.findByRole("region", { name: "Venta registrada" });
    await usuario.click(within(confirmacion).getByRole("button", { name: "Reimprimir ticket" }));
    expect(await screen.findByText("No hay una impresora configurada")).toBeInTheDocument();
    await usuario.click(within(confirmacion).getByRole("button", { name: "Guardar factura (PDF)" }));
    expect(await screen.findByText("Factura guardada: factura-001-001-000000042.pdf")).toBeInTheDocument();
    expect(descargas).toEqual(["factura-001-001-000000042.pdf"]);
    expect(api.llamadasA("GET /api/ventas/v1/ride")).toHaveLength(1);
  });

  it("si la venta no generó factura (p. ej. Consumidor Final por más de USD 50) no se ofrece guardarla", async () => {
    const api = servidor((a) =>
      a.en("POST /api/ventas", { status: 201, cuerpo: { id: "v2", numero: "001-001-000000043", subtotal: 20, descuento: 0, iva: 3, propina: 0, total: 23, pagos: [{ formaPago: "EFECTIVO", monto: 23, cambio: 0 }], comprobante: null, advertencias: [] } })
    );
    const { usuario, dialogo } = await conCafe(api);
    await usuario.click(within(dialogo).getByRole("button", { name: "Confirmar cobro" }));
    const confirmacion = await screen.findByRole("region", { name: "Venta registrada" });
    expect(within(confirmacion).getByRole("button", { name: "Reimprimir ticket" })).toBeInTheDocument();
    expect(within(confirmacion).queryByRole("button", { name: "Guardar factura (PDF)" })).toBeNull();
  });

  it("con cliente identificado se envía su id; el crédito exige cliente", async () => {
    const api = servidor((a) => a.en("GET /api/clientes", { cuerpo: { items: [{ id: "99999999-9999-4999-8999-999999999999", tipoIdentificacion: "05", identificacion: "1710034065", razonSocial: "Juan Pérez" }], total: 1, page: 1, pageSize: 10 } }));
    const { usuario, dialogo } = await conCafe(api, 0);
    await usuario.selectOptions(within(dialogo).getByLabelText("Forma de pago 1"), "CREDITO");
    expect(within(dialogo).getByText(/necesita un cliente identificado/)).toBeInTheDocument();
    expect(within(dialogo).getByRole("button", { name: "Confirmar cobro" })).toBeDisabled();
    await usuario.keyboard("{Escape}");
    await usuario.keyboard("{F4}");
    const dc = await screen.findByRole("dialog", { name: "Cliente de la venta" });
    await usuario.type(within(dc).getByLabelText("Buscar cliente"), "ju");
    await usuario.click(await within(dc).findByRole("button", { name: "Elegir Juan Pérez" }));
    await usuario.keyboard("{F8}");
    const d2 = await screen.findByRole("dialog", { name: "Cobrar" });
    await usuario.selectOptions(within(d2).getByLabelText("Forma de pago 1"), "CREDITO");
    await usuario.click(within(d2).getByRole("button", { name: "Confirmar cobro" }));
    await screen.findByRole("region", { name: "Venta registrada" });
    expect(api.llamadasA("POST /api/ventas")[0]?.cuerpo).toMatchObject({ clienteId: "99999999-9999-4999-8999-999999999999", pagos: [{ formaPago: "CREDITO", monto: 23 }] });
  });

  it("no deja confirmar si el excedente de una tarjeta no se puede devolver", async () => {
    const { usuario, dialogo } = await conCafe();
    await usuario.selectOptions(within(dialogo).getByLabelText("Forma de pago 1"), "TARJETA_CREDITO");
    await usuario.clear(within(dialogo).getByLabelText("Monto 1"));
    await usuario.type(within(dialogo).getByLabelText("Monto 1"), "30");
    expect(within(dialogo).getByRole("alert")).toHaveTextContent(/excedente no se puede devolver/);
    expect(within(dialogo).getByRole("button", { name: "Confirmar cobro" })).toBeDisabled();
  });

  it("errores del servidor: el diálogo sigue abierto con el motivo y el carrito intacto (stock, límite de crédito, sin red)", async () => {
    for (const [codigo, mensaje, status] of [
      ["STOCK_INSUFICIENTE", "Stock insuficiente de Café molido 250g: hay 1", 409],
      ["LIMITE_CREDITO_EXCEDIDO", "El cliente excede su límite de crédito", 409],
      ["VALIDACION", "El comprobante no cumple el esquema", 400],
    ] as const) {
      const api = servidor((a) => a.en("POST /api/ventas", { status, cuerpo: { error: codigo, mensaje } }));
      const { usuario, dialogo, unmount } = await conCafe(api);
      await usuario.click(within(dialogo).getByRole("button", { name: "Confirmar cobro" }));
      expect(await within(dialogo).findByRole("alert")).toHaveTextContent(mensaje);
      expect(screen.getByRole("dialog", { name: "Cobrar" })).toBeInTheDocument();
      expect(useCarrito.getState().lineas).toHaveLength(1);
      expect(within(dialogo).getByRole("button", { name: "Confirmar cobro" })).toBeEnabled(); // se puede reintentar
      unmount();
    }
  });

  it("tras perder la respuesta y reabrir el POS, recupera el cobro con el mismo UUID y cuerpo", async () => {
    const api = servidor();
    const { usuario, dialogo, unmount } = await conCafe(api);
    api.en("POST /api/ventas", () => {
      throw new TypeError("fetch failed");
    });
    await usuario.click(within(dialogo).getByRole("button", { name: "Confirmar cobro" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/No se pudo comunicar con el servidor/);
    expect(useCarrito.getState().lineas).toHaveLength(1);
    const solicitud = VentaInputSchema.parse(api.llamadasA("POST /api/ventas")[0]?.cuerpo);
    expect(solicitud.intentoId).toEqual(expect.any(String));
    unmount();

    const reiniciado = servidor();
    const recuperado = renderizarPos({ api: reiniciado });
    await recuperado.usuario.click(await screen.findByRole("button", { name: "Recuperar cobro" }));
    await screen.findByRole("region", { name: "Venta registrada" });
    expect(reiniciado.llamadasA("POST /api/ventas").map((l) => l.cuerpo)).toEqual([solicitud]);
  });

  it("con un error del servidor que no se resuelve, la caja puede descartar el cobro: el servidor lo cierra, el carrito se conserva y no queda nada pendiente", async () => {
    const api = servidor((a) => a.en("POST /api/ventas", { status: 500, cuerpo: { error: "ERROR_INTERNO", mensaje: "Error interno del servidor" } }));
    const { usuario, dialogo, unmount } = await conCafe(api);
    await usuario.click(within(dialogo).getByRole("button", { name: "Confirmar cobro" }));
    // el cobro queda pendiente; «Descartar» aparece recién tras el intento fallido
    expect(await screen.findByText("Cobro pendiente de confirmación")).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("Error interno del servidor");
    const intentoId = VentaInputSchema.parse(api.llamadasA("POST /api/ventas")[0]?.cuerpo).intentoId as string;
    api.en(`POST /api/cobros/${intentoId}/descartar`, { cuerpo: { estado: "DESCARTADO" } });

    await usuario.click(screen.getByRole("button", { name: "Descartar cobro pendiente" }));
    const confirmar = await screen.findByRole("dialog", { name: "Descartar cobro pendiente" });
    await usuario.click(within(confirmar).getByRole("button", { name: "Sí, descartar" }));

    expect(await screen.findByText(/Cobro descartado: no se registró ninguna venta/)).toBeInTheDocument();
    expect(screen.queryByText("Cobro pendiente de confirmación")).not.toBeInTheDocument();
    expect(api.llamadasA(`POST /api/cobros/${intentoId}/descartar`)).toHaveLength(1);
    expect(api.llamadasA("POST /api/ventas")).toHaveLength(1); // descartar no vuelve a cobrar
    expect(useCarrito.getState().lineas).toHaveLength(1);
    unmount();

    // al reabrir la caja ya no hay nada que recuperar
    renderizarPos({ api: servidor() });
    await screen.findByLabelText("Buscar producto");
    expect(screen.queryByRole("button", { name: "Recuperar cobro" })).not.toBeInTheDocument();
  });

  it("si el servidor ya había registrado el cobro, descartarlo se rechaza: sigue pendiente y se recupera", async () => {
    const api = servidor((a) => a.en("POST /api/ventas", { status: 500, cuerpo: { error: "ERROR_INTERNO", mensaje: "Error interno del servidor" } }));
    const { usuario, dialogo } = await conCafe(api);
    await usuario.click(within(dialogo).getByRole("button", { name: "Confirmar cobro" }));
    await screen.findByText("Cobro pendiente de confirmación");
    const intentoId = VentaInputSchema.parse(api.llamadasA("POST /api/ventas")[0]?.cuerpo).intentoId as string;
    api.en(`POST /api/cobros/${intentoId}/descartar`, { status: 409, cuerpo: { error: "ESTADO_INVALIDO", mensaje: "Este cobro ya se registró en el servidor: use «Recuperar cobro» para obtener la venta" } });

    await usuario.click(await screen.findByRole("button", { name: "Descartar cobro pendiente" }));
    await usuario.click(within(await screen.findByRole("dialog", { name: "Descartar cobro pendiente" })).getByRole("button", { name: "Sí, descartar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/ya se registró en el servidor/);
    expect(screen.getByText("Cobro pendiente de confirmación")).toBeInTheDocument();

    // ahora el servidor responde: la recuperación entrega la venta
    api.en("POST /api/ventas", { status: 201, cuerpo: { id: "v1", numero: "001-001-000000042", subtotal: 20, descuento: 0, iva: 3, propina: 0, total: 23, pagos: [{ formaPago: "EFECTIVO", monto: 23, cambio: 0 }], comprobante: null, advertencias: [] } });
    await usuario.click(screen.getByRole("button", { name: "Recuperar cobro" }));
    await screen.findByRole("region", { name: "Venta registrada" });
  });

  it("al reabrir la caja con un cobro pendiente solo se ofrece recuperarlo; descartar aparece después de un intento fallido", async () => {
    const api = servidor((a) => a.en("POST /api/ventas", () => { throw new TypeError("fetch failed"); }));
    const { usuario, dialogo, unmount } = await conCafe(api);
    await usuario.click(within(dialogo).getByRole("button", { name: "Confirmar cobro" }));
    await screen.findByText("Cobro pendiente de confirmación");
    unmount();

    const reiniciado = servidor((a) => a.en("POST /api/ventas", () => { throw new TypeError("fetch failed"); }));
    const r = renderizarPos({ api: reiniciado });
    const recuperar = await screen.findByRole("button", { name: "Recuperar cobro" });
    expect(screen.queryByRole("button", { name: "Descartar cobro pendiente" })).not.toBeInTheDocument();
    await r.usuario.click(recuperar);
    expect(await screen.findByRole("button", { name: "Descartar cobro pendiente" })).toBeInTheDocument();
  });

  it("si ya no hay turno abierto vuelve a la apertura y el carrito se conserva", async () => {
    const api = servidor((a) => a.en("POST /api/ventas", { status: 409, cuerpo: { error: "TURNO_REQUERIDO", mensaje: "Debe abrir un turno de caja" } }).en("GET /api/turnos/actual", { status: 409, cuerpo: { error: "TURNO_REQUERIDO", mensaje: "Sin turno" } }));
    const { usuario, dialogo } = await conCafe(api);
    await usuario.click(within(dialogo).getByRole("button", { name: "Confirmar cobro" }));
    expect(await screen.findByRole("form", { name: "Apertura de turno" })).toBeInTheDocument();
    expect(useCarrito.getState().lineas).toHaveLength(1);
    expect(useSesion.getState().turno).toBeNull();
  });
});

describe("Modo táctil", () => {
  it("el teclado numérico en pantalla edita el monto del cobro", async () => {
    const { usuario } = renderizarPos({ api: servidor() });
    await usuario.click(await screen.findByRole("button", { name: "Modo táctil: no" }));
    await usuario.click(screen.getByRole("button", { name: "Agregar Arroz 1kg" }));
    await usuario.click(screen.getByRole("button", { name: /Cobrar \(F8\)/ }));
    const dialogo = await screen.findByRole("dialog", { name: "Cobrar" });
    const teclado = within(dialogo).getByRole("group", { name: "Teclado numérico" });
    await usuario.click(within(dialogo).getByLabelText("Monto 1"));
    for (let i = 0; i < 4; i++) await usuario.click(within(teclado).getByRole("button", { name: "Borrar" }));
    await usuario.click(within(teclado).getByRole("button", { name: "5" }));
    expect(within(dialogo).getByLabelText("Monto 1")).toHaveValue("5");
    expect(within(dialogo).getByTestId("cambio")).toHaveTextContent(dineroRx("3.80")); // 5 − 1,20
    expect(localStorage.getItem("vendeya.modoTactil")).toBe("1");
  });

  it("sin modo táctil no hay teclado en pantalla", async () => {
    const { usuario } = renderizarPos({ api: servidor() });
    await usuario.click(await screen.findByRole("button", { name: "Agregar Arroz 1kg" }));
    await usuario.keyboard("{F8}");
    expect(screen.queryByRole("group", { name: "Teclado numérico" })).not.toBeInTheDocument();
  });
});

describe("Barra de estado", () => {
  it("muestra cajero, punto de emisión, SRI al día e impresora lista", async () => {
    renderizarPos({ api: servidor() });
    expect(await screen.findByText("María Pérez")).toBeInTheDocument();
    expect(screen.getByText(/Matriz · 001-001/)).toBeInTheDocument();
    expect(await screen.findByTestId("estado-sri")).toHaveTextContent("SRI: al día");
    expect(await screen.findByTestId("estado-impresora")).toHaveTextContent("Impresora lista");
  });

  it("comprobantes pendientes y sin impresora; sin permiso para ver la cola del SRI no se muestra", async () => {
    const api = servidor((a) =>
      a
        .en("GET /api/sri/cola", { cuerpo: { porEstado: {}, pendientes: [{ id: "1", estado: "PENDIENTE", intentos: 1, ultimoError: null }, { id: "2", estado: "PENDIENTE", intentos: 0, ultimoError: null }] } })
        .en("GET /api/impresora", { cuerpo: { conexion: "NINGUNA", impresionTermica: true } })
    );
    const r = renderizarPos({ api });
    expect(await screen.findByTestId("estado-sri")).toHaveTextContent("SRI: 2 pendientes");
    expect(await screen.findByTestId("estado-impresora")).toHaveTextContent("Sin impresora");
    r.unmount();

    const sinPermiso = servidor((a) => a.en("GET /api/sri/cola", { status: 403, cuerpo: { error: "SIN_PERMISO", mensaje: "Permiso requerido: sri:leer" } }));
    renderizarPos({ api: sinPermiso });
    await waitFor(() => expect(sinPermiso.llamadasA("GET /api/sri/cola").length).toBeGreaterThan(0));
    expect(screen.queryByTestId("estado-sri")).not.toBeInTheDocument();
  });
});

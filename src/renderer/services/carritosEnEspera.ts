import { z } from "zod";
import type { ClientePos, UsuarioSesion } from "./tipos";
import type { LineaCarrito } from "./totales";

const LineaSchema = z.object({
  clave: z.string(), productoId: z.string(), presentacionId: z.string().nullable(),
  codigo: z.string(), nombre: z.string(), unidad: z.string(), permiteDecimales: z.boolean(),
  cantidad: z.number().positive(), precioUnitario: z.number().nonnegative(), porcentajeIva: z.number().nonnegative(),
  descuento: z.number().nonnegative(), tipoDescuento: z.enum(["PORCENTAJE", "VALOR"]),
}) satisfies z.ZodType<LineaCarrito>;

const ClienteSchema = z.object({
  id: z.string(), tipoIdentificacion: z.string(), identificacion: z.string(), razonSocial: z.string(),
  email: z.string().nullable().optional(),
}).transform(({ email, ...cliente }): ClientePos => email === undefined ? cliente : { ...cliente, email });

const EnEsperaSchema = z.object({
  id: z.uuid(), guardadoEn: z.iso.datetime(), lineas: z.array(LineaSchema).min(1), cliente: ClienteSchema.nullable(),
});
const ListaSchema = z.array(EnEsperaSchema);

export type CarritoEnEspera = z.output<typeof EnEsperaSchema>;
type Actor = Pick<UsuarioSesion, "empresaId" | "id">;

const claveDe = ({ empresaId, id }: Actor): string => `vendeya.carritosEnEspera.v1.${empresaId}.${id}`;

export function leerCarritosEnEspera(actor: Actor): CarritoEnEspera[] {
  const dato = localStorage.getItem(claveDe(actor));
  return dato === null ? [] : ListaSchema.parse(JSON.parse(dato));
}

export function guardarCarritosEnEspera(actor: Actor, carritos: CarritoEnEspera[]): void {
  // Una sola escritura conserva la lista anterior si el navegador no puede guardarla.
  localStorage.setItem(claveDe(actor), JSON.stringify(ListaSchema.parse(carritos)));
}

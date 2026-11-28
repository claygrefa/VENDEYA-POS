// ============================================================
// src/renderer/services/categoriaIconos.ts — Ícono representativo de una categoría de productos
// Las categorías no guardan un ícono: se elige por palabras del nombre (sin tildes ni mayúsculas) y, si ninguna coincide, un ícono neutro.
// ============================================================
import { Apple, Baby, Beef, Beer, Candy, Coffee, Croissant, CupSoda, Fish, House, Milk, Package, PawPrint, Pencil, Pill, Plug, Shirt, ShoppingBasket, Sparkles, SprayCan, Tag, Wine, type LucideIcon } from "lucide-react";

const REGLAS: ReadonlyArray<{ icono: LucideIcon; palabras: readonly string[] }> = [
  { icono: CupSoda, palabras: ["bebida", "gaseosa", "refresco", "jugo", "agua", "cola"] },
  { icono: Beer, palabras: ["cerveza"] },
  { icono: Wine, palabras: ["licor", "vino", "alcohol", "destilado"] },
  { icono: Coffee, palabras: ["cafe", "cafeteria", "infusion", "te"] },
  { icono: Milk, palabras: ["lacteo", "leche", "queso", "yogur"] },
  { icono: Croissant, palabras: ["panaderia", "pan", "pasteleria", "reposteria"] },
  { icono: Candy, palabras: ["snack", "golosina", "dulce", "confite", "chocolate", "galleta"] },
  { icono: Beef, palabras: ["carne", "embutido", "cárnico", "carnico", "pollo", "cerdo"] },
  { icono: Fish, palabras: ["pescado", "marisco", "mariscos"] },
  { icono: Apple, palabras: ["fruta", "verdura", "hortaliza", "legumbre", "frescos"] },
  { icono: Pill, palabras: ["farmacia", "medic", "salud", "botiquin", "vitamina"] },
  { icono: SprayCan, palabras: ["limpieza", "detergente", "desinfectante"] },
  { icono: Sparkles, palabras: ["aseo", "higiene", "cuidado personal", "belleza", "perfumeria", "cosmetico"] },
  { icono: Baby, palabras: ["bebe", "infantil", "pañal", "panal"] },
  { icono: PawPrint, palabras: ["mascota", "veterinaria", "animal"] },
  { icono: Pencil, palabras: ["papeleria", "oficina", "escolar", "util"] },
  { icono: Shirt, palabras: ["ropa", "vestimenta", "calzado", "textil"] },
  { icono: Plug, palabras: ["electro", "electric", "tecnologia", "celular", "accesorio"] },
  { icono: House, palabras: ["hogar", "ferreteria", "menaje", "cocina"] },
  { icono: ShoppingBasket, palabras: ["abarrote", "viveres", "despensa", "granos", "supermercado", "alimento"] },
];

const sinTildes = (texto: string): string => texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Una palabra clave coincide con el comienzo de una palabra del nombre (las de hasta 3 letras, solo si es la palabra completa) */
function coincide(palabras: readonly string[], clave: string): boolean {
  const k = sinTildes(clave);
  return palabras.some((w) => (k.length <= 3 ? w === k : w.startsWith(k)));
}

/** Ícono para el nombre de una categoría; sin nombre: etiqueta (Tag); sin coincidencia: paquete (Package) */
export function iconoDeCategoria(nombre: string | undefined): LucideIcon {
  if (nombre === undefined || nombre.trim() === "") return Tag;
  const texto = sinTildes(nombre);
  const palabras = texto.split(/[^a-z0-9]+/).filter((w) => w !== "");
  const regla = REGLAS.find((r) => r.palabras.some((clave) => (clave.includes(" ") ? texto.includes(sinTildes(clave)) : coincide(palabras, clave))));
  return regla?.icono ?? Package;
}

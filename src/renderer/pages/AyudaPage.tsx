// ============================================================
// src/renderer/pages/AyudaPage.tsx — Centro de ayuda integrado: guías rápidas por rol, con búsqueda; funciona sin internet
// ============================================================
import React, { useMemo, useState } from "react";
import { Boton, Campo, Casilla } from "../components/Gestion";
import { useSesion } from "../store/sesion.store";
import { ARTICULOS, buscarArticulos, esParaRol, TITULO_GRUPO, type ArticuloAyuda, type GrupoAyuda } from "./ayuda.contenido";

const ORDEN_GRUPOS: ReadonlyArray<GrupoAyuda> = ["general", "cajero", "supervisor", "contador", "administrador"];

export function AyudaPage(): React.JSX.Element {
  const rol = useSesion((s) => s.usuario?.rol);
  const [texto, setTexto] = useState("");
  const [todas, setTodas] = useState(false);
  const [abierto, setAbierto] = useState<string | null>(null);

  const paraMiRol = useMemo(() => ARTICULOS.filter((a) => esParaRol(a, rol)), [rol]);
  const base = todas || paraMiRol.length === 0 ? ARTICULOS : paraMiRol;
  const resultados = useMemo(() => buscarArticulos(base, texto), [base, texto]);
  const articulo = abierto === null ? null : (ARTICULOS.find((a) => a.id === abierto) ?? null);

  if (articulo !== null) return <Detalle articulo={articulo} onVolver={() => setAbierto(null)} />;

  return (
    <section aria-label="Centro de ayuda" className="max-w-3xl space-y-4">
      <header>
        <h1 className="text-xl font-semibold text-white">Centro de ayuda</h1>
        <p className="text-sm text-slate-400">Guías rápidas para su trabajo diario. No necesitan internet.</p>
      </header>

      <Campo etiqueta="Buscar en la ayuda" valor={texto} onCambio={setTexto} placeholder="Por ejemplo: cerrar turno, anular, certificado…" autofoco />
      {paraMiRol.length > 0 ? <Casilla etiqueta="Mostrar las guías de todos los roles" marcada={todas} onCambio={setTodas} /> : null}

      {resultados.length === 0 ? (
        <p role="status" className="text-sm text-slate-400">No hay guías que coincidan con «{texto}». Pruebe con otras palabras o muestre las guías de todos los roles.</p>
      ) : (
        ORDEN_GRUPOS.map((g) => {
          const delGrupo = resultados.filter((a) => a.grupo === g);
          if (delGrupo.length === 0) return null;
          return (
            <section key={g} aria-label={TITULO_GRUPO[g]} className="space-y-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">{TITULO_GRUPO[g]}</h2>
              <ul className="space-y-2">
                {delGrupo.map((a) => (
                  <li key={a.id}>
                    <button type="button" onClick={() => setAbierto(a.id)} className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-left hover:border-brand-400">
                      <span className="block font-medium text-white">{a.titulo}</span>
                      <span className="block text-sm text-slate-400">{a.resumen}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
    </section>
  );
}

function Detalle({ articulo, onVolver }: { articulo: ArticuloAyuda; onVolver: () => void }): React.JSX.Element {
  return (
    <article aria-label={articulo.titulo} className="max-w-3xl space-y-4">
      <Boton onClick={onVolver}>← Volver a la ayuda</Boton>
      <header>
        <p className="text-xs uppercase tracking-wide text-slate-400">{TITULO_GRUPO[articulo.grupo]}</p>
        <h1 className="text-xl font-semibold text-white">{articulo.titulo}</h1>
        <p className="mt-1 text-slate-300">{articulo.resumen}</p>
      </header>
      <ol aria-label="Pasos" className="list-decimal space-y-2 pl-6 text-slate-200">
        {articulo.pasos.map((p, i) => (
          <li key={i}>{p}</li>
        ))}
      </ol>
      {articulo.notas !== undefined && articulo.notas.length > 0 ? (
        <aside aria-label="Tenga en cuenta" className="space-y-1 rounded-xl border border-amber-500/40 bg-amber-950/30 p-4 text-sm text-amber-100">
          <h2 className="font-semibold">Tenga en cuenta</h2>
          <ul className="list-disc space-y-1 pl-5">
            {articulo.notas.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </aside>
      ) : null}
    </article>
  );
}

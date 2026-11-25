// ============================================================
// src/renderer/pages/ReportesPage.tsx — Reportes gerenciales con exportación a CSV
// ============================================================
import { useMutation } from "@tanstack/react-query";
import React, { useState } from "react";
import { Aviso } from "../components/Modal";
import { Boton, Campo, Seleccion, Tabla, guardarArchivo, mensajeDeError } from "../components/Gestion";
import { useGestion } from "../services/contexto";
import type { Reporte } from "../services/gestion.api";
import { cantidadTexto, dinero } from "../services/totales";
import { tienePermiso, useSesion } from "../store/sesion.store";

const TIPOS = [
  { valor: "ventas", titulo: "Ventas" },
  { valor: "utilidad", titulo: "Utilidad por producto" },
  { valor: "stock", titulo: "Stock valorado" },
  { valor: "cartera", titulo: "Cartera (por cobrar y por pagar)" },
] as const;

const AGRUPACIONES = [
  { valor: "dia", titulo: "Por día" },
  { valor: "producto", titulo: "Por producto" },
  { valor: "formaPago", titulo: "Por forma de pago" },
  { valor: "cajero", titulo: "Por cajero" },
] as const;

const hoy = (): string => new Date(Date.now() - 5 * 3_600_000).toISOString().slice(0, 10);
const haceUnMes = (): string => new Date(Date.now() - 5 * 3_600_000 - 30 * 86_400_000).toISOString().slice(0, 10);

export function ReportesPage(): React.JSX.Element {
  const g = useGestion();
  const usuario = useSesion((s) => s.usuario);
  const puedeExportar = tienePermiso(usuario, "reportes:exportar");
  const [tipo, setTipo] = useState("ventas");
  const [agrupar, setAgrupar] = useState("dia");
  const [desde, setDesde] = useState(haceUnMes());
  const [hasta, setHasta] = useState(hoy());
  const [aviso, setAviso] = useState<string | null>(null);
  const conPeriodo = tipo === "ventas" || tipo === "utilidad";
  const parametros = { ...(conPeriodo ? { desde, hasta } : {}), ...(tipo === "ventas" ? { agrupar } : {}) };

  const generar = useMutation({ mutationFn: () => g.reporte(tipo, parametros) });
  const exportar = useMutation({
    mutationFn: async () => {
      const { blob, nombre } = await g.reporteCsv(tipo, parametros);
      guardarArchivo(nombre, blob);
      return nombre;
    },
    onSuccess: (nombre) => setAviso(`Archivo ${nombre} descargado`),
  });
  const reporte: Reporte | undefined = generar.data;

  return (
    <section aria-label="Reportes" className="space-y-4">
      <h1 className="text-xl font-semibold text-white">Reportes</h1>
      <form onSubmit={(e) => { e.preventDefault(); setAviso(null); generar.mutate(); }} className="flex flex-wrap items-end gap-3">
        <Seleccion etiqueta="Reporte" valor={tipo} onCambio={(v) => { setTipo(v); generar.reset(); }} opciones={TIPOS} />
        {tipo === "ventas" ? <Seleccion etiqueta="Agrupar" valor={agrupar} onCambio={setAgrupar} opciones={AGRUPACIONES} /> : null}
        {conPeriodo ? (
          <>
            <Campo etiqueta="Desde" tipo="date" valor={desde} onCambio={setDesde} />
            <Campo etiqueta="Hasta" tipo="date" valor={hasta} onCambio={setHasta} />
          </>
        ) : null}
        <Boton tipo="submit" variante="primario" deshabilitado={generar.isPending}>{generar.isPending ? "Generando…" : "Generar"}</Boton>
        {puedeExportar ? <Boton onClick={() => { setAviso(null); exportar.mutate(); }} deshabilitado={exportar.isPending}>Descargar CSV</Boton> : null}
      </form>
      {generar.isError ? <Aviso tipo="error">{mensajeDeError(generar.error)}</Aviso> : null}
      {exportar.isError ? <Aviso tipo="error">{mensajeDeError(exportar.error)}</Aviso> : null}
      {aviso !== null ? <Aviso tipo="exito">{aviso}</Aviso> : null}

      {reporte !== undefined ? (
        <div className="space-y-3">
          <h2 className="font-medium text-white">{reporte.titulo}{reporte.desde !== null ? ` · ${reporte.desde} al ${reporte.hasta ?? "hoy"}` : ""}</h2>
          <Tabla etiqueta={reporte.titulo} filas={reporte.filas} clave={(f) => JSON.stringify(f)} vacio="No hay datos en el periodo"
            columnas={reporte.columnas.map((c) => ({ titulo: c.titulo, derecha: c.tipo !== "texto", celda: (f: Record<string, string | number>) => (c.tipo === "dinero" ? dinero(Number(f[c.clave])) : c.tipo === "numero" ? cantidadTexto(Number(f[c.clave])) : String(f[c.clave] ?? "")) }))} />
          <dl aria-label="Totales del reporte" className="flex flex-wrap gap-x-8 gap-y-1 text-sm text-slate-300">
            {reporte.columnas.filter((c) => reporte.totales[c.clave] !== undefined && c.tipo !== "texto").map((c) => (
              <div key={c.clave}><dt className="inline">{c.titulo}: </dt><dd className="inline font-semibold text-white">{c.tipo === "dinero" ? dinero(reporte.totales[c.clave] ?? 0) : cantidadTexto(reporte.totales[c.clave] ?? 0)}</dd></div>
            ))}
            {reporte.tipo === "cartera" ? (
              <>
                <div><dt className="inline">Por cobrar: </dt><dd className="inline font-semibold text-white">{dinero(reporte.totales["porCobrar"] ?? 0)}</dd></div>
                <div><dt className="inline">Por pagar: </dt><dd className="inline font-semibold text-white">{dinero(reporte.totales["porPagar"] ?? 0)}</dd></div>
              </>
            ) : null}
          </dl>
        </div>
      ) : null}
    </section>
  );
}

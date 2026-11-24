// ============================================================
// src/renderer/pages/LoginPage.tsx — Ingreso del cajero
// ============================================================
import React, { useState } from "react";
import { Aviso } from "../components/Modal";
import { ApiError } from "../services/api";
import { usePos } from "../services/contexto";
import { useSesion } from "../store/sesion.store";

export function LoginPage(): React.JSX.Element {
  const { api } = usePos();
  const iniciar = useSesion((s) => s.iniciar);
  const [usuario, setUsuario] = useState("");
  const [clave, setClave] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const entrar = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      const r = await api.login(usuario.trim(), clave);
      iniciar(r.token, r.usuario);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo iniciar sesión");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-900 p-6">
      <form onSubmit={(e) => void entrar(e)} className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-700 bg-slate-800 p-6 shadow-xl" aria-label="Ingreso">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-lg font-bold text-white">VP</div>
          <div>
            <h1 className="text-xl font-bold text-white">VENDEYA POS</h1>
            <p className="text-xs uppercase tracking-widest text-brand-300">Ingreso de cajero</p>
          </div>
        </div>
        <label className="block text-sm text-slate-300">
          Usuario
          <input autoFocus aria-label="Usuario" value={usuario} onChange={(e) => setUsuario(e.target.value)} autoComplete="username" className="mt-1 h-12 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 text-white outline-none focus:border-brand-400" />
        </label>
        <label className="block text-sm text-slate-300">
          Contraseña
          <input aria-label="Contraseña" type="password" value={clave} onChange={(e) => setClave(e.target.value)} autoComplete="current-password" className="mt-1 h-12 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 text-white outline-none focus:border-brand-400" />
        </label>
        {error !== null ? <Aviso tipo="error">{error}</Aviso> : null}
        <button type="submit" disabled={enviando || usuario.trim() === "" || clave === ""} className="h-12 w-full rounded-lg bg-brand-600 font-semibold text-white disabled:opacity-40">
          {enviando ? "Ingresando…" : "Ingresar"}
        </button>
      </form>
    </main>
  );
}

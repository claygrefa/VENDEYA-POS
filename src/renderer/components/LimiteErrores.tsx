// ============================================================
// src/renderer/components/LimiteErrores.tsx — Un fallo de una pantalla no deja la aplicación en blanco
//
// Atrapa los errores de dibujo de React en la vista activa: muestra un aviso con «Volver a intentar» y deja el menú funcionando
// (cambiar de vista reinicia el límite con la `clave`). El error se informa a la telemetría opcional (si está autorizada).
// ============================================================
import React from "react";

interface Props {
  /** Cambia al cambiar de vista: reinicia el límite */
  clave: string;
  alError?: ((e: unknown) => void) | undefined;
  children: React.ReactNode;
}
interface Estado {
  error: Error | null;
  clave: string;
}

export class LimiteErrores extends React.Component<Props, Estado> {
  override state: Estado = { error: null, clave: this.props.clave };

  static getDerivedStateFromError(error: Error): Partial<Estado> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, estado: Estado): Partial<Estado> | null {
    return props.clave !== estado.clave ? { error: null, clave: props.clave } : null;
  }

  override componentDidCatch(error: Error): void {
    try {
      this.props.alError?.(error);
    } catch {
      /* informar el error nunca debe provocar otro */
    }
  }

  override render(): React.ReactNode {
    if (this.state.error === null) return this.props.children;
    return (
      <div role="alert" className="mx-auto mt-10 max-w-lg space-y-3 rounded-xl border border-red-500/60 bg-red-950/50 p-5 text-red-100">
        <h2 className="text-lg font-semibold">Esta pantalla tuvo un problema</h2>
        <p className="text-sm">Sus datos están a salvo: el problema es solo de visualización. Puede volver a intentar o ir a otra sección del menú.</p>
        <button type="button" onClick={() => this.setState({ error: null })} className="rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-600">
          Volver a intentar
        </button>
      </div>
    );
  }
}

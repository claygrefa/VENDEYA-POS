// ============================================================
// src/renderer/hooks/useSincronizacion.ts — Sincronización multi-caja: refresca lo que otra caja cambió
// ============================================================
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ClienteSync, type EstadoCliente } from "../../server/services/sync/syncCliente";
import { usePos } from "../services/contexto";
import { useSesion } from "../store/sesion.store";

/** Qué consultas quedan desactualizadas cuando cambia cada módulo del servidor. */
export const CONSULTAS_POR_MODULO: Record<string, string[]> = {
  productos: ["productos"],
  inventario: ["productos"],
  compras: ["productos"],
  ventas: ["productos", "colaSri"],
  comandas: ["productos"],
  "listas-precio": ["productos"],
  presentaciones: ["productos"],
  clientes: ["clientes"],
  "cuentas-por-cobrar": ["clientes"],
  turnos: ["turno"],
  comprobantes: ["colaSri"],
};

/** URL WebSocket del servidor a partir de su URL HTTP. */
export const urlWebSocket = (urlHttp: string): string => urlHttp.replace(/^http/, "ws");

/**
 * Conecta esta caja al servidor mientras haya sesión. Devuelve el estado de la conexión para la barra de estado. Si el servidor
 * no tiene activa la sincronización LAN (cierre 4403) no es un error: la caja funciona sola.
 */
export function useSincronizacion(baseUrl: string): { estado: EstadoCliente; desactivada: boolean } {
  const { crearSocket, cajaId } = usePos();
  const token = useSesion((s) => s.token);
  const cliente = useQueryClient();
  const [estado, setEstado] = useState<EstadoCliente>("DESCONECTADO");
  const [desactivada, setDesactivada] = useState(false);

  useEffect(() => {
    if (token === null) return;
    setDesactivada(false);
    const sync = new ClienteSync(
      { url: urlWebSocket(baseUrl), token, cajaId, crearSocket },
      {
        estado: setEstado,
        evento: (e) => {
          // Lo que cambió esta misma caja ya se refrescó al terminar la operación
          if (e.cajaId === cajaId) return;
          for (const clave of CONSULTAS_POR_MODULO[e.modulo] ?? []) void cliente.invalidateQueries({ queryKey: [clave] });
        },
        resync: () => void cliente.invalidateQueries(),
        cerrado: (codigo) => setDesactivada(codigo === 4403),
      }
    );
    sync.conectar();
    return () => sync.desconectar();
  }, [baseUrl, token, cajaId, crearSocket, cliente]);

  return { estado, desactivada };
}

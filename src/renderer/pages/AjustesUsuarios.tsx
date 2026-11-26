// ============================================================
// src/renderer/pages/AjustesUsuarios.tsx — Ajustes › Usuarios: alta, edición, rol, contraseña y desactivación (administrador)
// Las personas no se borran (figuran en turnos y ventas): se desactivan. El servidor aplica las reglas; aquí solo se explican.
// ============================================================
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useState } from "react";
import { Boton, Campo, Seleccion, Tabla, mensajeDeError } from "../components/Gestion";
import { Aviso, Modal } from "../components/Modal";
import type { DatosUsuarioNuevo, RolGestion, UsuarioGestion } from "../services/ajustes.api";
import { useAjustes } from "../services/contexto";
import { tienePermiso, useSesion } from "../store/sesion.store";

const CLAVE = ["ajustes", "usuarios"] as const;
const fechaHora = (iso: string | null): string => (iso === null ? "Nunca" : new Date(iso).toLocaleString("es-EC", { dateStyle: "medium", timeStyle: "short" }));
const textoONulo = (v: string): string | null => (v.trim() === "" ? null : v.trim());

type Accion = { tipo: "nuevo" } | { tipo: "editar"; usuario: UsuarioGestion } | { tipo: "password"; usuario: UsuarioGestion } | { tipo: "estado"; usuario: UsuarioGestion };

export function SeccionUsuarios(): React.JSX.Element {
  const a = useAjustes();
  const yo = useSesion((s) => s.usuario);
  const [busqueda, setBusqueda] = useState("");
  const [estado, setEstado] = useState("");
  const [accion, setAccion] = useState<Accion | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  const roles = useQuery({ queryKey: ["ajustes", "roles"], queryFn: () => a.roles(), staleTime: 300_000 });
  const q = useQuery({
    queryKey: [...CLAVE, busqueda, estado],
    queryFn: () => a.usuarios({ ...(busqueda.trim() !== "" ? { q: busqueda.trim() } : {}), ...(estado !== "" ? { estado } : {}) }),
    placeholderData: (p) => p,
  });
  const puedeCrear = tienePermiso(yo, "usuarios:crear");
  const puedeEditar = tienePermiso(yo, "usuarios:actualizar");
  const cerrar = (mensaje?: string): void => { setAccion(null); if (mensaje !== undefined) setExito(mensaje); };

  return (
    <div className="max-w-5xl space-y-4">
      <p className="text-sm text-slate-400">Las personas que usan el sistema. No se borran: se desactivan, y su historial (ventas, turnos) se conserva.</p>
      <div className="flex flex-wrap gap-3">
        <input aria-label="Buscar usuario" placeholder="Usuario, nombre o cédula" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} className="h-10 min-w-56 flex-1 rounded-lg border border-slate-600 bg-slate-900 px-3 text-white" />
        <div className="w-44">
          <Seleccion etiqueta="Estado" valor={estado} onCambio={setEstado} opciones={[{ valor: "", titulo: "Todos" }, { valor: "ACTIVO", titulo: "Activos" }, { valor: "INACTIVO", titulo: "Inactivos" }]} />
        </div>
        {puedeCrear ? <div className="self-end"><Boton variante="primario" onClick={() => { setExito(null); setAccion({ tipo: "nuevo" }); }}>Nuevo usuario</Boton></div> : null}
      </div>
      {exito !== null ? <Aviso tipo="exito">{exito}</Aviso> : null}
      {q.isError ? <Aviso tipo="error">{mensajeDeError(q.error)}</Aviso> : null}
      <Tabla etiqueta="Usuarios" cargando={q.isFetching} filas={q.data?.items} clave={(u) => u.id} vacio="No hay usuarios con ese filtro"
        columnas={[
          { titulo: "Usuario", celda: (u) => <span className="font-mono text-xs">{u.username}{u.id === yo?.id ? " (usted)" : ""}</span> },
          { titulo: "Nombre", celda: (u) => `${u.nombre} ${u.apellido}` },
          { titulo: "Rol", celda: (u) => u.rol },
          { titulo: "Estado", celda: (u) => (u.estado === "ACTIVO" ? <span className="text-emerald-300">Activo{u.sesionesActivas > 0 ? " · en línea" : ""}</span> : <span className="text-slate-400">Inactivo</span>) },
          { titulo: "Último acceso", celda: (u) => fechaHora(u.ultimoAcceso) },
          {
            titulo: "Acciones",
            celda: (u) => (
              <div className="flex flex-wrap gap-1">
                {puedeEditar ? <Boton onClick={() => { setExito(null); setAccion({ tipo: "editar", usuario: u }); }}>{`Editar ${u.username}`}</Boton> : null}
                {puedeEditar && u.id !== yo?.id ? <Boton onClick={() => { setExito(null); setAccion({ tipo: "password", usuario: u }); }}>{`Contraseña de ${u.username}`}</Boton> : null}
                {puedeEditar && u.id !== yo?.id ? <Boton variante={u.estado === "ACTIVO" ? "peligro" : "normal"} onClick={() => { setExito(null); setAccion({ tipo: "estado", usuario: u }); }}>{`${u.estado === "ACTIVO" ? "Desactivar" : "Activar"} ${u.username}`}</Boton> : null}
              </div>
            ),
          },
        ]} />
      {accion?.tipo === "nuevo" ? <FormularioUsuario usuario={null} roles={roles.data?.items ?? []} onCerrar={cerrar} /> : null}
      {accion?.tipo === "editar" ? <FormularioUsuario usuario={accion.usuario} roles={roles.data?.items ?? []} onCerrar={cerrar} /> : null}
      {accion?.tipo === "password" ? <RestablecerPassword usuario={accion.usuario} onCerrar={cerrar} /> : null}
      {accion?.tipo === "estado" ? <ConfirmarEstado usuario={accion.usuario} onCerrar={cerrar} /> : null}
    </div>
  );
}

function FormularioUsuario({ usuario, roles, onCerrar }: { usuario: UsuarioGestion | null; roles: RolGestion[]; onCerrar: (mensaje?: string) => void }): React.JSX.Element {
  const a = useAjustes();
  const qc = useQueryClient();
  const yo = useSesion((s) => s.usuario);
  const esNuevo = usuario === null;
  const [f, setF] = useState({
    username: "", password: "", rol: usuario?.rol ?? "CAJERO", nombre: usuario?.nombre ?? "", apellido: usuario?.apellido ?? "",
    email: usuario?.email ?? "", cedula: usuario?.cedula ?? "", telefono: usuario?.telefono ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const poner = (k: keyof typeof f) => (v: string): void => setF((x) => ({ ...x, [k]: v }));
  // Nadie se cambia el rol a sí mismo (lo rechaza el servidor; aquí ni se ofrece)
  const rolBloqueado = usuario !== null && usuario.id === yo?.id;
  const descripcion = roles.find((r) => r.nombre === f.rol)?.descripcion;
  const opcionesRol = (roles.length > 0 ? roles : [{ nombre: f.rol, descripcion: "" }]).map((r) => ({ valor: r.nombre, titulo: r.nombre }));

  const guardar = useMutation({
    mutationFn: () => {
      const comunes = { nombre: f.nombre.trim(), apellido: f.apellido.trim(), email: textoONulo(f.email), cedula: textoONulo(f.cedula), telefono: textoONulo(f.telefono) };
      if (esNuevo) {
        const datos: DatosUsuarioNuevo = { username: f.username.trim(), password: f.password, rol: f.rol, ...comunes };
        return a.crearUsuario(datos);
      }
      return a.actualizarUsuario(usuario.id, { ...comunes, ...(rolBloqueado ? {} : { rol: f.rol }) });
    },
    onSuccess: async (u) => { await qc.invalidateQueries({ queryKey: CLAVE }); onCerrar(esNuevo ? `Usuario ${u.username} creado` : `Datos de ${u.username} guardados`); },
    onError: (e) => setError(mensajeDeError(e)),
  });
  const cambiaRol = !esNuevo && !rolBloqueado && f.rol !== usuario.rol;

  return (
    <Modal titulo={esNuevo ? "Nuevo usuario" : `Editar ${usuario.username}`} ancho="lg" ayuda="ESC cancela">
      <form onSubmit={(e) => { e.preventDefault(); setError(null); guardar.mutate(); }} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          {esNuevo ? <Campo etiqueta="Nombre de usuario" valor={f.username} onCambio={poner("username")} autofoco placeholder="p. ej. maria.perez" /> : <Campo etiqueta="Nombre de usuario" valor={usuario.username} onCambio={() => undefined} deshabilitado />}
          {esNuevo ? <Campo etiqueta="Contraseña" tipo="password" valor={f.password} onCambio={poner("password")} placeholder="Mínimo 8 caracteres" /> : <div />}
          <Campo etiqueta="Nombre" valor={f.nombre} onCambio={poner("nombre")} autofoco={!esNuevo} />
          <Campo etiqueta="Apellido" valor={f.apellido} onCambio={poner("apellido")} />
          <div className="col-span-2">
            <Seleccion etiqueta="Rol" valor={f.rol} onCambio={poner("rol")} opciones={opcionesRol} />
            {descripcion !== undefined && descripcion !== "" ? <p className="mt-1 text-xs text-slate-400">{descripcion}</p> : null}
            {rolBloqueado ? <p className="mt-1 text-xs text-amber-300">No puede cambiar su propio rol: pídaselo a otro administrador.</p> : null}
          </div>
          <Campo etiqueta="Correo electrónico" tipo="email" valor={f.email} onCambio={poner("email")} />
          <Campo etiqueta="Cédula" valor={f.cedula} onCambio={poner("cedula")} />
          <Campo etiqueta="Teléfono" valor={f.telefono} onCambio={poner("telefono")} />
        </div>
        {cambiaRol ? <Aviso tipo="info">Al cambiar el rol se cerrará la sesión de {usuario.username}: volverá a entrar con los permisos del rol nuevo.</Aviso> : null}
        {error !== null ? <Aviso tipo="error">{error}</Aviso> : null}
        <div className="flex justify-end gap-2">
          <Boton onClick={() => onCerrar()}>Cancelar</Boton>
          <Boton tipo="submit" variante="primario" deshabilitado={guardar.isPending}>{esNuevo ? "Crear usuario" : "Guardar"}</Boton>
        </div>
      </form>
    </Modal>
  );
}

function RestablecerPassword({ usuario, onCerrar }: { usuario: UsuarioGestion; onCerrar: (mensaje?: string) => void }): React.JSX.Element {
  const a = useAjustes();
  const qc = useQueryClient();
  const [nueva, setNueva] = useState("");
  const [repetida, setRepetida] = useState("");
  const [mia, setMia] = useState("");
  const [error, setError] = useState<string | null>(null);
  const guardar = useMutation({
    mutationFn: () => {
      if (nueva !== repetida) throw new Error("Las contraseñas nuevas no coinciden");
      return a.restablecerPassword(usuario.id, { passwordAdmin: mia, password: nueva });
    },
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: CLAVE }); onCerrar(`Contraseña de ${usuario.username} cambiada. Su sesión se cerró y debe entrar con la nueva.`); },
    onError: (e) => setError(mensajeDeError(e)),
  });
  return (
    <Modal titulo={`Nueva contraseña para ${usuario.username}`} ancho="sm" ayuda="ESC cancela">
      <form onSubmit={(e) => { e.preventDefault(); setError(null); guardar.mutate(); }} className="space-y-3">
        <Campo etiqueta="Contraseña nueva" tipo="password" valor={nueva} onCambio={setNueva} autofoco placeholder="Mínimo 8 caracteres" />
        <Campo etiqueta="Repita la contraseña nueva" tipo="password" valor={repetida} onCambio={setRepetida} />
        <Campo etiqueta="Su contraseña (administrador)" tipo="password" valor={mia} onCambio={setMia} />
        <p className="text-xs text-slate-400">Entréguesela a la persona en privado. Se cerrarán sus sesiones abiertas.</p>
        {error !== null ? <Aviso tipo="error">{error}</Aviso> : null}
        <div className="flex justify-end gap-2">
          <Boton onClick={() => onCerrar()}>Cancelar</Boton>
          <Boton tipo="submit" variante="primario" deshabilitado={guardar.isPending}>Cambiar contraseña</Boton>
        </div>
      </form>
    </Modal>
  );
}

function ConfirmarEstado({ usuario, onCerrar }: { usuario: UsuarioGestion; onCerrar: (mensaje?: string) => void }): React.JSX.Element {
  const a = useAjustes();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const desactivar = usuario.estado === "ACTIVO";
  const cambiar = useMutation({
    mutationFn: () => a.estadoUsuario(usuario.id, desactivar ? "INACTIVO" : "ACTIVO"),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: CLAVE }); onCerrar(`${usuario.username} quedó ${desactivar ? "desactivado" : "activo"}`); },
    onError: (e) => setError(mensajeDeError(e)),
  });
  return (
    <Modal titulo={`${desactivar ? "Desactivar" : "Activar"} a ${usuario.username}`} ancho="sm" ayuda="ESC cancela">
      <div className="space-y-3">
        <p className="text-sm text-slate-300">
          {desactivar
            ? `${usuario.nombre} ${usuario.apellido} no podrá entrar al sistema y su sesión se cerrará ahora. Su historial se conserva y puede activarlo de nuevo cuando quiera.`
            : `${usuario.nombre} ${usuario.apellido} podrá volver a entrar con su usuario y contraseña.`}
        </p>
        {error !== null ? <Aviso tipo="error">{error}</Aviso> : null}
        <div className="flex justify-end gap-2">
          <Boton onClick={() => onCerrar()}>Cancelar</Boton>
          <Boton variante={desactivar ? "peligro" : "primario"} deshabilitado={cambiar.isPending} onClick={() => { setError(null); cambiar.mutate(); }}>{desactivar ? "Sí, desactivar" : "Sí, activar"}</Boton>
        </div>
      </div>
    </Modal>
  );
}

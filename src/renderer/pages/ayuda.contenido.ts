// ============================================================
// src/renderer/pages/ayuda.contenido.ts — Artículos del centro de ayuda (locales: funcionan sin internet)
//
// Cada artículo indica para qué roles es. Los pasos describen lo que la aplicación hace realmente (nombres de botones y atajos tal como
// aparecen en pantalla); si se cambia una pantalla hay que cambiar aquí su guía (hay una prueba que comprueba los atajos y los roles).
// ============================================================

export type RolAyuda = "ADMIN" | "SUPERVISOR" | "CAJERO" | "CONTADOR" | "BODEGUERO" | "MESERO" | "COCINA";
export type GrupoAyuda = "cajero" | "supervisor" | "contador" | "administrador" | "general";

export interface ArticuloAyuda {
  id: string;
  titulo: string;
  grupo: GrupoAyuda;
  /** Roles a los que se recomienda; «todos» los muestra siempre en «Para mi rol» */
  roles: ReadonlyArray<RolAyuda> | "todos";
  resumen: string;
  /** Pasos numerados */
  pasos: ReadonlyArray<string>;
  /** Recomendaciones o advertencias al final */
  notas?: ReadonlyArray<string>;
  palabrasClave: ReadonlyArray<string>;
}

export const TITULO_GRUPO: Record<GrupoAyuda, string> = {
  general: "Primeros pasos",
  cajero: "Guía rápida del cajero",
  supervisor: "Guía del supervisor",
  contador: "Guía del contador",
  administrador: "Guía del administrador",
};

export const ARTICULOS: ReadonlyArray<ArticuloAyuda> = [
  {
    id: "atajos",
    titulo: "Atajos de teclado",
    grupo: "general",
    roles: "todos",
    resumen: "Trabaje sin soltar el teclado: la mayoría de las acciones del punto de venta tienen una tecla.",
    pasos: [
      "F2: va a la búsqueda de productos.",
      "F4: elige o cambia el cliente de la venta.",
      "F8: abre el cobro.",
      "ESC: cierra la ventana abierta o cancela.",
      "Enter en la búsqueda: agrega el producto encontrado (también funciona con el lector de códigos de barras).",
      "Ctrl+1, Ctrl+2…: cambia entre las vistas del menú de la izquierda, en el orden en que aparecen.",
    ],
    palabrasClave: ["teclado", "atajos", "f2", "f4", "f8", "esc", "rapido", "lector", "codigo de barras"],
  },
  {
    id: "abrir-turno",
    titulo: "Abrir el turno de caja",
    grupo: "cajero",
    roles: ["CAJERO", "SUPERVISOR", "ADMIN"],
    resumen: "Antes de vender hay que abrir un turno con el efectivo con el que empieza la caja.",
    pasos: [
      "Inicie sesión con su usuario y contraseña.",
      "En la pantalla «Apertura de turno» elija el punto de emisión (la caja) e indique el monto de apertura: el efectivo que hay en la gaveta.",
      "Confirme. Se abre la pantalla de venta.",
    ],
    notas: ["Si el sistema indica que ya tiene un turno abierto, continúe con ese. Cada cajero tiene su propio turno.", "Sin una licencia vigente no se pueden abrir turnos: pida al administrador que la active en Ajustes › Licencia."],
    palabrasClave: ["turno", "apertura", "abrir", "caja", "efectivo", "inicio", "licencia"],
  },
  {
    id: "vender",
    titulo: "Registrar una venta",
    grupo: "cajero",
    roles: ["CAJERO", "SUPERVISOR", "ADMIN"],
    resumen: "Buscar o escanear los productos, elegir al cliente y cobrar.",
    pasos: [
      "Busque el producto por nombre o código (F2) o escanee el código de barras. Con Enter se agrega al carrito.",
      "Para cambiar la cantidad, el precio o aplicar un descuento, toque la línea del carrito.",
      "Si el comprador pide factura con sus datos, elija el cliente (F4). Si no, la venta sale a nombre de Consumidor Final.",
      "Presione F8 para cobrar. Indique la forma de pago (efectivo, tarjeta, transferencia, crédito…) y el monto recibido; el sistema calcula el cambio.",
      "Confirme el cobro: se descuenta el inventario, se imprime el ticket (si hay impresora configurada) y se abre la gaveta (si está configurada).",
    ],
    notas: [
      "Un producto vendido por peso se agrega con la balanza conectada o escribiendo el peso.",
      "Si no hay internet, la venta se registra igual: la factura electrónica queda en cola y se envía sola al SRI cuando vuelve la conexión.",
      "No se puede vender más de lo que hay en existencia.",
      "Al terminar, el botón «Guardar factura (PDF)» guarda en el equipo la factura de esa venta, para entregarla o enviarla al cliente (útil si no hay impresora). Si la venta no generó factura, el botón no aparece.",
    ],
    palabrasClave: ["venta", "cobrar", "guardar", "pdf", "factura", "carrito", "cliente", "consumidor final", "pago", "cambio", "ticket", "descuento", "balanza", "stock"],
  },
  {
    id: "anular",
    titulo: "Anular una venta",
    grupo: "supervisor",
    roles: ["SUPERVISOR", "ADMIN"],
    resumen: "Solo quien tiene permiso de anulación puede deshacer una venta; el inventario y la caja se corrigen solos.",
    pasos: [
      "Abra la vista «Caja» y busque la venta en la lista de ventas del turno.",
      "Presione «Anular» junto a esa venta e indique el motivo (es obligatorio y queda registrado).",
      "Confirme con «Anular venta». Se devuelven los productos al inventario y se revierte el cobro.",
    ],
    notas: ["Si la venta ya tenía factura electrónica, consulte con su contador cómo corregir el comprobante ante el SRI.", "Las ventas anuladas siguen en el historial, para que el registro sea completo."],
    palabrasClave: ["anular", "anulacion", "devolucion", "motivo", "reversar", "nota de credito"],
  },
  {
    id: "movimientos-caja",
    titulo: "Ingresos y egresos de efectivo",
    grupo: "cajero",
    roles: ["CAJERO", "SUPERVISOR", "ADMIN"],
    resumen: "Registre el dinero que entra o sale de la gaveta fuera de las ventas (pagar a un proveedor, retirar un excedente).",
    pasos: ["Vaya a «Caja» y presione «Ingreso / egreso».", "Elija si es ingreso o egreso, escriba el monto y el motivo.", "Presione «Registrar». El movimiento se tendrá en cuenta al cerrar el turno."],
    palabrasClave: ["ingreso", "egreso", "retiro", "gasto", "gaveta", "efectivo", "movimiento"],
  },
  {
    id: "cerrar-turno",
    titulo: "Cerrar el turno (cierre ciego)",
    grupo: "cajero",
    roles: ["CAJERO", "SUPERVISOR", "ADMIN"],
    resumen: "Al terminar, cuente el efectivo y regístrelo: el sistema compara con lo esperado y muestra la diferencia.",
    pasos: [
      "Vaya a «Caja» y presione «Cerrar turno».",
      "Cuente el dinero de la gaveta y escriba el efectivo contado. El efectivo esperado NO se muestra hasta cerrar (cierre ciego): así el conteo es honesto.",
      "Confirme con «Cerrar turno». Verá el cuadre: esperado, contado y diferencia (sobrante o faltante).",
      "Use «Imprimir arqueo» si necesita el comprobante en papel.",
    ],
    notas: ["Una diferencia grande se explica con el supervisor antes de entregar la caja.", "Un turno cerrado no se puede volver a abrir: se abre uno nuevo."],
    palabrasClave: ["cerrar", "cierre", "cuadre", "arqueo", "diferencia", "sobrante", "faltante", "ciego", "contado"],
  },
  {
    id: "supervisar-caja",
    titulo: "Revisar la caja de otros cajeros",
    grupo: "supervisor",
    roles: ["SUPERVISOR", "ADMIN"],
    resumen: "El supervisor consulta los turnos ajenos y los reportes de ventas por cajero.",
    pasos: [
      "En «Reportes» elija «Ventas» y agrupe por cajero para comparar a su equipo.",
      "En «Caja» puede consultar y operar turnos ajenos porque su rol incluye ese permiso.",
      "Revise las anulaciones y sus motivos en el listado de ventas del turno.",
    ],
    palabrasClave: ["supervisor", "cajeros", "turnos", "control", "reporte", "anulaciones"],
  },
  {
    id: "clientes",
    titulo: "Clientes y crédito",
    grupo: "cajero",
    roles: ["CAJERO", "SUPERVISOR", "ADMIN", "CONTADOR"],
    resumen: "Cree clientes con RUC o cédula, y registre los abonos de los que compran a crédito.",
    pasos: [
      "En «Clientes» use «Nuevo cliente»: tipo de identificación, número, nombres y correo (la factura electrónica se envía a ese correo).",
      "Para vender a crédito el cliente debe tener un límite de crédito; la venta queda como cuenta por cobrar.",
      "Cuando el cliente paga, abra la pestaña «Cuentas por cobrar» de «Clientes» y registre el abono: el saldo se descuenta y el dinero entra a la caja.",
    ],
    palabrasClave: ["cliente", "ruc", "cedula", "credito", "abono", "cuenta por cobrar", "cartera", "correo"],
  },
  {
    id: "inventario",
    titulo: "Inventario, compras y ajustes",
    grupo: "supervisor",
    roles: ["BODEGUERO", "SUPERVISOR", "ADMIN", "CONTADOR"],
    resumen: "Mantenga el catálogo, registre las compras y corrija las existencias.",
    pasos: [
      "En «Inventario» cree productos con «Nuevo producto» (código, nombre, precio, impuesto) y edite los existentes.",
      "En «Compras» registre la factura del proveedor: se suma al inventario y se actualiza el costo promedio.",
      "Para corregir una existencia (merma, daño, conteo físico) use el botón «Ajustar» del producto e indique el motivo; el movimiento queda en el Kardex (botón «Kardex»).",
      "Revise la pestaña «Alertas»: stock bajo y, en farmacias, productos por vencer.",
    ],
    notas: ["El Kardex guarda cada entrada y salida: nada se borra, se corrige con otro movimiento."],
    palabrasClave: ["inventario", "producto", "compra", "proveedor", "kardex", "ajuste", "merma", "stock", "costo", "lote", "vencimiento", "farmacia"],
  },
  {
    id: "sri-comprobantes",
    titulo: "Comprobantes electrónicos y estado ante el SRI",
    grupo: "contador",
    roles: ["CONTADOR", "SUPERVISOR", "ADMIN"],
    resumen: "Cada venta con factura genera un comprobante que se firma y se envía al SRI en segundo plano.",
    pasos: [
      "Abra «Comprobantes SRI»: allí se ve cada comprobante con su estado (pendiente, enviado, autorizado, rechazado).",
      "Un comprobante «pendiente» espera conexión o su turno en la cola: se envía solo.",
      "Si quedó rechazado o con error, abra su detalle, lea el motivo y use «Reintentar envío» cuando lo haya corregido.",
      "Descargue el RIDE (el PDF de la factura) con el botón «RIDE» de cada comprobante.",
    ],
    notas: [
      "La firma exige el certificado digital (.p12) vigente: se carga en Ajustes › Certificado de firma. Sin certificado los comprobantes no se pueden firmar.",
      "El ambiente (Pruebas o Producción) se elige en Ajustes › Empresa. Los comprobantes de Pruebas no tienen validez tributaria.",
    ],
    palabrasClave: ["sri", "factura", "comprobante", "autorizado", "rechazado", "reintentar", "ride", "pdf", "firma", "certificado", "cola", "electronica"],
  },
  {
    id: "ats-reportes",
    titulo: "Reportes y Anexo Transaccional (ATS)",
    grupo: "contador",
    roles: ["CONTADOR", "SUPERVISOR", "ADMIN"],
    resumen: "Ventas, utilidad, stock valorado y cartera; y el ATS del mes para declarar.",
    pasos: [
      "En «Reportes» elija el tipo (ventas, utilidad, stock valorado, cartera), el rango de fechas y presione «Generar».",
      "Los reportes largos se muestran por páginas de 100 filas; los totales y la descarga CSV incluyen todas las filas.",
      "Use la descarga CSV para abrir el reporte en Excel.",
      "En «Comprobantes SRI» use «Descargar ATS» con el año y el mes: obtiene el archivo XML del Anexo Transaccional Simplificado.",
    ],
    notas: ["Con muchos meses de datos, el reporte de utilidad y el ATS pueden tardar varios segundos: espere a que termine."],
    palabrasClave: ["reporte", "ats", "anexo", "csv", "excel", "utilidad", "ventas por dia", "cartera", "stock valorado", "declaracion", "xml"],
  },
  {
    id: "config-inicial",
    titulo: "Configuración del negocio",
    grupo: "administrador",
    roles: ["ADMIN"],
    resumen: "Datos de la empresa, giro del negocio, módulos, impresora y balanza.",
    pasos: [
      "Ajustes › Empresa: razón social, RUC, dirección y ambiente del SRI (Pruebas o Producción).",
      "Ajustes › Giro y módulos: elija el giro (tienda, ferretería, farmacia, restaurante…) y active solo los módulos que usa.",
      "Ajustes › Impresora: tipo de conexión y ancho del papel (58 o 80 mm); pruebe con «Imprimir prueba».",
      "Ajustes › Balanza: puerto serial y protocolo, si vende por peso.",
    ],
    notas: ["Cambiar el ambiente a Producción cambia el valor tributario de los comprobantes: hágalo solo cuando el certificado y la numeración estén listos."],
    palabrasClave: ["configuracion", "empresa", "giro", "modulos", "impresora", "balanza", "ambiente", "produccion", "pruebas"],
  },
  {
    id: "usuarios",
    titulo: "Usuarios: crear personas, cambiar su rol y desactivarlas",
    grupo: "administrador",
    roles: ["ADMIN"],
    resumen: "Quién puede entrar al sistema y qué puede hacer cada persona.",
    pasos: [
      "En Ajustes › Usuarios pulse «Nuevo usuario»: escriba el nombre de usuario (en minúsculas, sin espacios), una contraseña de al menos 8 caracteres, los datos de la persona y elija su rol.",
      "El rol define lo que ve y puede hacer: el cajero vende, el supervisor anula y arquea, el bodeguero maneja el inventario, el contador consulta reportes, el mesero y la cocina atienden las mesas.",
      "Para corregir datos o cambiar el rol use «Editar». Al cambiarle el rol se cierra su sesión: entra de nuevo con los permisos nuevos.",
      "Si olvidó su contraseña, pulse «Contraseña de…», escriba la nueva y confirme con la suya de administrador. Entréguesela en privado.",
      "Cuando alguien deja de trabajar con usted, pulse «Desactivar»: no podrá entrar y su sesión se cierra al instante, pero su historial de ventas y turnos se conserva. Puede activarlo de nuevo.",
    ],
    notas: [
      "Las personas no se borran, solo se desactivan, para no perder quién hizo cada venta.",
      "No se puede desactivar a quien tiene un turno de caja abierto (ciérrelo antes), ni cambiarse el rol o desactivarse a uno mismo, ni quedarse sin ningún administrador activo.",
      "Cada persona puede cambiar su propia contraseña con el botón «Mi contraseña» de la barra superior.",
    ],
    palabrasClave: ["usuarios", "usuario", "crear", "rol", "permisos", "contrasena", "clave", "olvido", "desactivar", "activar", "cajero", "empleado", "personal"],
  },
  {
    id: "sucursales",
    titulo: "Sucursales y cajas (puntos de emisión)",
    grupo: "administrador",
    roles: ["ADMIN"],
    resumen: "Agregue locales y cajas nuevas, y retire las que ya no usa.",
    pasos: [
      "En Ajustes › Sucursales pulse «Nueva sucursal» y escriba su nombre, dirección y teléfono. El sistema le asigna el siguiente código (002, 003…) y crea su «Caja principal».",
      "Para otra caja en el mismo local use «Agregar caja a…». Cada caja lleva su propia numeración de facturas.",
      "Para cambiar el nombre o los datos use «Editar»; el código no se puede cambiar.",
      "Una sucursal o una caja que ya no se usa se desactiva: deja de ofrecerse para abrir turnos y vender, y todo su historial se conserva.",
    ],
    notas: [
      "Antes de facturar con una sucursal nueva, el establecimiento debe estar registrado en el SRI (en el RUC de la empresa); si no, las facturas serán rechazadas.",
      "No se puede desactivar una sucursal con turnos de caja o cuentas de mesa abiertos, ni dejar a la empresa sin ninguna caja activa.",
    ],
    palabrasClave: ["sucursal", "sucursales", "local", "establecimiento", "caja", "cajas", "punto de emision", "serie", "codigo", "001", "002"],
  },
  {
    id: "certificado",
    titulo: "Certificado de firma electrónica",
    grupo: "administrador",
    roles: ["ADMIN", "CONTADOR"],
    resumen: "Cargue el archivo .p12 que le entregó la entidad certificadora para poder firmar las facturas.",
    pasos: [
      "En Ajustes › Certificado de firma elija el archivo .p12 e ingrese su contraseña.",
      "El sistema muestra el titular, el emisor y la fecha de vencimiento; compruebe que el titular coincide con su RUC.",
      "Anote la fecha de vencimiento: un certificado vencido impide emitir facturas hasta renovarlo.",
    ],
    notas: ["La contraseña del certificado se guarda cifrada en este equipo; nunca se muestra ni se envía a ninguna parte."],
    palabrasClave: ["certificado", "p12", "firma", "token", "vencimiento", "contrasena", "security data", "banco central"],
  },
  {
    id: "licencia",
    titulo: "Licencia y equipos",
    grupo: "administrador",
    roles: ["ADMIN"],
    resumen: "Active la suscripción, consulte su vigencia y libere equipos.",
    pasos: [
      "Ajustes › Licencia: escriba la clave de activación y presione «Activar» (necesita internet solo en ese momento).",
      "La aplicación valida la licencia en línea de vez en cuando; si no hay internet sigue funcionando durante un período de gracia.",
      "Para cambiar de computadora use «Desactivar este equipo» y active la clave en el equipo nuevo.",
    ],
    notas: ["Con la licencia vencida no se pueden registrar ventas ni abrir turnos, pero sí consultar, reportar y cerrar el turno abierto."],
    palabrasClave: ["licencia", "activar", "suscripcion", "clave", "equipo", "dispositivo", "vencida", "gracia"],
  },
  {
    id: "respaldos",
    titulo: "Respaldos de la información",
    grupo: "administrador",
    roles: ["ADMIN"],
    resumen: "La aplicación respalda sola cada día; usted decide además una copia cifrada fuera del equipo.",
    pasos: [
      "El sistema guarda un respaldo automático al día en el equipo (se conservan los últimos 7) y otro antes de cada actualización.",
      "Ajustes › Respaldos › «Respaldar ahora» crea uno manual en cualquier momento.",
      "Copia en la nube: elija una carpeta que sincronice OneDrive, Google Drive o Dropbox (o un disco externo) y escriba una frase de al menos 12 caracteres. Las copias salen cifradas: nadie sin la frase puede leerlas.",
      "Presione «Copiar a la nube ahora» para probarlo; desde entonces la copia se actualiza sola cada día.",
    ],
    notas: [
      "ANOTE LA FRASE EN UN LUGAR SEGURO Y APARTE. Sin ella no es posible recuperar la copia de la nube; nadie, ni el soporte, puede recuperarla.",
      "Si el disco externo no está conectado o la carpeta no existe, el respaldo en la nube falla y el sistema se lo indica.",
    ],
    palabrasClave: ["respaldo", "copia de seguridad", "backup", "nube", "cifrado", "frase", "onedrive", "drive", "dropbox", "disco externo"],
  },
  {
    id: "restaurar",
    titulo: "Restaurar la información desde un respaldo",
    grupo: "administrador",
    roles: ["ADMIN"],
    resumen: "Vuelva a una copia anterior si la información se dañó o se perdió. Reemplaza TODOS los datos actuales.",
    pasos: [
      "Ajustes › Respaldos: en «Restaurar» elija el respaldo (del equipo o de la nube).",
      "Si es de la nube, escriba la frase con la que se cifró. Escriba también su contraseña de administrador para confirmar.",
      "Presione «Preparar restauración». El sistema comprueba que la copia sirve, pero todavía NO cambia nada.",
      "Cierre la aplicación por completo y vuelva a abrirla: al arrancar se aplica la restauración.",
      "Revise que los datos sean los esperados. La base anterior se conserva en la carpeta de datos con el nombre «…antes-de-restaurar-fecha», por si necesita volver atrás.",
    ],
    notas: [
      "Las ventas hechas después de la fecha del respaldo no estarán en la base restaurada.",
      "«Cancelar restauración» descarta lo preparado si se arrepiente antes de reabrir.",
      "En una computadora nueva: instale la aplicación, configure la carpeta de la nube con la misma frase y restaure la copia más reciente.",
    ],
    palabrasClave: ["restaurar", "recuperar", "respaldo", "copia", "perdida", "danada", "nueva computadora", "frase", "antes de restaurar"],
  },
  {
    id: "privacidad",
    titulo: "Reporte de errores (privacidad)",
    grupo: "administrador",
    roles: ["ADMIN"],
    resumen: "Opcional y desactivado: usted decide si se envía información técnica de errores para mejorar el programa.",
    pasos: [
      "Ajustes › Privacidad: active «Enviar reportes de errores» solo si está de acuerdo.",
      "Antes de enviar puede ver exactamente cada reporte («Ver reportes pendientes»).",
      "Solo se reúne: versión del programa, sistema operativo y el error técnico. Nunca ventas, clientes, productos, claves, RUC, correos ni rutas con su nombre de usuario.",
      "Puede desactivarlo cuando quiera: al hacerlo se borra lo que estuviera pendiente.",
    ],
    palabrasClave: ["privacidad", "telemetria", "errores", "reportes", "datos", "enviar", "consentimiento"],
  },
  {
    id: "problemas",
    titulo: "Solución de problemas frecuentes",
    grupo: "general",
    roles: "todos",
    resumen: "Qué hacer cuando algo no responde como se espera.",
    pasos: [
      "«Sesión expirada»: vuelva a iniciar sesión (las sesiones duran unas horas y se cierran al reiniciar la aplicación).",
      "«Demasiados intentos fallidos»: espere unos minutos; el sistema bloquea el usuario temporalmente tras varios errores de contraseña.",
      "No imprime: revise Ajustes › Impresora y use «Imprimir prueba»; compruebe papel y cable o red.",
      "Facturas «pendientes» por mucho tiempo: puede ser falta de internet o del certificado; revise «Comprobantes SRI» y el detalle del comprobante.",
      "«No hay stock suficiente»: el producto tiene menos existencia que lo pedido; registre la compra o corrija el inventario.",
      "Otra caja no ve los cambios: la sincronización en red local debe estar activada en Ajustes › Red local en todas las cajas.",
    ],
    notas: ["Si el problema continúa, anote el mensaje exacto que aparece en pantalla antes de pedir ayuda."],
    palabrasClave: ["problema", "error", "no funciona", "sesion", "bloqueado", "intentos", "impresora", "pendiente", "stock", "red"],
  },
];

/** Minúsculas y sin tildes: «Cámara» y «camara» se buscan igual. */
export const normalizar = (t: string): string => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Artículos que coinciden con TODAS las palabras de la búsqueda (en título, resumen, pasos, notas o palabras clave). */
export function buscarArticulos(articulos: ReadonlyArray<ArticuloAyuda>, texto: string): ArticuloAyuda[] {
  const palabras = normalizar(texto).split(/\s+/).filter((p) => p !== "");
  if (palabras.length === 0) return [...articulos];
  return articulos.filter((a) => {
    const pajar = normalizar([a.titulo, a.resumen, ...a.pasos, ...(a.notas ?? []), ...a.palabrasClave].join(" "));
    return palabras.every((p) => pajar.includes(p));
  });
}

export const esParaRol = (a: ArticuloAyuda, rol: string | undefined): boolean => a.roles === "todos" || (rol !== undefined && (a.roles as ReadonlyArray<string>).includes(rol));

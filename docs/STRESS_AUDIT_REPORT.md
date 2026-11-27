# Auditoría de estrés de VENDEYA-POS

Fecha de revisión: 26 de noviembre de 2026. La suite está en `tests/stress/posStress.test.ts` y se incluye en `npm test`. Para ejecutarla por separado, use `npm test -- tests/stress/posStress.test.ts`. El escenario de desconexión requiere TCP local en 127.0.0.1. Para reproducir la corrida completa sin competencia entre archivos, use `npm test -- --poolOptions.forks.maxForks=1 --no-file-parallelism`.

## Alcance

Se ejercitaron Fastify, Prisma y SQLite reales con una base temporal aislada en Windows, Node 24.22.0, Intel Core i5-13420H y 16 GiB de RAM. La firma XAdES y la validación XSD se ejecutan con un certificado de prueba. La recepción y autorización del SRI son simuladas. Los tiempos de catálogo y cobro corresponden a la API por inyección de Fastify y excluyen la red y el repintado de Electron. El corte de una solicitud incompleta sí usa TCP.

El equivalente a `FIRMADO_OFFLINE` en el esquema existente es `PENDIENTE` con XML firmado y reintento programado. La suite comprueba esos tres campos. La confirmación de una transacción ya persistida puede perderse si se corta el enlace después del commit. Reintentar un cobro a ciegas en ese punto sigue siendo un escenario pendiente de idempotencia.

## Hallazgos y rectificaciones

| Archivo | Cambio |
| --- | --- |
| `src/server/index.ts` | Fija `busy_timeout=5000` en la conexión SQLite del backend. La suite comprueba WAL y el timeout activo. |
| `src/server/repositories/producto.repository.ts` | Consulta FTS5 por frase para texto de tres o más caracteres, comprueba las coincidencias con la semántica previa de SQLite `LIKE` y reutiliza el resultado para paginar y contar. Conserva el recorrido directo para consultas cortas o con comodines. |
| `prisma/migrations/20261203090000_catalogo_busqueda_trigram/migration.sql` | Construye el índice FTS5 sobre los productos existentes. Los triggers mantienen el índice al insertar, actualizar o borrar productos. El índice B-tree existente sigue sirviendo a la búsqueda exacta de barras. |
| `src/server/services/ventaCalculo.util.ts` | Corrige el redondeo cerca de medio centavo según la magnitud y agrega los importes de líneas redondeados en centavos enteros. El renderer consume las mismas funciones. |
| `src/server/services/sync/syncCliente.ts` | Evita abrir WebSockets duplicados al llamar dos veces a `conectar` y retira los callbacks que retienen al cliente cuando el socket se cierra. |
| `prisma/schema.prisma` y `prisma/migrations/20261202090000_secuencial_comprobante_unico/migration.sql` | SQLite rechaza el mismo secuencial para un punto de emisión y tipo de comprobante incluso con otra clave de acceso. La migración necesita una base sin duplicados históricos. |
| `tests/unit/server/ventaCalculo.util.test.ts` | Verifica el caso de 10,075 y un valor inmediatamente inferior al punto medio. |
| `tests/integration/server/sync-lan.test.ts` | Comprueba que dos llamadas a `conectar` abren un único socket y que `desconectar` libera los callbacks. |
| `tests/stress/posStress.test.ts` | Catálogo de 25.000, mil ventas, ráfaga de 50, cola offline de 500, fallos de persistencia y de transporte. Comprueba el cierre y eliminación de la base de estrés. |
| `PROJECT_STATUS.md` | Estado del entregable y próxima tarea. |

La venta reserva secuencia, escribe venta y pagos, registra Kardex y, si corresponde, genera y encola el comprobante usando el mismo cliente de transacción. Una validación fiscal de negocio puede cerrar la venta con una advertencia y sin factura. Los fallos de persistencia provocan rollback. La prueba fuerza un fallo al insertar la cola después del descuento de stock y compara el estado antes y después.

El puente de Electron quita el listener IPC envuelto al desuscribirse y el hook de actualizaciones ejecuta esa limpieza al desmontarse. El hook de sincronización desconecta el WebSocket. La revisión de esos puntos fue estática. La memoria medida pertenece al proceso del backend durante la prueba, y no sustituye un perfil prolongado del renderer instalado.

La consulta por nombre llegó a 53,84 ms inicialmente y a 225,69 ms en una corrida con alta contención del equipo aun con el recorrido reutilizado. Cuatro consultas FTS con `LIKE` llegaron a 96,14 ms. Una única frase FTS con comprobación posterior en SQLite bajó el máximo a 28,84 ms en la corrida enfocada. Se verificaron también paginación vacía, deduplicación de coincidencias y mantenimiento del índice al editar y eliminar un producto.

La prueba de migración sobre una base con un producto previo confirmó que el índice se reconstruye con los datos que ya existían. `prisma validate` pasó y la generación de Prisma 5.22.0 pasó en un destino temporal aislado. Windows mantuvo un bloqueo de archivo sobre la DLL instalada en `node_modules/.prisma/client` y bloqueó su reemplazo in situ. Se eliminaron los archivos temporales generados por estas comprobaciones.

## Mediciones de la corrida final

| Escenario | Muestras | p50 | p95 | Máximo |
| --- | ---: | ---: | ---: | ---: |
| Código de barras exacto | 40 | 1,94 ms | 4,50 ms | 5,13 ms |
| Nombre parcial | 40 | 11,31 ms | 20,35 ms | 23,19 ms |
| Cobro durante la sincronización | 25 | 37,15 ms | 60,53 ms | 65,27 ms |

Las 80 consultas medidas, después de tres calentamientos por ruta, cumplieron el límite de 50 ms. Los 1.000 cobros consecutivos de tres líneas se procesaron a 34,85 ventas/s y conservaron el subtotal, IVA de 15/5/0 %, descuento y vuelto esperados. La ráfaga de 50 peticiones duró 2.496,12 ms y registró los 20 cobros que permitía el stock, para 8,01 ventas/s durante esa ráfaga.

- Los otros 30 cobros de la ráfaga devolvieron HTTP 409 por stock insuficiente. No hubo stock negativo, secuenciales duplicados ni errores inesperados de bloqueo. SQLite también rechazó el intento de duplicar un secuencial con una clave de acceso distinta.
- La firma y el primer intento offline de 500 comprobantes tomaron 130,00 s. Tras adelantar el reloj de prueba hasta el reintento, el worker vació la cola en 16,33 s, con 25 lotes de 20 y 500 autorizaciones simuladas únicas. El aumento máximo de RSS muestreado entre lotes fue de 11,30 MiB. Los 25 cobros concurrentes respondieron HTTP 201.
- La validación de pago, el fallo de escritura posterior al movimiento de Kardex y el corte TCP conservaron el estado de caja observado. `integrity_check` devolvió `ok`, `foreign_key_check` no reportó filas y se verificó el borrado de la carpeta temporal.

## Verificación final

Pasaron los tres chequeos de TypeScript y Vitest finalizó con **76 archivos y 1.118 pruebas aprobadas**, incluidas las cinco de estrés. La corrida secuencial duró 783,88 s. Durante la auditoría se observaron avisos de desprecación de la API CJS de Vite y de `act()` en pruebas del renderer. La verificación de un instalador firmado, el perfil prolongado de Electron y la autorización contra el SRI real siguen pendientes.

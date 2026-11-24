# Esquemas XSD oficiales del SRI

Estos archivos **no se escriben a mano**: son copias exactas de los esquemas publicados por el Servicio de Rentas
Internas de Ecuador (descargados el 2026-11-22 desde <https://www.sri.gob.ec/facturacion-electronica>, sección
«Comprobantes electrónicos — esquema offline»). No los modifique: si el SRI publica una versión nueva, reemplácelos
por la oficial y actualice las versiones en `comprobanteXml.builder.ts`.

| Archivo | Comprobante | Paquete oficial |
|---|---|---|
| `factura_V2.1.0.xsd` | Factura 2.1.0 | `XML y XSD Factura.zip` |
| `NotaCredito_V1.1.0.xsd` | Nota de crédito 1.1.0 | `XML y XSD Nota de Crédito.zip` |
| `xmldsig-core-schema.xsd` | Firma XML (W3C XML-Signature 1.0) importado por los dos anteriores | <https://www.w3.org/TR/2002/REC-xmldsig-core-20020212/xmldsig-core-schema.xsd> |

Los paquetes del SRI incluyen también las versiones anteriores (factura 1.0.0, 1.1.0 y 2.0.0; nota de crédito 1.0.0),
que no se emiten desde este sistema. La referencia normativa es la *Ficha Técnica de Comprobantes Electrónicos —
Esquema Offline, versión 2.34* (mismo portal).

Se validan con `xmllint` compilado a WebAssembly (`xmllint-wasm`), por lo que no se requiere compilación nativa.
Para empaquetar la aplicación, `npm run build:main` copia esta carpeta a `dist-electron/` junto al código compilado.

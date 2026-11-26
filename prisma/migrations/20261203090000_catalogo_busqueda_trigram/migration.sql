CREATE VIRTUAL TABLE "ProductoBusqueda" USING fts5(
  "nombre", "codigo", "codigoBarras", "principioActivo",
  content='Producto', content_rowid='rowid', tokenize='trigram'
);

INSERT INTO "ProductoBusqueda"("ProductoBusqueda") VALUES ('rebuild');

CREATE TRIGGER "ProductoBusqueda_insert" AFTER INSERT ON "Producto" BEGIN
  INSERT INTO "ProductoBusqueda"(rowid, nombre, codigo, codigoBarras, principioActivo)
  VALUES (new.rowid, new.nombre, new.codigo, new.codigoBarras, new.principioActivo); END;

CREATE TRIGGER "ProductoBusqueda_delete" AFTER DELETE ON "Producto" BEGIN
  INSERT INTO "ProductoBusqueda"("ProductoBusqueda", rowid, nombre, codigo, codigoBarras, principioActivo)
  VALUES ('delete', old.rowid, old.nombre, old.codigo, old.codigoBarras, old.principioActivo); END;

CREATE TRIGGER "ProductoBusqueda_update" AFTER UPDATE OF nombre, codigo, codigoBarras, principioActivo ON "Producto" BEGIN
  INSERT INTO "ProductoBusqueda"("ProductoBusqueda", rowid, nombre, codigo, codigoBarras, principioActivo)
  VALUES ('delete', old.rowid, old.nombre, old.codigo, old.codigoBarras, old.principioActivo); INSERT INTO "ProductoBusqueda"(rowid, nombre, codigo, codigoBarras, principioActivo)
  VALUES (new.rowid, new.nombre, new.codigo, new.codigoBarras, new.principioActivo); END;

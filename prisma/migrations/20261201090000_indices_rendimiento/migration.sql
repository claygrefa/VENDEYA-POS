-- CreateIndex
CREATE INDEX "Kardex_referencia_idx" ON "Kardex"("referencia");

-- CreateIndex
CREATE INDEX "LineaVenta_ventaId_idx" ON "LineaVenta"("ventaId");

-- CreateIndex
CREATE INDEX "LineaVenta_productoId_idx" ON "LineaVenta"("productoId");

-- CreateIndex
CREATE INDEX "MovimientoCaja_turnoId_idx" ON "MovimientoCaja"("turnoId");

-- CreateIndex
CREATE INDEX "PagoVenta_ventaId_idx" ON "PagoVenta"("ventaId");

-- CreateIndex
CREATE INDEX "Venta_turnoId_idx" ON "Venta"("turnoId");

-- CreateIndex
CREATE INDEX "Venta_cajeroId_createdAt_idx" ON "Venta"("cajeroId", "createdAt");


ALTER TABLE "PurchaseOrder" ADD COLUMN "invoiceNumber" TEXT;
CREATE INDEX "PurchaseOrder_companyId_supplierId_invoiceNumber_idx" ON "PurchaseOrder"("companyId", "supplierId", "invoiceNumber");

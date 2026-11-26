ALTER TABLE "PurchaseOrder" ADD COLUMN "clientRequestId" TEXT;
CREATE UNIQUE INDEX "PurchaseOrder_companyId_supplierId_clientRequestId_key" ON "PurchaseOrder"("companyId", "supplierId", "clientRequestId");

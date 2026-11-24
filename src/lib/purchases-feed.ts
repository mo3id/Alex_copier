import { prisma } from "./prisma";

/**
 * The single query feed behind every purchases screen: external purchase orders
 * plus the intercompany invoices joined to their originating sales order.
 * Shared by `/api/purchases` and the batched bootstrap route so both stay in sync.
 */
export async function getPurchasesFeed() {
  const [purchases, intercompanyRows] = await Promise.all([
    prisma.purchaseOrder.findMany({
      include: {
        supplier: true,
        company: true,
        items: { include: { product: true } },
        invoices: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.interCompanyInvoice.findMany({
      include: {
        fromCompany: { select: { id: true, name: true } },
        toCompany: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const salesOrderIds = Array.from(
    new Set(
      intercompanyRows
        .map((inv) => inv.salesOrderId)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  );

  const salesOrders = salesOrderIds.length
    ? await prisma.salesOrder.findMany({
        where: { id: { in: salesOrderIds } },
        select: {
          id: true,
          orderType: true,
          paymentMethod: true,
          paidAmount: true,
          taxRate: true,
          discount: true,
          discountType: true,
          notes: true,
          engineer: { select: { id: true, name: true } },
          customer: { select: { id: true, name: true } },
          items: { include: { product: true } },
        },
      })
    : [];

  const salesOrderMap = new Map(salesOrders.map((so) => [so.id, so]));

  const intercompany = intercompanyRows.map((inv) => {
    const so = inv.salesOrderId ? salesOrderMap.get(inv.salesOrderId) : undefined;
    return {
      ...inv,
      items: so?.items ?? [],
      customer: so?.customer ? { id: so.customer.id, name: so.customer.name } : null,
      engineer: so?.engineer ? { id: so.engineer.id, name: so.engineer.name } : null,
      orderType: so?.orderType,
      paymentMethod: so?.paymentMethod,
      paidAmount: so?.paidAmount,
      taxRate: so?.taxRate,
      discount: so?.discount,
      discountType: so?.discountType,
    };
  });

  return { orders: purchases, intercompany };
}

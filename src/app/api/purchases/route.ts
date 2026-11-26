import { withApiErrors } from "@/lib/api-errors";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, requirePageAccess, requireAction } from "@/lib/auth-helpers";
import { findOrCreateMainWarehouse, receivePurchaseIntoStock } from "@/lib/stock-movement-helper";
import { normalizePurchaseItems } from "@/lib/purchase-items";
import { traceError } from "@/lib/prisma-errors";
import { getPurchasesFeed } from "@/lib/purchases-feed";

async function GET__raw() {
  try {
    const user = await requirePageAccess("purchases");
    if (!user) {
      const authed = await requireAuth();
      return NextResponse.json(
        { error: authed ? "Forbidden" : "Unauthorized", code: authed ? "FORBIDDEN" : "UNAUTHORIZED" },
        { status: authed ? 403 : 401 }
      );
    }

    const feed = await getPurchasesFeed();
    return NextResponse.json(feed);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to fetch purchases" },
      { status: traceError("[purchases:GET] fetch failed", error) }
    );
  }
}

const PAYMENT_METHOD_VALUES = new Set(["CASH", "CREDIT", "INSTALLMENT", "MIXED"]);

function normalizePurchasePayment(input: {
  paymentMethod?: unknown;
  paidAmount?: unknown;
  total: number;
}): { paymentMethod: "CASH" | "CREDIT" | "INSTALLMENT" | "MIXED"; paymentStatus: "PENDING" | "PARTIAL" | "PAID"; paidAmount: number } {
  const rawMethod = typeof input.paymentMethod === "string" ? input.paymentMethod.trim().toUpperCase() : "";
  const paymentMethod = (PAYMENT_METHOD_VALUES.has(rawMethod) ? rawMethod : "CASH") as "CASH" | "CREDIT" | "INSTALLMENT" | "MIXED";
  const total = Number.isFinite(input.total) && input.total >= 0 ? input.total : 0;
  const provided = input.paidAmount !== undefined && input.paidAmount !== null && input.paidAmount !== "";
  let paidAmountRaw = provided ? Number(input.paidAmount) : NaN;
  if (!Number.isFinite(paidAmountRaw)) paidAmountRaw = paymentMethod === "CASH" ? total : 0;
  paidAmountRaw = Math.max(0, Math.min(paidAmountRaw, total));

  // CASH defaults to fully paid unless an explicit paidAmount was provided.
  const paidAmount = paymentMethod === "CASH" && !provided ? total : paidAmountRaw;
  let paymentStatus: "PENDING" | "PARTIAL" | "PAID" = "PENDING";
  if (paidAmount >= total && total > 0) paymentStatus = "PAID";
  else if (paidAmount > 0) paymentStatus = "PARTIAL";
  else paymentStatus = "PENDING";

  return { paymentMethod, paymentStatus, paidAmount };
}

async function POST__raw(request: Request) {
  try {

    const actor = await requireAction("purchases", "add");
    if (!actor) {
      const authed = await requireAuth();
      return NextResponse.json({ error: authed ? "Forbidden" : "Unauthorized" }, { status: authed ? 403 : 401 });
    }
        const body = await request.json();
    const { items, paymentMethod: rawPaymentMethod, paidAmount: rawPaidAmount, clientRequestId: rawClientRequestId, ...data } = body;
    const clientRequestId = typeof rawClientRequestId === "string" ? rawClientRequestId.trim().slice(0, 120) : "";
    const itemsProvided = Array.isArray(items);
    const normalizedItems = itemsProvided ? normalizePurchaseItems(items) : null;
    const invoiceNumber = typeof data.invoiceNumber === "string" ? data.invoiceNumber.trim().slice(0, 120) : "";
    if (itemsProvided && (!normalizedItems || normalizedItems.length === 0)) {
      return NextResponse.json(
        { error: "بنود أمر الشراء غير صالحة — تأكد من المنتج والكمية والسعر", code: "INVALID_ITEMS" },
        { status: 400 }
      );
    }

    const total = (normalizedItems ?? []).reduce(
      (sum, item) => sum + item.quantity * item.unitPrice,
      0
    );

    const companyId = typeof data.companyId === "string" ? data.companyId : "";
    const supplierId = typeof data.supplierId === "string" ? data.supplierId : "";
    const [company, supplier] = await Promise.all([
      companyId ? prisma.company.findUnique({ where: { id: companyId }, select: { id: true } }) : null,
      supplierId ? prisma.supplier.findUnique({ where: { id: supplierId }, select: { id: true } }) : null,
    ]);
    if (companyId && !company) {
      return NextResponse.json({ error: "الشركة غير موجودة", code: "COMPANY_NOT_FOUND" }, { status: 400 });
    }
    if (!companyId && data.status === "RECEIVED") {
      return NextResponse.json({ error: "الشركة مطلوبة عند استلام أمر الشراء", code: "COMPANY_REQUIRED_FOR_RECEIVE" }, { status: 400 });
    }
    if (supplierId && !supplier) {
      return NextResponse.json({ error: "المورد غير موجود", code: "SUPPLIER_NOT_FOUND" }, { status: 400 });
    }
    if (normalizedItems && normalizedItems.length > 0) {
      const distinct = new Set(normalizedItems.map((item) => item.productId));
      const found = await prisma.product.count({ where: { id: { in: [...distinct] } } });
      if (found !== distinct.size) {
        return NextResponse.json({ error: "منتج غير موجود في سطر المنتجات", code: "PRODUCT_NOT_FOUND" }, { status: 400 });
      }
      const companyMismatch = await prisma.product.count({ where: { id: { in: [...distinct] }, companyId: { not: companyId } } });
      if (companyMismatch > 0) {
        return NextResponse.json({ error: "بعض المنتجات لا تنتمي للشركة المختارة", code: "PRODUCT_COMPANY_MISMATCH" }, { status: 400 });
      }
    }
    if (invoiceNumber) {
      const duplicate = await prisma.purchaseOrder.findFirst({
        where: { companyId, supplierId, invoiceNumber, status: { not: "CANCELLED" } },
        select: { id: true },
      });
      if (duplicate) {
        return NextResponse.json({ error: "رقم بيان/فاتورة المورد مسجل بالفعل لهذا المورد", code: "DUPLICATE_PURCHASE_INVOICE" }, { status: 409 });
      }
    }
    if (clientRequestId) {
      const existingByRequest = await prisma.purchaseOrder.findFirst({
        where: { companyId, supplierId, clientRequestId },
        include: { supplier: true, company: true, items: { include: { product: true } }, invoices: true },
      });
      if (existingByRequest) return NextResponse.json(existingByRequest, { status: 200 });
    }

    const payment = normalizePurchasePayment({ paymentMethod: rawPaymentMethod, paidAmount: rawPaidAmount, total });

    const purchaseOrder = await prisma.$transaction(async (tx) => {
      const created = await tx.purchaseOrder.create({
        data: {
          companyId: data.companyId,
          supplierId: data.supplierId,
          invoiceNumber: invoiceNumber || null,
          clientRequestId: clientRequestId || null,
          status: data.status,
          orderDate: data.orderDate,
          notes: data.notes ?? null,
          total,
          paymentMethod: payment.paymentMethod,
          paymentStatus: payment.paymentStatus,
          paidAmount: payment.paidAmount,
          ...(normalizedItems && {
            items: {
              create: normalizedItems.map((item) => ({
                productId: item.productId,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
              })),
            },
          }),
        },
        include: {
          supplier: true,
          company: true,
          items: {
            include: { product: true },
          },
          invoices: true,
        },
      });

      // دفعة مرتبطة بالفاتورة (نقدًا أو دفعة مقدمة) — تظهر في تقارير الموردين وتسوية الأرصدة.
      if (created.paidAmount > 0) {
        await tx.supplierPayment.create({
          data: {
            supplierId: created.supplierId,
            companyId: created.companyId || null,
            purchaseOrderId: created.id,
            amount: created.paidAmount,
            paymentDate: created.orderDate ? new Date(created.orderDate) : new Date(),
            paymentMethod: created.paymentMethod === "CASH" ? "كاش" : "دفعة مع فاتورة شراء",
            docNumber: `PO-${created.id.slice(0, 8)}`,
            notes: created.paymentMethod === "CASH" ? `سداد نقدي مع فاتورة شراء #${created.id.slice(0, 8)}` : `دفعة مع فاتورة شراء #${created.id.slice(0, 8)}`,
          },
        });
      }

      // استلام فوري عند الإنشاء: أدخل البضاعة للمخزون مرتبطة بأمر الشراء الحقيقي.
      if (created.status === "RECEIVED") {
        const warehouse = await findOrCreateMainWarehouse(tx, created.companyId);
        await receivePurchaseIntoStock(tx, {
          purchaseOrderId: created.id,
          warehouseId: warehouse.id,
          items: (created.items as unknown as { productId: string; quantity: number; unitPrice: number }[]).map((it) => ({
            productId: it.productId,
            quantity: it.quantity,
            unitPrice: it.unitPrice,
          })),
        });
      }

      return tx.purchaseOrder.findUnique({
        where: { id: created.id },
        include: { supplier: true, company: true, items: { include: { product: true } }, invoices: true },
      });
    }, { maxWait: 10000, timeout: 60000 });

    return NextResponse.json(purchaseOrder, { status: 201 });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && (error as any).code === "P2002") {
      const target = String((error as any).meta?.target || "");
      if (target.includes("clientRequestId")) {
        const body = await request.clone().json().catch(() => null);
        const companyId = typeof body?.companyId === "string" ? body.companyId : "";
        const supplierId = typeof body?.supplierId === "string" ? body.supplierId : "";
        const clientRequestId = typeof body?.clientRequestId === "string" ? body.clientRequestId.trim().slice(0, 120) : "";
        if (companyId && supplierId && clientRequestId) {
          const existing = await prisma.purchaseOrder.findFirst({
            where: { companyId, supplierId, clientRequestId },
            include: { supplier: true, company: true, items: { include: { product: true } }, invoices: true },
          });
          if (existing) return NextResponse.json(existing, { status: 200 });
        }
      }
      if (target.includes("invoiceNumber")) {
        return NextResponse.json({ error: "رقم بيان/فاتورة المورد مسجل بالفعل لهذا المورد", code: "DUPLICATE_PURCHASE_INVOICE" }, { status: 409 });
      }
    }
    return NextResponse.json({ error: "Failed to create purchase order" }, { status: traceError("[purchases:POST] create failed", error) });
  }
}

export const GET = withApiErrors(GET__raw);
export const POST = withApiErrors(POST__raw);

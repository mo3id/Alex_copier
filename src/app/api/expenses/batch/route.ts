import { withApiErrors } from "@/lib/api-errors";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAction, requireAuth } from "@/lib/auth-helpers";
import { traceError } from "@/lib/prisma-errors";

const MAX_BATCH_ITEMS = 50;

interface BatchItem {
  categoryId: string | null;
  category: string;
  description: string;
  amount: number;
}

function parseItem(value: unknown): BatchItem | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const categoryId =
    typeof raw.categoryId === "string" && raw.categoryId.trim()
      ? raw.categoryId.trim()
      : null;
  const category = typeof raw.category === "string" ? raw.category.trim() : "";
  const description = typeof raw.description === "string" ? raw.description.trim() : "";
  const amount = Number(raw.amount);

  if (!categoryId && !category) return null;
  if (!description || !Number.isFinite(amount) || amount <= 0) return null;
  return { categoryId, category, description, amount };
}

function badRequest(error: string, code?: string) {
  return NextResponse.json({ error, ...(code ? { code } : {}) }, { status: 400 });
}

async function POST__raw(request: Request) {
  try {
    const actor = await requireAction("finance", "add");
    if (!actor) {
      const authed = await requireAuth();
      return NextResponse.json(
        { error: authed ? "Forbidden" : "Unauthorized", code: authed ? "FORBIDDEN" : "UNAUTHORIZED" },
        { status: authed ? 403 : 401 }
      );
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return badRequest("Invalid expense data");
    const payload = body as Record<string, unknown>;
    const companyId = typeof payload.companyId === "string" ? payload.companyId.trim() : "";
    const rawItems = payload.items;

    if (
      !companyId ||
      !Array.isArray(rawItems) ||
      rawItems.length === 0 ||
      rawItems.length > MAX_BATCH_ITEMS
    ) {
      return badRequest("Invalid expense data");
    }

    const items: BatchItem[] = [];
    for (const rawItem of rawItems) {
      const item = parseItem(rawItem);
      if (!item) return badRequest("Invalid expense data");
      items.push(item);
    }

    const company = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true } });
    if (!company) return badRequest("الشركة غير موجودة", "COMPANY_NOT_FOUND");

    const categoryIds = [
      ...new Set(items.map((item) => item.categoryId).filter((id): id is string => Boolean(id))),
    ];
    const categories = categoryIds.length
      ? await prisma.expenseCategory.findMany({
          where: { id: { in: categoryIds } },
          select: { id: true, name: true, companyId: true },
        })
      : [];
    const categoryById = new Map(categories.map((category) => [category.id, category]));

    for (const item of items) {
      if (!item.categoryId) continue;
      const category = categoryById.get(item.categoryId);
      if (!category) return badRequest("الفئة غير موجودة", "CATEGORY_NOT_FOUND");
      if (category.companyId !== companyId) {
        return badRequest("الفئة لا تخص الشركة المختارة", "CATEGORY_COMPANY_MISMATCH");
      }
      if (!item.category) item.category = category.name;
    }

    const created = await prisma.expense.createManyAndReturn({
      data: items.map((item) => ({
        companyId,
        categoryId: item.categoryId,
        category: item.category,
        description: item.description,
        amount: item.amount,
        paidBy: actor.id,
      })),
      include: {
        company: true,
        payer: { select: { id: true, name: true } },
        expenseCategory: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json(
      {
        created,
        count: created.length,
        total: created.reduce((sum, expense) => sum + expense.amount, 0),
      },
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to create expenses" },
      { status: traceError("[expenses:batch] create failed", error) }
    );
  }
}

export const POST = withApiErrors(POST__raw);

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    expense: {
      createManyAndReturn: vi.fn(),
    },
    company: {
      findUnique: vi.fn(),
    },
    expenseCategory: {
      findMany: vi.fn(),
    },
  },
  requireAuth: vi.fn(),
  requirePageAccess: vi.fn(),
  requireRole: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/auth-helpers", () => ({
  requireAuth: mocks.requireAuth,
  requireAction: (page: string) => mocks.requirePageAccess(page),
  requireAnyAction: (page: string) => mocks.requirePageAccess(page),
  requireRole: mocks.requireRole,
}));
vi.mock("@/lib/prisma-errors", () => ({
  traceError: (_prefix: string, error: { code?: string }) =>
    error?.code === "P2003" ? 400 : error?.code === "P2025" ? 404 : 500,
}));

import { POST } from "@/app/api/expenses/batch/route";

const gm = { id: "gm_1", role: "GENERAL_MANAGER" };
const salesUser = { id: "sales_1", role: "SALES_EMPLOYEE" };

function batchRequest(body: object) {
  return new Request("http://localhost/api/expenses/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validBody = {
  companyId: "cmp_1",
  items: [
    { categoryId: "cat_1", category: "ايجار", description: "ايجار الشهر", amount: 2500 },
    { categoryId: null, category: "كهرباء", description: "فاتورة كهرباء", amount: 350.5 },
  ],
};

const createdRows = [
  {
    id: "exp_1",
    companyId: "cmp_1",
    category: "ايجار",
    description: "ايجار الشهر",
    amount: 2500,
    paidBy: gm.id,
  },
  {
    id: "exp_2",
    companyId: "cmp_1",
    category: "كهرباء",
    description: "فاتورة كهرباء",
    amount: 350.5,
    paidBy: gm.id,
  },
];

describe("POST /api/expenses/batch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requirePageAccess.mockResolvedValue(gm);
    mocks.prisma.company.findUnique.mockResolvedValue({ id: "cmp_1" });
    mocks.prisma.expenseCategory.findMany.mockResolvedValue([
      { id: "cat_1", name: "ايجار", companyId: "cmp_1" },
    ]);
    mocks.prisma.expense.createManyAndReturn.mockResolvedValue(createdRows);
  });

  it("returns 401 when unauthenticated and 403 without finance access", async () => {
    mocks.requirePageAccess.mockResolvedValue(null);
    mocks.requireAuth.mockResolvedValue(null);
    expect((await POST(batchRequest(validBody))).status).toBe(401);

    mocks.requireAuth.mockResolvedValue(salesUser);
    expect((await POST(batchRequest(validBody))).status).toBe(403);
    expect(mocks.prisma.expense.createManyAndReturn).not.toHaveBeenCalled();
  });

  it("rejects empty, oversized, and incomplete batches before writing", async () => {
    for (const body of [
      { companyId: "cmp_1", items: [] },
      { companyId: "cmp_1", items: Array.from({ length: 51 }, () => ({ ...validBody.items[0] })) },
      { ...validBody, items: [{ ...validBody.items[0], amount: 0 }] },
      { ...validBody, items: [{ ...validBody.items[0], description: "" }] },
      { ...validBody, items: [{ ...validBody.items[0], category: "", categoryId: null }] },
    ]) {
      expect((await POST(batchRequest(body))).status).toBe(400);
    }
    expect(mocks.prisma.expense.createManyAndReturn).not.toHaveBeenCalled();
  });

  it("rejects an unknown company", async () => {
    mocks.prisma.company.findUnique.mockResolvedValue(null);
    const res = await POST(batchRequest(validBody));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("COMPANY_NOT_FOUND");
    expect(mocks.prisma.expense.createManyAndReturn).not.toHaveBeenCalled();
  });

  it("validates categories in one query and creates the whole batch atomically", async () => {
    const res = await POST(batchRequest(validBody));
    expect(res.status).toBe(201);
    expect(mocks.prisma.expenseCategory.findMany.mock.calls[0][0].where.id.in).toEqual(["cat_1"]);

    const createArgs = mocks.prisma.expense.createManyAndReturn.mock.calls[0][0];
    expect(createArgs.data).toHaveLength(2);
    expect(createArgs.data.every((row: { paidBy: string }) => row.paidBy === gm.id)).toBe(true);
    expect(createArgs.data[1].categoryId).toBeNull();

    const body = await res.json();
    expect(body.count).toBe(2);
    expect(body.total).toBe(2850.5);
  });

  it("fills the category name from the lookup when the client only sent an id", async () => {
    const res = await POST(
      batchRequest({
        companyId: "cmp_1",
        items: [{ categoryId: "cat_1", category: "", description: "ايجار", amount: 10 }],
      })
    );
    expect(res.status).toBe(201);
    expect(mocks.prisma.expense.createManyAndReturn.mock.calls[0][0].data[0].category).toBe("ايجار");
  });

  it("rejects an unknown category without creating anything", async () => {
    mocks.prisma.expenseCategory.findMany.mockResolvedValue([]);
    const res = await POST(batchRequest(validBody));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("CATEGORY_NOT_FOUND");
    expect(mocks.prisma.expense.createManyAndReturn).not.toHaveBeenCalled();
  });

  it("rejects a category belonging to another company", async () => {
    mocks.prisma.expenseCategory.findMany.mockResolvedValue([
      { id: "cat_1", name: "ايجار", companyId: "cmp_other" },
    ]);
    const res = await POST(batchRequest(validBody));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("CATEGORY_COMPANY_MISMATCH");
    expect(mocks.prisma.expense.createManyAndReturn).not.toHaveBeenCalled();
  });

  it("maps database FK errors to 400", async () => {
    mocks.prisma.expense.createManyAndReturn.mockRejectedValue({ code: "P2003" });
    expect((await POST(batchRequest(validBody))).status).toBe(400);
  });
});

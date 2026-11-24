import { NextResponse } from "next/server";
import { withApiErrors } from "@/lib/api-errors";
import { prisma } from "@/lib/prisma";
import { requireAuth, requirePageAccess } from "@/lib/auth-helpers";
import { canViewPage } from "@/lib/permissions-server";
import type { Page } from "@/lib/permissions";
import { ownEngineerId } from "@/lib/engineer-scope";
import { getPurchasesFeed } from "@/lib/purchases-feed";

/**
 * One request for everything the purchase invoice form needs.
 *
 * The page used to fire six parallel calls (purchases, suppliers, inventory,
 * companies, customers, engineers). Several of them loaded whole management
 * feeds — customers with every ledger and payment, suppliers with every order —
 * just to read `id` and `name`. That is six round trips plus a large payload on
 * every load and every refresh, and six chances for a network failure to turn
 * into a `Failed to fetch` rejection. Here the same data is read once, with lean
 * selects and the existing page permissions preserved for every pick list.
 */
async function GET__raw() {
  const actor = await requirePageAccess("purchases");
  if (!actor) {
    const authed = await requireAuth();
    return NextResponse.json(
      { error: authed ? "Forbidden" : "Unauthorized", code: authed ? "FORBIDDEN" : "UNAUTHORIZED" },
      { status: authed ? 403 : 401 },
    );
  }

  const mayView = (page: Page) => canViewPage(actor.permissions, page);
  const selfEngineerId = actor.role === "ENGINEER" ? await ownEngineerId(actor.id) : null;

  const [feed, suppliers, companies, customers, engineers, products] = await Promise.all([
    getPurchasesFeed(),
    mayView("suppliers")
      ? prisma.supplier.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } })
      : Promise.resolve([]),
    mayView("companies")
      ? prisma.company.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } })
      : Promise.resolve([]),
    mayView("customers")
      ? prisma.customer.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } })
      : Promise.resolve([]),
    // `/api/engineers/options` only required a session: an accountant may name
    // an engineer on an invoice without being able to open the engineers page.
    prisma.engineer.findMany({
      where: selfEngineerId ? { id: selfEngineerId } : { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.product.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        companyId: true,
        purchasePrice: true,
        wholesalePrice: true,
        retailPrice: true,
        pricingTiers: true,
      },
      orderBy: { name: "asc" },
    }),
  ]);

  return NextResponse.json(
    { ...feed, suppliers, companies, customers, engineers, products },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export const GET = withApiErrors(GET__raw);

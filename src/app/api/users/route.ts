import { withApiErrors } from "@/lib/api-errors";
import { NextResponse } from "next/server";
import { hash } from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireSuperAdmin } from "@/lib/auth-helpers";
import { ROLES } from "@/lib/permissions";
import { isValidPhone, normalizePhone } from "@/lib/phone";

async function GET__raw() {
  try {
    const admin = await requireSuperAdmin();
    if (!admin) {
      const authed = await requireAuth();
      return NextResponse.json(
        { error: authed ? "Forbidden" : "Unauthorized", code: authed ? "FORBIDDEN" : "UNAUTHORIZED" },
        { status: authed ? 403 : 401 }
      );
    }
    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        phone: true,
        role: true,
        companyId: true,
        isActive: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(users);
  } catch {
    return NextResponse.json({ error: "Failed to fetch users" }, { status: 500 });
  }
}

async function POST__raw(request: Request) {
  try {
    const admin = await requireSuperAdmin();
    if (!admin) {
      const authed = await requireAuth();
      return NextResponse.json(
        { error: authed ? "Forbidden" : "Unauthorized", code: authed ? "FORBIDDEN" : "UNAUTHORIZED" },
        { status: authed ? 403 : 401 }
      );
    }

    const body = await request.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const phone = normalizePhone(typeof body.phone === "string" ? body.phone : "");
    const password = typeof body.password === "string" ? body.password : "";
    const role = body.role;
    const companyId =
      typeof body.companyId === "string" && body.companyId !== "" ? body.companyId : null;

    if (!name || !phone || !password) {
      return NextResponse.json(
        { error: "الاسم ورقم التليفون وكلمة المرور والدور مطلوبة", code: "USER_FIELDS_REQUIRED" },
        { status: 400 }
      );
    }
    if (!isValidPhone(phone)) {
      return NextResponse.json({ error: "صيغة رقم التليفون غير صحيحة", code: "INVALID_PHONE" }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json(
        { error: "كلمة المرور يجب أن تكون 6 أحرف على الأقل", code: "PASSWORD_TOO_SHORT" },
        { status: 400 }
      );
    }
    if (!ROLES.includes(role)) {
      return NextResponse.json({ error: "الدور غير صالح", code: "INVALID_ROLE" }, { status: 400 });
    }

    const existing = await prisma.user.findUnique({ where: { phone } });
    if (existing) {
      return NextResponse.json({ error: "رقم التليفون مستخدم بالفعل", code: "DUPLICATE_PHONE" }, { status: 409 });
    }

    if (companyId) {
      const company = await prisma.company.findUnique({ where: { id: companyId } });
      if (!company) {
        return NextResponse.json({ error: "الشركة غير موجودة", code: "COMPANY_NOT_FOUND" }, { status: 400 });
      }
    }

    const passwordHash = await hash(password, 10);
    // Business rule: a user with the ENGINEER role always owns an engineer
    // profile (assignments, visits, custody). Create both atomically.
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { name, phone, passwordHash, role, companyId },
        select: {
          id: true,
          name: true,
          phone: true,
          role: true,
          companyId: true,
          isActive: true,
          createdAt: true,
        },
      });
      if (role === "ENGINEER") {
        await tx.engineer.create({ data: { userId: created.id, name } });
      }
      return created;
    });

    return NextResponse.json(user, { status: 201 });
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "P2002"
    ) {
      return NextResponse.json({ error: "رقم التليفون مستخدم بالفعل", code: "DUPLICATE_PHONE" }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to create user" }, { status: 500 });
  }
}

export const GET = withApiErrors(GET__raw);
export const POST = withApiErrors(POST__raw);

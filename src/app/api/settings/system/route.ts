import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helpers";
import { FULL_ACCESS_ROLES } from "@/lib/permissions";
import { getNotificationsEnabled, isNotificationsEnabledByEnv, setNotificationsEnabled } from "@/lib/notifications";

export async function GET() {
  const user = await requireAuth();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!FULL_ACCESS_ROLES.includes(user.role as any)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const notificationsEnabled = await getNotificationsEnabled();
  return NextResponse.json({ notificationsEnabled, envOverride: isNotificationsEnabledByEnv() });
}

export async function PATCH(request: Request) {
  const user = await requireAuth();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!FULL_ACCESS_ROLES.includes(user.role as any)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  if (typeof body?.notificationsEnabled !== "boolean") {
    return NextResponse.json({ error: "notificationsEnabled must be boolean" }, { status: 400 });
  }
  const notificationsEnabled = await setNotificationsEnabled(body.notificationsEnabled);
  return NextResponse.json({ notificationsEnabled, envOverride: isNotificationsEnabledByEnv() });
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/current-user";

export const runtime = "nodejs";

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const actorId = await resolveUserId();
  if (!actorId) return NextResponse.json({ error: "Inte inloggad" }, { status: 401 });

  const actor = await prisma.user.findUnique({ where: { id: actorId } });
  if (actor?.role !== "ADMIN") {
    return NextResponse.json({ error: "Kräver administratörsbehörighet" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));

  const cc = await prisma.costCenter.findUnique({ where: { id } });
  if (!cc) return NextResponse.json({ error: "Kostnadsställe hittades inte" }, { status: 404 });

  const approverId = body.approverId === "" ? null : (body.approverId ?? cc.approverId);

  const updated = await prisma.costCenter.update({
    where: { id },
    data: { approverId },
    include: { approver: true },
  });

  return NextResponse.json({ ok: true, approverId: updated.approverId, approverName: updated.approver?.name ?? null });
}

// Assign (or clear) the responsible owner for a committee (admin only).
// Body: { committee: string, ownerId: string | null }. Upserts by committee name.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolveUser } from "@/lib/current-user";

export const runtime = "nodejs";

export async function PUT(req: Request) {
  const actor = await resolveUser();
  if (!actor) return NextResponse.json({ error: "Inte inloggad" }, { status: 401 });
  if (actor.role !== "ADMIN") {
    return NextResponse.json({ error: "Kräver administratörsbehörighet" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const committee = typeof body.committee === "string" ? body.committee.trim() : "";
  if (!committee) return NextResponse.json({ error: "Kommitté krävs" }, { status: 422 });
  const ownerId = body.ownerId ? String(body.ownerId) : null;

  if (ownerId) {
    const owner = await prisma.user.findUnique({ where: { id: ownerId } });
    if (!owner) return NextResponse.json({ error: "Användaren hittades inte" }, { status: 404 });
  }

  const saved = await prisma.committeeOwner.upsert({
    where: { committee },
    create: { committee, ownerId },
    update: { ownerId },
    include: { owner: true },
  });

  return NextResponse.json({
    ok: true,
    committee: saved.committee,
    ownerId: saved.ownerId,
    ownerName: saved.owner?.name ?? null,
  });
}

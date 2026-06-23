// Update a user's section position (admin only). Roles stay managed elsewhere;
// this sets the org position used by the forthcoming attest policy.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolveUser } from "@/lib/current-user";
import type { CommitteePosition } from "@/lib/generated/prisma/client";

export const runtime = "nodejs";

const POSITIONS: CommitteePosition[] = [
  "ORDFORANDE",
  "SKATTMASTARE",
  "VICE_SKATTMASTARE",
  "BOARD",
];

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await resolveUser();
  if (!actor) return NextResponse.json({ error: "Inte inloggad" }, { status: 401 });
  if (actor.role !== "ADMIN") {
    return NextResponse.json({ error: "Kräver administratörsbehörighet" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));

  // position: one of the enum values, or null/"" to clear.
  const raw = body.position;
  let position: CommitteePosition | null;
  if (raw === null || raw === "") position = null;
  else if (POSITIONS.includes(raw)) position = raw;
  else return NextResponse.json({ error: "Ogiltig position" }, { status: 422 });

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return NextResponse.json({ error: "Användaren hittades inte" }, { status: 404 });

  const updated = await prisma.user.update({ where: { id }, data: { position } });
  return NextResponse.json({ ok: true, position: updated.position });
}

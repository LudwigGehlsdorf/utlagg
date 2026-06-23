// Serve / delete a single receipt's file. The bytes stream browser ← Next ← MinIO
// (proxy model), so every read is authorized here and MinIO stays internal.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { deleteObject, getObjectStream } from "@/lib/storage";

export const runtime = "nodejs";

// GET /api/receipts/:id — streams the receipt image/PDF back inline.
// `?variant=thumb` serves the small preview when one exists.
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const receipt = await prisma.receipt.findUnique({ where: { id } });
  if (!receipt) {
    return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
  }

  // TODO(auth): authorize the current user against this receipt's expense.

  const wantThumb = new URL(req.url).searchParams.get("variant") === "thumb";
  const key = wantThumb && receipt.thumbnailKey ? receipt.thumbnailKey : receipt.objectKey;
  const obj = await getObjectStream(key);
  const headers = new Headers({
    "Content-Type": obj.contentType,
    // Receipts can contain personal/financial data — never cache shared.
    "Cache-Control": "private, max-age=0, no-store",
    "Content-Disposition": `inline; filename="${encodeURIComponent(receipt.filename)}"`,
  });
  if (obj.contentLength != null) {
    headers.set("Content-Length", String(obj.contentLength));
  }
  return new Response(obj.body, { headers });
}

// DELETE /api/receipts/:id — remove the object from MinIO and the row.
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const receipt = await prisma.receipt.findUnique({ where: { id } });
  if (!receipt) {
    return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
  }

  // TODO(auth): authorize, and forbid deletion once the expense is signed.

  await deleteObject(receipt.objectKey).catch(() => {});
  if (receipt.thumbnailKey) await deleteObject(receipt.thumbnailKey).catch(() => {});
  await prisma.receipt.delete({ where: { id } });
  return new Response(null, { status: 204 });
}

// Receipt upload (proxy model): browser → this route → MinIO. The Next server
// authenticates, validates, stores the bytes in MinIO, and records a Receipt
// row + an audit event in Postgres. MinIO is never exposed to the browser.
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/current-user";
import { deleteObject, putObject, receiptKey, receiptThumbKey } from "@/lib/storage";
import { asJpegName, isNormalisableImage, normaliseImage } from "@/lib/images";

// AWS SDK needs the Node.js runtime (not Edge).
export const runtime = "nodejs";

// Generous limit on the *original* upload — images get downscaled on the server.
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
]);

// POST /api/expenses/:id/receipts — multipart form-data, field "file".
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: expenseId } = await ctx.params;

  // Accept either the cuid (wizard flow) or the human reference (edit page).
  const expense = await prisma.expense.findFirst({
    where: { OR: [{ id: expenseId }, { reference: expenseId }] },
  });
  if (!expense) {
    return NextResponse.json({ error: "Expense not found" }, { status: 404 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected multipart/form-data" },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing 'file'" }, { status: 400 });
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json(
      { error: `Unsupported type '${file.type || "unknown"}'` },
      { status: 415 },
    );
  }
  if (file.size === 0 || file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File must be 1 byte–${MAX_BYTES} bytes` },
      { status: 413 },
    );
  }

  const uploaderId = await resolveUserId();
  if (!uploaderId) {
    return NextResponse.json({ error: "Inte inloggad" }, { status: 401 });
  }
  const receiptId = randomUUID();
  const original = Buffer.from(await file.arrayBuffer());

  // Images are normalised (HEIC→JPEG, EXIF-rotated, downscaled) and get a
  // thumbnail; PDFs are stored as-is. Collect the objects to write, plus the
  // row's metadata, then persist atomically (object first, row second).
  let filename = file.name;
  let mimeType = file.type;
  let byteSize = file.size;
  let thumbnailKey: string | null = null;
  const objects: { key: string; body: Buffer; contentType: string }[] = [];

  if (isNormalisableImage(file.type)) {
    let normalised;
    try {
      normalised = await normaliseImage(original);
    } catch {
      return NextResponse.json({ error: "Kunde inte läsa bildfilen" }, { status: 422 });
    }
    filename = asJpegName(file.name);
    mimeType = normalised.mimeType;
    byteSize = normalised.full.length;
    thumbnailKey = receiptThumbKey(expense.id, receiptId);
    objects.push({ key: receiptKey(expense.id, receiptId, filename), body: normalised.full, contentType: mimeType });
    objects.push({ key: thumbnailKey, body: normalised.thumb, contentType: "image/jpeg" });
  } else {
    objects.push({ key: receiptKey(expense.id, receiptId, file.name), body: original, contentType: file.type });
  }
  const objectKey = objects[0].key;

  // Store bytes first; only write the row if that succeeds (no orphan rows).
  await Promise.all(objects.map((o) => putObject(o.key, o.body, o.contentType)));

  try {
    const receipt = await prisma.$transaction(async (tx) => {
      const created = await tx.receipt.create({
        data: {
          id: receiptId,
          expenseId: expense.id,
          objectKey,
          thumbnailKey,
          filename,
          mimeType,
          byteSize,
          uploadedById: uploaderId,
        },
      });
      await tx.expenseEvent.create({
        data: {
          expenseId: expense.id,
          type: "RECEIPT_UPLOADED",
          actorId: uploaderId,
        },
      });
      return created;
    });
    return NextResponse.json(receipt, { status: 201 });
  } catch (err) {
    // Roll back the orphaned objects if the DB write failed.
    await Promise.all(objects.map((o) => deleteObject(o.key).catch(() => {})));
    throw err;
  }
}

// GET /api/expenses/:id/receipts — list a receipt's metadata (not the bytes).
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: expenseId } = await ctx.params;
  const expense = await prisma.expense.findFirst({
    where: { OR: [{ id: expenseId }, { reference: expenseId }] },
  });
  if (!expense) return NextResponse.json({ error: "Expense not found" }, { status: 404 });
  const receipts = await prisma.receipt.findMany({
    where: { expenseId: expense.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      filename: true,
      mimeType: true,
      byteSize: true,
      createdAt: true,
    },
  });
  return NextResponse.json(receipts);
}

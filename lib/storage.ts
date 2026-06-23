// Object storage for uploaded receipts. Talks to MinIO (S3-compatible) via the
// AWS SDK v3, so the same code works against MinIO now and any S3/R2 later by
// changing env vars. Receipt *bytes* live here; the *metadata* lives in Postgres
// (see the Receipt model). This is the "proxy" model: only the Next server
// reaches MinIO — it is never exposed to the browser.
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const BUCKET = process.env.S3_BUCKET ?? "receipts";

function createClient() {
  const endpoint = process.env.S3_ENDPOINT ?? "http://localhost:9000";
  return new S3Client({
    endpoint,
    region: process.env.S3_REGION ?? "us-east-1",
    // MinIO needs path-style addressing (bucket in the path, not the host).
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY ?? "utlagg",
      secretAccessKey: process.env.S3_SECRET_KEY ?? "utlagg-dev-secret",
    },
  });
}

// Singleton — avoids creating a new client per request under hot-reload.
const globalForS3 = globalThis as unknown as { s3?: S3Client };
export const s3 = globalForS3.s3 ?? createClient();
if (process.env.NODE_ENV !== "production") globalForS3.s3 = s3;

// Create the bucket on first use if it doesn't exist. Memoised so the
// round-trip happens once per process, not on every upload.
let bucketReady: Promise<void> | undefined;
export function ensureBucket(): Promise<void> {
  if (!bucketReady) {
    bucketReady = (async () => {
      try {
        await s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
      } catch {
        await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
      }
    })().catch((err) => {
      // Reset so a transient failure (e.g. MinIO still booting) can retry.
      bucketReady = undefined;
      throw err;
    });
  }
  return bucketReady;
}

// Strip directories and unsafe characters from a user-supplied filename.
function safeName(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? "file";
  return base.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "file";
}

// Stable, collision-free key. The receiptId (a uuid) guarantees uniqueness;
// the expenseId prefix keeps a receipt's objects grouped.
export function receiptKey(
  expenseId: string,
  receiptId: string,
  filename: string,
): string {
  return `receipts/${expenseId}/${receiptId}-${safeName(filename)}`;
}

// Key for a receipt's thumbnail, alongside its full-size object.
export function receiptThumbKey(expenseId: string, receiptId: string): string {
  return `receipts/${expenseId}/${receiptId}-thumb.jpg`;
}

export async function putObject(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  await ensureBucket();
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

export interface ObjectStream {
  body: ReadableStream;
  contentType: string;
  contentLength?: number;
}

export async function getObjectStream(key: string): Promise<ObjectStream> {
  const res = await s3.send(
    new GetObjectCommand({ Bucket: BUCKET, Key: key }),
  );
  if (!res.Body) throw new Error(`Empty object body for key ${key}`);
  return {
    // Web stream so it pipes straight into a Next Response with no buffering.
    body: (res.Body as { transformToWebStream(): ReadableStream }).transformToWebStream(),
    contentType: res.ContentType ?? "application/octet-stream",
    contentLength: res.ContentLength,
  };
}

// Read a whole object into memory. Used when we must hand the bytes to another
// API (e.g. uploading a receipt to Fortnox) rather than stream to the browser.
export async function getObjectBuffer(
  key: string,
): Promise<{ bytes: Buffer; contentType: string }> {
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  if (!res.Body) throw new Error(`Empty object body for key ${key}`);
  const arr = await (res.Body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray();
  return {
    bytes: Buffer.from(arr),
    contentType: res.ContentType ?? "application/octet-stream",
  };
}

export async function deleteObject(key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

// Supabase Storage helpers for the receipts bucket. Server-only.
//
// We store the *storage path* (e.g. "2026/06/12/abc123.pdf") in
// finance.receipt_url, not a long-lived signed URL. The /api/finance/receipt
// endpoint mints a fresh 1-hour signed URL per click, so we can rotate keys or
// move buckets without invalidating historical records.

const BUCKET = "receipts";

function env(): { url: string; key: string } {
  const url = process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SECRET_KEY || "";
  if (!url || !key) throw new Error("Supabase credentials missing.");
  return { url, key };
}

// Upload bytes. Returns the storage path (without bucket prefix). The path is
// what we persist on the finance row.
export async function uploadReceipt(buffer: Buffer, filename: string, mime: string): Promise<string> {
  const { url, key } = env();
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const slug = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "receipt";
  const uid = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const path = `${yyyy}/${mm}/${dd}/${uid}-${slug}`;

  const res = await fetch(`${url}/storage/v1/object/${BUCKET}/${encodeURI(path)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      "content-type": mime || "application/octet-stream",
      "x-upsert": "true",
    },
    body: new Uint8Array(buffer),
  });
  if (!res.ok) {
    throw new Error(`Storage upload failed: ${res.status} ${(await res.text()).slice(0, 240)}`);
  }
  return path;
}

// Mint a short-lived signed URL for a stored receipt path.
export async function signedReceiptUrl(path: string, expiresInSec = 3600): Promise<string> {
  const { url, key } = env();
  const res = await fetch(`${url}/storage/v1/object/sign/${BUCKET}/${encodeURI(path)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      "content-type": "application/json",
    },
    body: JSON.stringify({ expiresIn: expiresInSec }),
  });
  if (!res.ok) {
    throw new Error(`Signed URL failed: ${res.status} ${(await res.text()).slice(0, 240)}`);
  }
  const j = await res.json();
  // signedURL is a relative path like "/object/sign/receipts/...?token=..."
  const rel: string = j.signedURL || j.signedUrl || "";
  if (!rel) throw new Error("Empty signed URL response.");
  return rel.startsWith("http") ? rel : `${url}/storage/v1${rel}`;
}

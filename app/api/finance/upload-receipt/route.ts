import { NextRequest, NextResponse } from "next/server";
import { uploadReceipt } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST { filename, mime, dataBase64 } -> { path }
// Uploads receipt bytes to the private 'receipts' bucket. Returns the storage
// path that gets persisted on the finance row.
export async function POST(req: NextRequest) {
  try {
    const { filename, mime, dataBase64 } = await req.json();
    if (!dataBase64 || typeof dataBase64 !== "string") {
      return NextResponse.json({ error: "file data required" }, { status: 400 });
    }
    const buf = Buffer.from(dataBase64, "base64");
    if (buf.length === 0) {
      return NextResponse.json({ error: "empty file" }, { status: 400 });
    }
    const path = await uploadReceipt(buf, String(filename || "receipt"), String(mime || ""));
    return NextResponse.json({ ok: true, path });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

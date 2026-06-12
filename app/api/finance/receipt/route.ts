import { NextRequest, NextResponse } from "next/server";
import { signedReceiptUrl } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET ?path=<storage-path> -> 302 to a fresh 1-hour signed URL.
// The finance row stores the path; this endpoint mints the URL per click so
// we can rotate keys or move buckets without invalidating historical records.
export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get("path");
  if (!path) return NextResponse.json({ error: "path required" }, { status: 400 });
  try {
    const url = await signedReceiptUrl(path, 3600);
    return NextResponse.redirect(url, 302);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { listAccounts, removeAccount } from "@/lib/mail-accounts";
import { isProviderConfigured } from "@/lib/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({
      accounts: await listAccounts(),
      configured: { microsoft: isProviderConfigured("microsoft"), zoho: isProviderConfigured("zoho") },
    });
  } catch (e: any) {
    return NextResponse.json({ accounts: [], configured: { microsoft: false, zoho: false }, error: e?.message }, { status: 200 });
  }
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try {
    await removeAccount(id);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

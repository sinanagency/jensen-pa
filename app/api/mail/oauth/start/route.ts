import { NextRequest, NextResponse } from "next/server";
import { Provider, buildAuthUrl, isProviderConfigured } from "@/lib/oauth";
import { seal } from "@/lib/secretbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Kick off "Continue with Microsoft / Zoho". CSRF-guards with a nonce held in an
// httpOnly cookie and mirrored (sealed) in the OAuth state.
export async function GET(req: NextRequest) {
  const provider = req.nextUrl.searchParams.get("provider") as Provider;
  if (provider !== "microsoft" && provider !== "zoho") {
    return NextResponse.redirect(new URL("/mail?error=bad_provider", req.url));
  }
  if (!isProviderConfigured(provider)) {
    return NextResponse.redirect(new URL(`/mail?error=${provider}_not_configured`, req.url));
  }
  const nonce = crypto.randomUUID();
  const state = await seal({ provider, nonce });
  const res = NextResponse.redirect(buildAuthUrl(provider, state));
  res.cookies.set("lr_oauth", nonce, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 600 });
  return res;
}

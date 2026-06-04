import { NextRequest, NextResponse } from "next/server";
import { open } from "@/lib/secretbox";
import { exchangeCode, Provider, zohoApiHost } from "@/lib/oauth";
import { upsertAccount } from "@/lib/mail-accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const stateRaw = req.nextUrl.searchParams.get("state");
  const providerErr = req.nextUrl.searchParams.get("error");
  if (providerErr) return NextResponse.redirect(new URL(`/mail?error=${encodeURIComponent(providerErr)}`, req.url));
  if (!code || !stateRaw) return NextResponse.redirect(new URL("/mail?error=missing_code", req.url));

  const state = await open<{ provider: Provider; nonce: string }>(stateRaw);
  const nonce = req.cookies.get("lr_oauth")?.value;
  if (!state || !nonce || state.nonce !== nonce) {
    return NextResponse.redirect(new URL("/mail?error=bad_state", req.url));
  }

  try {
    const tokens = await exchangeCode(state.provider, code);
    const email = await fetchEmail(state.provider, tokens.accessToken);
    await upsertAccount(state.provider, email, tokens);
    const res = NextResponse.redirect(new URL(`/inbox?connected=${state.provider}`, req.url));
    res.cookies.set("lr_oauth", "", { maxAge: 0, path: "/" });
    return res;
  } catch (e: any) {
    return NextResponse.redirect(new URL(`/mail?error=${encodeURIComponent((e?.message || "oauth_failed").slice(0, 90))}`, req.url));
  }
}

async function fetchEmail(provider: Provider, token: string): Promise<string> {
  if (provider === "microsoft") {
    const r = await fetch("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", { headers: { Authorization: `Bearer ${token}` } });
    const j = await r.json().catch(() => ({}));
    return j.mail || j.userPrincipalName || "unknown";
  }
  const r = await fetch(`${zohoApiHost()}/api/accounts`, { headers: { Authorization: `Zoho-oauthtoken ${token}` } });
  const j = await r.json().catch(() => ({}));
  const a = (j.data || [])[0] || {};
  return a.primaryEmailAddress || a.mailboxAddress || "unknown";
}

import { NextRequest, NextResponse } from "next/server";
import { COOKIE, COOKIE_MAX_AGE, mintToken } from "@/lib/auth";
import { isConfigured } from "@/lib/db";
import { createAccount, findAccount, hasOwner, toSafe, verifyPw } from "@/lib/accounts";

export const runtime = "nodejs";

function setSession(res: NextResponse, token: string) {
  res.cookies.set(COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
}

// Tells the login page whether to show the "Create account" option (first-claim:
// open only until the owner registers, so the private portal can't be self-joined).
export async function GET() {
  if (!isConfigured()) return NextResponse.json({ canRegister: false, configured: false });
  try {
    return NextResponse.json({ canRegister: !(await hasOwner()), configured: true });
  } catch {
    return NextResponse.json({ canRegister: false, configured: true });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as any));
  const { action } = body;

  if (action === "logout") {
    const res = NextResponse.json({ ok: true });
    res.cookies.set(COOKIE, "", { maxAge: 0, path: "/" });
    return res;
  }

  if (!isConfigured()) {
    return NextResponse.json({ ok: false, error: "Access is not configured yet." }, { status: 500 });
  }

  try {
    if (action === "register") {
      const name = String(body.name || "").trim();
      const email = String(body.email || "").trim();
      const password = String(body.password || "");
      if (name.length < 2) return NextResponse.json({ ok: false, error: "Please enter your name." }, { status: 400 });
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
        return NextResponse.json({ ok: false, error: "Please enter a valid email." }, { status: 400 });
      if (password.length < 8)
        return NextResponse.json({ ok: false, error: "Password must be at least 8 characters." }, { status: 400 });
      if (await hasOwner())
        return NextResponse.json({ ok: false, error: "Registration is closed. Ask your admin for access." }, { status: 403 });

      const acct = await createAccount({ name, email, password, role: "owner" });
      const res = NextResponse.json({ ok: true, account: toSafe(acct) });
      setSession(res, await mintToken(acct.id));
      return res;
    }

    // default: login
    const identifier = String(body.identifier || body.email || "").trim();
    const password = String(body.password || "");
    if (!identifier || !password)
      return NextResponse.json({ ok: false, error: "Enter your email and password." }, { status: 400 });

    const acct = await findAccount(identifier);
    if (!acct || !verifyPw(password, acct.salt, acct.hash))
      return NextResponse.json({ ok: false, error: "Those details are not right." }, { status: 401 });

    const res = NextResponse.json({ ok: true, account: toSafe(acct) });
    setSession(res, await mintToken(acct.id));
    return res;
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Something went wrong." }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { COOKIE, COOKIE_MAX_AGE, checkPassword, mintToken } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { action, password } = await req.json().catch(() => ({}));

  if (action === "logout") {
    const res = NextResponse.json({ ok: true });
    res.cookies.set(COOKIE, "", { maxAge: 0, path: "/" });
    return res;
  }

  if (!process.env.APP_PASSWORD) {
    return NextResponse.json({ ok: false, error: "Access is not configured yet." }, { status: 500 });
  }
  if (!checkPassword(password || "")) {
    return NextResponse.json({ ok: false, error: "That passphrase is not right." }, { status: 401 });
  }
  const token = await mintToken();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
  return res;
}

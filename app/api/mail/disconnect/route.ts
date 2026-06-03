import { NextResponse } from "next/server";
import { MAIL_COOKIE } from "@/lib/mailbox";

export const runtime = "nodejs";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(MAIL_COOKIE, "", { maxAge: 0, path: "/" });
  return res;
}

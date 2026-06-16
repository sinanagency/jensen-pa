import { NextRequest, NextResponse } from "next/server";
import { senderFromToken } from "@/lib/accounts";
import { COOKIE } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const me = await senderFromToken(req.cookies.get(COOKIE)?.value).catch(() => undefined);
  return NextResponse.json({ me: me || null });
}

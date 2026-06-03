import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 45;

// Image (base64) -> structured data. mode "card" -> a contact, mode "receipt"
// -> an expense. Uses Claude vision, returns JSON.
const PROMPTS: Record<string, string> = {
  card: 'This is a business card. Extract JSON: {"name":"","company":"","role":"","email":"","phone":""}. Use empty strings for anything not present. Return only JSON.',
  receipt: 'This is a receipt or invoice. Extract JSON: {"label":"vendor or description","amount":0,"vatApplies":true,"date":"YYYY-MM-DD"}. amount is the NET amount as a number (before VAT if shown separately, else the total). Return only JSON.',
};

export async function POST(req: NextRequest) {
  try {
    const { imageBase64, mime, mode } = await req.json();
    const instruction = PROMPTS[mode];
    if (!imageBase64 || !instruction) return NextResponse.json({ error: "imageBase64 and a valid mode are required" }, { status: 400 });
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500 });

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6", max_tokens: 600,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mime || "image/jpeg", data: imageBase64 } },
            { type: "text", text: instruction },
          ],
        }],
      }),
    });
    if (!res.ok) return NextResponse.json({ error: `Vision failed: ${(await res.text()).slice(0, 200)}` }, { status: 502 });
    const data = await res.json();
    const text = (data?.content?.[0]?.text || "").replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    let parsed: any = null;
    try { parsed = JSON.parse(text); } catch { const m = text.match(/\{[\s\S]*\}/); if (m) parsed = JSON.parse(m[0]); }
    if (!parsed) return NextResponse.json({ error: "Could not read structured data from the image." }, { status: 422 });
    return NextResponse.json({ data: parsed });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

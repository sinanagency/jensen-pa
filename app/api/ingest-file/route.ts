import { NextRequest, NextResponse } from "next/server";
import { extractTextFromBuffer } from "@/lib/extract-text";
import { readImage } from "@/lib/anthropic";
import { embed, chunk } from "@/lib/openai";

export const runtime = "nodejs";
export const maxDuration = 60;

// Accepts a single file as base64. Extracts text (parsers for PDF/Word/Excel/CSV/
// text, Claude vision OCR for images), then chunks and embeds it for the brain.
// Returns { title, text, chunks, kind }.
export async function POST(req: NextRequest) {
  try {
    const { filename, mime, dataBase64 } = await req.json();
    if (!dataBase64 || typeof dataBase64 !== "string") {
      return NextResponse.json({ error: "file data required" }, { status: 400 });
    }
    const buf = Buffer.from(dataBase64, "base64");
    const name = String(filename || "document");
    const type = String(mime || "");

    let text = "";
    let kind = "document";
    if (type.startsWith("image/")) {
      text = await readImage(dataBase64, type);
      kind = "image";
    } else {
      text = (await extractTextFromBuffer(buf, type, name)) || "";
      if (/invoice|receipt|statement/i.test(name)) kind = "invoice";
    }

    if (!text.trim()) {
      return NextResponse.json({
        error: "I could not read any text from that file. If it is a scan, try a clearer image.",
      }, { status: 422 });
    }

    const title = name.replace(/\.[a-z0-9]+$/i, "") || "Untitled";
    const parts = chunk(text);
    const vectors = parts.length ? await embed(parts) : [];
    const chunks = parts.map((t, i) => ({ text: t, embedding: vectors[i] }));

    return NextResponse.json({ title, text, chunks, kind });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

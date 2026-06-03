// Pull readable text out of an uploaded file's raw bytes. PDF via unpdf, Word via
// mammoth, spreadsheets via SheetJS, plain text directly. Adapted from the Nisria
// platform's extractTextFromBuffer. Returns clean text or null (images/scans have
// no text layer and are handled by vision OCR upstream). Never throws.

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MAX = 200_000;

export async function extractTextFromBuffer(buf: Buffer | Uint8Array, mime: string, name = ""): Promise<string | null> {
  try {
    const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    const lower = name.toLowerCase();
    if (mime === "application/pdf" || lower.endsWith(".pdf")) {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(b));
      const { text } = await extractText(pdf, { mergePages: true });
      return clean(Array.isArray(text) ? text.join("\n") : text);
    }
    if (mime === DOCX || mime === "application/msword" || lower.endsWith(".docx")) {
      const mammoth: any = (await import("mammoth")).default || (await import("mammoth"));
      const { value } = await mammoth.extractRawText({ buffer: b });
      return clean(value);
    }
    if (mime === XLSX_MIME || mime === "application/vnd.ms-excel" || mime === "text/csv" || lower.endsWith(".xlsx") || lower.endsWith(".csv")) {
      const XLSX: any = await import("xlsx");
      const wb = XLSX.read(b, { type: "buffer" });
      const txt = wb.SheetNames.map((n: string) => `# ${n}\n` + XLSX.utils.sheet_to_csv(wb.Sheets[n])).join("\n\n");
      return clean(txt);
    }
    if (mime.startsWith("text/") || mime === "application/json") {
      return clean(b.toString("utf8"));
    }
    return null;
  } catch {
    return null;
  }
}

function clean(s: string): string {
  const t = (s || "").replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return t.length > MAX ? t.slice(0, MAX) + "\n\n[…truncated]" : t;
}

// Branded PDF rendering, headless Chrome on Vercel. Adapted from the Nisria
// platform's proven approach. Returns null on any failure so the caller can
// fall back to serving the HTML (the universal floor that always works).

let warned = false;

export function pdfSupported(): boolean {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

export async function htmlToPdf(html: string): Promise<Buffer | null> {
  if (!pdfSupported()) return null;
  let browser: any = null;
  try {
    const chromiumMod: any = await import("@sparticuz/chromium");
    const chromium = chromiumMod.default || chromiumMod;
    const puppeteerMod: any = await import("puppeteer-core");
    const puppeteer = puppeteerMod.default || puppeteerMod;

    const executablePath = await chromium.executablePath();
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath,
      headless: true,
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 25_000 });
    const pdf = await page.pdf({
      format: "a4",
      printBackground: true,
      margin: { top: "18mm", bottom: "18mm", left: "16mm", right: "16mm" },
    });
    return Buffer.from(pdf);
  } catch (e: any) {
    if (!warned) {
      warned = true;
      console.error("htmlToPdf failed, falling back to HTML:", e?.message || e);
    }
    return null;
  } finally {
    try { if (browser) await browser.close(); } catch {}
  }
}

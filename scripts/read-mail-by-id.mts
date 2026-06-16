import { readUnified } from "../lib/mail-provider";

async function main() {
  const id = process.argv[2] || "f9f13812-8d6d-4da6-9c94-4df02ead9760::INBOX.spam|69";
  const m = await readUnified(id);
  console.log(JSON.stringify({
    from: m.from, fromEmail: m.fromEmail, to: m.to, subject: m.subject,
    date: m.date, messageId: m.messageId, attachments: m.attachments,
    text: m.text,
  }, null, 2));
}
main().catch((e) => { console.error(e?.message || e); process.exit(1); });

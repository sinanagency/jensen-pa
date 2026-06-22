# Sanad → Jensen WhatsApp Delivery API

> How the Sanad legal platform delivers a finished contract to Jensen's WhatsApp (via Dorje).
> One direction only: **Sanad pushes → Dorje files it + sends the PDF to Jensen.**

---

## What it does

When Jensen finishes a contract in the Sanad portal and asks for it on WhatsApp, Sanad calls **one** Dorje endpoint. Dorje then:
1. **Files** the contract into Jensen's document library (folder `contracts`), so he can ask Dorje to "find my contract" later.
2. **Sends the PDF** to Jensen's WhatsApp.

---

## The requirement: only when Jensen is logged in

The "send to my WhatsApp" action **must only fire for an authenticated Jensen session** on the Sanad side. Sanad owns that gate. Dorje enforces a second, independent lock:

**Dorje will only ever deliver to Jensen's own number.** The recipient is resolved from Dorje's owner config, not from the request. If a call asks to send to any other number, Dorje **refuses** (`recipient_not_jensen`). So even if the Sanad gate is bypassed or misconfigured, a contract can never be pushed to a stranger's WhatsApp. (Single-tenant: Law 9. PII: Law 3.)

---

## Endpoint

```
POST https://jensen.larencontre.ae/api/ingest/sanad
```

### Auth
```
Authorization: Bearer <SANAD_INGEST_KEY>
```
Shared secret, already set on both Sanad and Dorje. No key, no call (401).

### Request body (JSON)

| Field | Type | Required | Notes |
|---|---|---|---|
| `title` | string | **yes** | Contract title. Becomes the doc title + filename. |
| `pdf_url` | string | for WhatsApp delivery | Public/temporary URL Dorje fetches the PDF from. Required if you want it sent to WhatsApp. |
| `text_en` | string | no | Plain-text version of the contract (makes it searchable in Dorje). |
| `kind` | string | no | e.g. `contract`, `nda`, `agreement`. Defaults to `document`. |
| `send_to_wa` | string | no | Set this to trigger WhatsApp delivery. Pass **Jensen's number** (or any truthy value). Delivery always goes to Jensen's configured number; a *different* number is refused. Omit it to file-only (no WhatsApp). |
| `provenance_hash` | string | no | Optional integrity hash, stored with the doc. |

### Example

```bash
curl -X POST https://jensen.larencontre.ae/api/ingest/sanad \
  -H "Authorization: Bearer $SANAD_INGEST_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Consultancy Agreement - La Rencontre x TABCo",
    "kind": "agreement",
    "pdf_url": "https://sanad.zanii.agency/files/abc123.pdf",
    "text_en": "This Consultancy Agreement is made between...",
    "send_to_wa": "971528902032"
  }'
```

### Response

```json
{
  "ok": true,
  "docId": "uuid",
  "kind": "agreement",
  "folder": "contracts",
  "waMsgId": "wamid.XXXX",   // set when the PDF was delivered to Jensen
  "waError": null            // or a reason string if delivery was skipped/refused
}
```

`ok: true` means the doc was **filed**. WhatsApp delivery is reported separately:

| `waError` | Meaning |
|---|---|
| `null` (with a `waMsgId`) | Delivered to Jensen's WhatsApp ✅ |
| `recipient_not_jensen` | The request asked to send to a non-Jensen number — **refused** |
| `owner_not_configured` | Jensen's number isn't set on Dorje — refused (fail-closed) |
| `no_pdf_url` | `send_to_wa` was set but no `pdf_url` to send |
| `fetch_pdf_failed_<status>` | Dorje could not download the PDF from `pdf_url` |
| `fetch_pdf_error` | Network error fetching the PDF |

> Note: filing the doc and delivering the PDF are independent. A delivery failure still files the contract (it'll be findable in Dorje); it does not fail the whole call.

---

## Sanad-side checklist (to build the button)

1. Gate the "Send to my WhatsApp" action behind Jensen's **authenticated session**.
2. Have a `pdf_url` Dorje can fetch (public or short-lived signed URL).
3. `POST` to the endpoint above with the `Bearer` key, the contract, and `send_to_wa` = Jensen's number.
4. Read `waError` in the response: `null` = delivered; anything else = show Jensen a "couldn't send to WhatsApp, but it's saved" message.

That's the whole integration. Dorje's side is built, tested (seam.73), and live.

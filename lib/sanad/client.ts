/**
 * Sanad v1 API client (server-side only).
 *
 * Reaches Sanad's /api/v1/* surface for contract drafting + review.
 * Sanad owns the brain, persona, generation, PDF rendering. Jensen owns the
 * delivery (sendTextAndLog), persona ("I'll have that ready in two minutes"),
 * and presentation.
 *
 * Requires SANAD_V1_BASE_URL + SANAD_V1_API_KEY in env. Falls back to disabled
 * mode (every call returns {ok:false,reason:'sanad_disabled'}) when missing so
 * the build never breaks if Sanad is not yet provisioned.
 */

export type SanadKind =
  | "nda"
  | "founder_agreement"
  | "shareholders_agreement"
  | "safe_uae"
  | "term_sheet"
  | "convertible_note"
  | "share_subscription"
  | "esop_plan"
  | "services_agreement"
  | "msa"
  | "sow"
  | "contractor_agreement"
  | "consultancy_agreement"
  | "engagement_letter"
  | "distribution_agreement"
  | "ip_license"
  | "ip_assignment"
  | "mou_loi"
  | "settlement_agreement"
  | "privacy_policy"
  | "dpa"
  | "terms_of_service"
  | "mohre_annex"
  | "difc_employment"
  | "adgm_employment"
  | "ejari_tenancy"
  | "commercial_lease"
  | "termination_letter"
  | "power_of_attorney";

export type SanadJurisdiction = "mainland" | "difc" | "adgm" | "free-zone";

export interface SanadParty {
  name: string;
  kind?: "company" | "individual";
  details?: string;
}

export interface SanadDraftInput {
  kind: SanadKind;
  jurisdiction: SanadJurisdiction;
  party_a: SanadParty;
  party_b: SanadParty;
  /** Multi-party support. When provided, takes precedence over party_a/party_b. */
  parties?: SanadParty[];
  effective_date?: string;
  additional_context?: string;
}

export interface SanadDraftResponse {
  job_id: string;
  status: "queued";
  eta_seconds: number;
  message: string;
  poll_url: string;
}

export type SanadJobStatus = "queued" | "processing" | "ready" | "failed";

export interface SanadJobPollResponse {
  id: string;
  status: SanadJobStatus;
  created_at: string;
  updated_at: string;
  progress: string | null;
  result: {
    kind: string;
    jurisdiction: SanadJurisdiction;
    body_markdown: string;
    citations: Array<{ law_title?: string; article_number?: string; citation?: string }>;
    provenance_hash: string;
    pdf_url: string;
  } | null;
  error: string | null;
}

export interface SanadReviewInput {
  text: string;
  kind?: SanadKind;
  jurisdiction?: SanadJurisdiction;
}

export interface SanadReviewResponse {
  verdict: "GREEN" | "YELLOW" | "RED";
  summary: string;
  top_3: string[];
  red_flags: Array<{ clause: string; issue: string; severity: "high" | "med" | "low" }>;
  suggested_redlines: Array<{ original: string; replacement: string; rationale: string }>;
  citations: Array<{ law_title?: string; article_number?: string; citation?: string }>;
}

export type SanadResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; reason: string };

function cfg(): { baseUrl: string; apiKey: string } | null {
  const baseUrl = (process.env.SANAD_V1_BASE_URL || "").trim();
  const apiKey = (process.env.SANAD_V1_API_KEY || "").trim();
  if (!baseUrl || !apiKey) return null;
  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey };
}

export function getSanadConfig(): { baseUrl: string; apiKey: string } | null {
  return cfg();
}

export function isSanadConfigured(): boolean {
  return cfg() !== null;
}

async function call<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown
): Promise<SanadResult<T>> {
  const c = cfg();
  if (!c) return { ok: false, status: 503, reason: "sanad_disabled" };
  const r = await fetch(`${c.baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${c.apiKey}`,
      ...(body ? { "content-type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  }).catch((e) => {
    return null as unknown as Response | null;
  });
  if (!r) return { ok: false, status: 0, reason: "network_error" };
  const ct = r.headers.get("content-type") || "";
  if (!r.ok) {
    let msg = `sanad_${r.status}`;
    if (ct.includes("application/json")) {
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (j?.error) msg = j.error;
    }
    return { ok: false, status: r.status, reason: msg };
  }
  if (ct.includes("application/json")) {
    const data = (await r.json()) as T;
    return { ok: true, data };
  }
  // Binary endpoint (PDF) is handled by fetchDraftPdfBuffer instead.
  return { ok: false, status: r.status, reason: "non_json_response" };
}

export function sanadDraftContract(input: SanadDraftInput): Promise<SanadResult<SanadDraftResponse>> {
  return call<SanadDraftResponse>("POST", "/api/v1/contract/draft", input);
}

export function sanadPollJob(jobId: string): Promise<SanadResult<SanadJobPollResponse>> {
  return call<SanadJobPollResponse>("GET", `/api/v1/jobs/${encodeURIComponent(jobId)}`);
}

export async function sanadFetchPdfBuffer(jobId: string): Promise<SanadResult<Buffer>> {
  const c = cfg();
  if (!c) return { ok: false, status: 503, reason: "sanad_disabled" };
  const r = await fetch(`${c.baseUrl}/api/v1/jobs/${encodeURIComponent(jobId)}/pdf`, {
    headers: { authorization: `Bearer ${c.apiKey}` }
  }).catch(() => null);
  if (!r) return { ok: false, status: 0, reason: "network_error" };
  if (!r.ok) return { ok: false, status: r.status, reason: `sanad_pdf_${r.status}` };
  const ab = await r.arrayBuffer();
  return { ok: true, data: Buffer.from(ab) };
}

export function sanadReviewContract(input: SanadReviewInput): Promise<SanadResult<SanadReviewResponse>> {
  return call<SanadReviewResponse>("POST", "/api/v1/contract/review", input);
}

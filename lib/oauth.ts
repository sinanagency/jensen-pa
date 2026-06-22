// OAuth provider config for connecting Jensen's mailboxes (Microsoft 365 / Outlook
// and Zoho Mail) by consent — no passwords, no IMAP. One redirect URI for both;
// the provider is carried in the signed `state`. Client id/secret come from env
// (set once after the Azure + Zoho apps are registered). Server-only.

export type Provider = "microsoft" | "zoho";

export function redirectUri(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || "https://jensen.larencontre.ae";
  return `${base.replace(/\/$/, "")}/api/mail/oauth/callback`;
}

// Zoho is multi-datacenter; default to .com but allow override (eu/in/com.au).
function zohoAccountsHost(): string {
  return process.env.ZOHO_ACCOUNTS_HOST || "https://accounts.zoho.com";
}
export function zohoApiHost(): string {
  return process.env.ZOHO_API_HOST || "https://mail.zoho.com";
}

export type ProviderConfig = {
  id: Provider;
  label: string;
  clientId?: string;
  clientSecret?: string;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string;
  extraAuthParams: Record<string, string>;
};

export function providerConfig(p: Provider): ProviderConfig {
  if (p === "microsoft") {
    return {
      id: "microsoft",
      label: "Outlook / Microsoft 365",
      clientId: process.env.MS_CLIENT_ID,
      clientSecret: process.env.MS_CLIENT_SECRET,
      authorizeUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
      tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      // offline_access => refresh token; Graph mail read/send; User.Read for the
      // address; Calendars.ReadWrite so the bot can CREATE Outlook events + send
      // real meeting invites (attendees) from Jensen's mailbox, not just read.
      // prompt:"consent" forces Microsoft's permission screen so the NEW calendar
      // scope is actually granted on re-connect (select_account would skip it and
      // silently keep the old read-only token).
      scopes: "offline_access openid email profile User.Read Mail.Read Mail.Send Calendars.ReadWrite",
      extraAuthParams: { prompt: "consent", response_mode: "query" },
    };
  }
  return {
    id: "zoho",
    label: "Zoho Mail",
    clientId: process.env.ZOHO_CLIENT_ID,
    clientSecret: process.env.ZOHO_CLIENT_SECRET,
    authorizeUrl: `${zohoAccountsHost()}/oauth/v2/auth`,
    tokenUrl: `${zohoAccountsHost()}/oauth/v2/token`,
    scopes: "ZohoMail.accounts.READ,ZohoMail.messages.READ,ZohoMail.messages.CREATE,ZohoCalendar.event.READ",
    // access_type=offline + prompt=consent => Zoho returns a refresh token.
    extraAuthParams: { access_type: "offline", prompt: "consent" },
  };
}

export function isProviderConfigured(p: Provider): boolean {
  const c = providerConfig(p);
  return Boolean(c.clientId && c.clientSecret);
}

export function buildAuthUrl(p: Provider, state: string): string {
  const c = providerConfig(p);
  const params = new URLSearchParams({
    client_id: c.clientId || "",
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: c.scopes,
    state,
    ...c.extraAuthParams,
  });
  return `${c.authorizeUrl}?${params.toString()}`;
}

export type TokenSet = { accessToken: string; refreshToken?: string; expiresAt: number };

export async function exchangeCode(p: Provider, code: string): Promise<TokenSet> {
  const c = providerConfig(p);
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(),
    client_id: c.clientId || "",
    client_secret: c.clientSecret || "",
  });
  const res = await fetch(c.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`${p} token exchange ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token,
    expiresAt: Date.now() + (Number(j.expires_in || 3600) - 60) * 1000,
  };
}

export async function refreshToken(p: Provider, refresh: string): Promise<TokenSet> {
  const c = providerConfig(p);
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refresh,
    client_id: c.clientId || "",
    client_secret: c.clientSecret || "",
  });
  // Zoho wants the refresh on the token endpoint with the same params.
  const res = await fetch(c.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`${p} token refresh ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token || refresh, // Zoho keeps the same refresh token
    expiresAt: Date.now() + (Number(j.expires_in || 3600) - 60) * 1000,
  };
}

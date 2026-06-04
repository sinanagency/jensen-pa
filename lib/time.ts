// The concierge ALWAYS reasons in Dubai time. Vercel runs UTC, so without this
// the bot would think it is 4 hours behind and mislabel morning/night and "today".
export const TZ = "Asia/Dubai";

export function dubaiNow(): string {
  return new Date().toLocaleString("en-AE", { timeZone: TZ, dateStyle: "full", timeStyle: "short" });
}

export function dubaiStamp(ts: number): string {
  return new Date(ts).toLocaleString("en-AE", { timeZone: TZ, dateStyle: "medium", timeStyle: "short" });
}

export function dubaiToday(): string {
  // YYYY-MM-DD in Dubai
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return p;
}

export function dubaiHour(): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false }).format(new Date()));
}

export function dayPart(): "morning" | "afternoon" | "evening" | "night" {
  const h = dubaiHour();
  if (h < 5) return "night";
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  if (h < 22) return "evening";
  return "night";
}

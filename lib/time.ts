// The concierge ALWAYS reasons in Dubai time. Vercel runs UTC, so without this
// the bot would think it is 4 hours behind and mislabel morning/night and "today".
// 24-hour format only: en-AE returns "11:53 AM" and the LLM subtracts that as
// 11:53 instead of crossing the AM/PM boundary (cost: a "38 min" reply when the
// answer was 97 min, 2026-06-11). en-GB returns "11:53" and the tz is stated.
import { ClockInjector } from "./_vendor/agent-clock/index.js";

export const TZ = "Asia/Dubai";

// Productised ClockInjector from zanii-truststack. Renders the canonical
// "Current trusted datetime:" block (weekday, date, 24h time, IANA zone,
// UTC offset). Same shape now used by Sasa and CTH. Closes the 06-09 Sasa
// Tuesday/Wednesday drift class before it fires on Jensen.
const _dubaiClock = new ClockInjector({ timezone: TZ });

export function dubaiClockBlock(): string {
  return _dubaiClock.block();
}

export function dubaiNow(): string {
  const s = new Date().toLocaleString("en-GB", { timeZone: TZ, dateStyle: "full", timeStyle: "short" });
  return `${s} (Asia/Dubai, 24-hour)`;
}

export function dubaiStamp(ts: number): string {
  return new Date(ts).toLocaleString("en-GB", { timeZone: TZ, dateStyle: "medium", timeStyle: "short" });
}

export function dubaiToday(): string {
  // YYYY-MM-DD in Dubai
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return p;
}

export function dubaiHour(): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false }).format(new Date()));
}

// "HH:MM" in Dubai, 24-hour. Used by queryCalendar to tag each row past/now/upcoming
// so the LLM never has to do clock math against raw event times.
export function dubaiHHMM(): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
}

export function dayPart(): "morning" | "afternoon" | "evening" | "night" {
  const h = dubaiHour();
  if (h < 5) return "night";
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  if (h < 22) return "evening";
  return "night";
}

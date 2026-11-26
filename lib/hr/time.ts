// All date logic happens in the office timezone (APP_TIMEZONE, default Asia/Kolkata)
export const TZ = process.env.NEXT_PUBLIC_APP_TIMEZONE || process.env.APP_TIMEZONE || "Asia/Kolkata";

function parts(d: Date, tz = TZ) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => f.find((p) => p.type === t)?.value ?? "0";
  return { y: get("year"), m: get("month"), d: get("day"), h: +get("hour"), min: +get("minute") };
}

/** YYYY-MM-DD in office tz */
export const dateKey = (d = new Date()) => {
  const p = parts(d);
  return `${p.y}-${p.m}-${p.d}`;
};
/** minutes since midnight in office tz */
export const minutesOfDay = (d = new Date()) => {
  const p = parts(d);
  return p.h * 60 + p.min;
};
export const hm = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + (m || 0);
};

/** Convert office-local "YYYY-MM-DD" + "HH:mm" into a real Date */
export function zonedToDate(date: string, time: string) {
  const guess = new Date(`${date}T${time}:00Z`);
  const p = parts(guess);
  const asUtc = Date.UTC(+p.y, +p.m - 1, +p.d, p.h, p.min);
  return new Date(guess.getTime() - (asUtc - guess.getTime()));
}

export const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
export const daysInMonth = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};
export const monthDates = (month: string) =>
  Array.from({ length: daysInMonth(month) }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);

export function datesBetween(from: string, to: string) {
  const out: string[] = [];
  let d = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  while (d <= end && out.length < 400) {
    out.push(d.toISOString().slice(0, 10));
    d = new Date(d.getTime() + 864e5);
  }
  return out;
}

export function fmtMinutes(min: number) {
  const m = Math.max(0, Math.round(min));
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

/** "HH:mm" (24h) in office tz, for <input type="time"> */
export function hhmm(d: Date | string | null | undefined) {
  if (!d) return "";
  const p = parts(new Date(d));
  return `${String(p.h).padStart(2, "0")}:${String(p.min).padStart(2, "0")}`;
}

export function fmtTime(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleTimeString("en-IN", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: true });
}

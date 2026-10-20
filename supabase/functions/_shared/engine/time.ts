// Time-zone helpers built on Intl only, so the same code runs in the browser and in Deno.

export type LocalParts = { date: string; time: string; y: number; m: number; d: number; hh: number; mm: number; weekday: number };

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
    });
    fmtCache.set(tz, f);
  }
  return f;
}
const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const pad = (n: number) => String(n).padStart(2, '0');

export function localParts(at: Date | string | number, tz: string): LocalParts {
  const d = at instanceof Date ? at : new Date(at);
  const parts: Record<string, string> = {};
  for (const p of fmt(tz).formatToParts(d)) parts[p.type] = p.value;
  const y = +parts.year, m = +parts.month, dd = +parts.day, hh = +parts.hour % 24, mm = +parts.minute;
  return { y, m, d: dd, hh, mm, weekday: WD[parts.weekday], date: `${y}-${pad(m)}-${pad(dd)}`, time: `${pad(hh)}:${pad(mm)}` };
}

/** minutes the zone is ahead of UTC at this instant */
export function tzOffsetMin(tz: string, at: Date): number {
  const p = localParts(at, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm);
  return Math.round((asUtc - Math.floor(at.getTime() / 60000) * 60000) / 60000);
}

/** "2026-10-21" + "11:00" in tz → Date (UTC instant) */
export function zonedToUtc(date: string, time: string, tz: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let off = tzOffsetMin(tz, new Date(guess));
  let t = guess - off * 60000;
  const off2 = tzOffsetMin(tz, new Date(t));
  if (off2 !== off) t = guess - off2 * 60000;
  return new Date(t);
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
export function daysBetween(a: string, b: string): number {
  const pa = a.split('-').map(Number), pb = b.split('-').map(Number);
  return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
}
export const addMin = (d: Date, min: number) => new Date(d.getTime() + min * 60000);
export const diffMin = (a: Date, b: Date) => Math.round((a.getTime() - b.getTime()) / 60000);

export function fmtTime(at: Date | string, tz: string): string {
  const { hh, mm } = localParts(at, tz);
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${pad(mm)} ${hh < 12 ? 'AM' : 'PM'}`;
}
export function fmtDuration(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
export function timeToMin(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}
export function minToTime(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

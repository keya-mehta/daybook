import { addDays, fmtTime, localParts, zonedToUtc } from '@engine/time.ts';
export { fmtTime, fmtDuration } from '@engine/time.ts';

export function dayLabel(date: string, today: string): string {
  if (date === today) return 'Today';
  if (date === addDays(today, 1)) return 'Tomorrow';
  if (date === addDays(today, -1)) return 'Yesterday';
  return longDate(date, true);
}
export function longDate(date: string, short = false): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', { timeZone: 'UTC', weekday: short ? 'short' : 'long', day: 'numeric', month: short ? 'short' : 'long' });
}
export function shortDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', { timeZone: 'UTC', weekday: 'short', day: 'numeric' });
}
export function greeting(now: Date, tz: string): string {
  const h = localParts(now, tz).hh;
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}
export function timeLabel(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
export function whenText(iso: string, tz: string, today: string): string {
  const p = localParts(iso, tz);
  return `${dayLabel(p.date, today)}, ${fmtTime(iso, tz)}`;
}
export const toUtc = zonedToUtc;
export const local = localParts;
export const dateAdd = addDays;

// A small, predictable subset of RFC 5545 RRULE:
//   FREQ=DAILY|WEEKLY|MONTHLY|YEARLY; INTERVAL=n; BYDAY=MO,TU (weekly); BYMONTHDAY=n (monthly);
//   COUNT=n; UNTIL=YYYYMMDD
// Occurrences are generated on local calendar dates in the household time zone and keep the
// series' local start time, so "every Monday 8 AM" stays 8 AM.

import { addDays, daysBetween, weekdayOf } from './time.ts';

export type Freq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
export interface Rule { freq: Freq; interval: number; byday?: number[]; bymonthday?: number; count?: number; until?: string }

const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

export function parseRule(s: string | null | undefined): Rule | null {
  if (!s) return null;
  const kv: Record<string, string> = {};
  for (const part of s.replace(/^RRULE:/i, '').split(';')) {
    const [k, v] = part.split('=');
    if (k && v) kv[k.trim().toUpperCase()] = v.trim().toUpperCase();
  }
  const freq = kv.FREQ as Freq;
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) return null;
  const rule: Rule = { freq, interval: Math.max(1, parseInt(kv.INTERVAL || '1', 10) || 1) };
  if (kv.BYDAY) rule.byday = kv.BYDAY.split(',').map((d) => DAYS.indexOf(d.slice(-2))).filter((d) => d >= 0);
  if (kv.BYMONTHDAY) rule.bymonthday = parseInt(kv.BYMONTHDAY, 10);
  if (kv.COUNT) rule.count = parseInt(kv.COUNT, 10);
  if (kv.UNTIL) {
    const u = kv.UNTIL.slice(0, 8);
    rule.until = `${u.slice(0, 4)}-${u.slice(4, 6)}-${u.slice(6, 8)}`;
  }
  return rule;
}

export function formatRule(r: Rule): string {
  const parts = [`FREQ=${r.freq}`];
  if (r.interval > 1) parts.push(`INTERVAL=${r.interval}`);
  if (r.byday?.length) parts.push(`BYDAY=${r.byday.map((d) => DAYS[d]).join(',')}`);
  if (r.bymonthday) parts.push(`BYMONTHDAY=${r.bymonthday}`);
  if (r.count) parts.push(`COUNT=${r.count}`);
  if (r.until) parts.push(`UNTIL=${r.until.replace(/-/g, '')}`);
  return parts.join(';');
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function describeRule(s: string | null): string {
  const r = parseRule(s);
  if (!r) return '';
  const every = r.interval > 1 ? `Every ${r.interval} ` : 'Every ';
  let out = '';
  if (r.freq === 'DAILY') out = r.interval > 1 ? `${every}days` : 'Every day';
  if (r.freq === 'WEEKLY') {
    const days = r.byday?.length ? r.byday.slice().sort().map((d) => DAY_NAMES[d]).join(', ') : '';
    out = days === 'Mon, Tue, Wed, Thu, Fri' ? 'Weekdays' : `${r.interval > 1 ? every + 'weeks' : 'Weekly'}${days ? ' · ' + days : ''}`;
  }
  if (r.freq === 'MONTHLY') out = r.interval > 1 ? `${every}months` : 'Monthly';
  if (r.freq === 'YEARLY') out = 'Yearly';
  if (r.until) out += ` until ${r.until}`;
  if (r.count) out += ` · ${r.count} times`;
  return out;
}

/** Local dates (YYYY-MM-DD) on which a series starting on `startDate` occurs, within [from, to]. */
export function occurrenceDates(startDate: string, rrule: string | null, from: string, to: string, exdates: string[] = []): string[] {
  const rule = parseRule(rrule);
  const ex = new Set(exdates);
  if (!rule) return startDate >= from && startDate <= to && !ex.has(startDate) ? [startDate] : [];
  const out: string[] = [];
  const end = rule.until && rule.until < to ? rule.until : to;
  let n = 0; // occurrences counted from series start (for COUNT)
  const sy = +startDate.slice(0, 4), sm = +startDate.slice(5, 7), sd = +startDate.slice(8, 10);
  const startWeekday = weekdayOf(startDate);
  const byday = rule.byday?.length ? rule.byday : [startWeekday];
  const weekStart = addDays(startDate, -startWeekday); // Sunday of the first week

  for (let i = 0; i < 4000; i++) {
    let date: string | null = null;
    if (rule.freq === 'DAILY') date = addDays(startDate, i * rule.interval);
    else if (rule.freq === 'WEEKLY') {
      // iterate day by day inside eligible weeks
      date = addDays(startDate, i);
      const weekIdx = Math.floor(daysBetween(weekStart, date) / 7);
      if (weekIdx % rule.interval !== 0 || !byday.includes(weekdayOf(date))) {
        if (date > end) break;
        continue;
      }
    } else if (rule.freq === 'MONTHLY') {
      const mi = sm - 1 + i * rule.interval;
      const y = sy + Math.floor(mi / 12), m = (mi % 12) + 1;
      const day = rule.bymonthday ?? sd;
      const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
      if (day > dim) continue; // e.g. 31st in a 30-day month: skipped, as calendars do
      date = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    } else {
      const y = sy + i * rule.interval;
      if (sm === 2 && sd === 29 && !(y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0))) continue;
      date = `${y}-${startDate.slice(5)}`;
    }
    if (date < startDate) continue;
    if (date > end) break;
    n++;
    if (rule.count && n > rule.count) break;
    if (date >= from && !ex.has(date)) out.push(date);
  }
  return out;
}

/** next date strictly after `after` (for repeating tasks) */
export function nextOccurrence(startDate: string, rrule: string, after: string): string | null {
  return occurrenceDates(startDate, rrule, addDays(after, 1), addDays(after, 800))[0] ?? null;
}

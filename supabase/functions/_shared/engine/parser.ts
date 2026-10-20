// Reads a plain sentence like
//   "Tomorrow, take Dad to his dentist at 11 am in Bandra. The car needs to leave at 10:15.
//    Remind me to carry his reports and call the clinic before leaving."
// and pulls out what it can. It never fills a gap by guessing: anything missing or ambiguous
// becomes a multiple-choice question for the confirmation screen.

import { addDays, localParts, timeToMin, minToTime } from './time.ts';
import type { Category, TaskRow, TransportMode } from './types.ts';

export interface QOption { label: string; value: string }
export interface Question { field: 'person' | 'date' | 'start' | 'ampm' | 'leave_ampm' | 'end_ampm' | 'transport' | 'title' | 'duration'; prompt: string; options: QOption[]; multi?: boolean; freeText?: boolean }
export interface ParsedPlan {
  title: string | null;
  category: Category;
  personIds: string[];
  date: string | null;
  start: string | null;          // HH:MM
  end: string | null;
  durationMin: number | null;
  location: string | null;
  transport: TransportMode | null;
  leaveAt: string | null;        // HH:MM
  tasks: { title: string; kind: TaskRow['kind'] }[];
  needsConfirmation: boolean;
  questions: Question[];
}

type PersonLite = { id: string; name: string; relation: string | null };
type PlaceLite = { name: string; address: string };

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface TimeHit { idx: number; text: string; h: number; m: number; mer: 'am' | 'pm' | null; role: 'start' | 'end' | 'leave' }

export function parseSentence(input: string, ctx: { now: Date; tz: string; people: PersonLite[]; places: PlaceLite[] }): ParsedPlan {
  const raw = input.trim();
  const text = ' ' + raw.replace(/\s+/g, ' ') + ' ';
  const lower = text.toLowerCase();
  const today = localParts(ctx.now, ctx.tz).date;
  const questions: Question[] = [];

  // ---------- reminders / tasks: pull these out first so their words don't confuse the rest
  const tasks: ParsedPlan['tasks'] = [];
  let body = text;
  const remindRe = /\b(?:remind me to|reminder to|don'?t forget to|need to|also)\s+([^.]+?)(?:\.|$)/gi;
  body = body.replace(remindRe, (_m, list: string) => {
    const cleaned = list.replace(/\b(before (?:leaving|we leave|going)|beforehand|in advance)\b/gi, '').trim();
    for (let part of cleaned.split(/,|\band\b|;/i)) {
      part = part.trim().replace(/^to\s+/i, '');
      if (part.length < 3) continue;
      tasks.push({ title: cap(part), kind: kindOf(part) });
    }
    return ' . ';
  });
  const bodyLower = body.toLowerCase();

  // ---------- date
  let date: string | null = null;
  const dm = (re: RegExp) => re.exec(bodyLower);
  let m: RegExpExecArray | null;
  if (dm(/\bday after tomorrow\b/)) date = addDays(today, 2);
  else if (dm(/\b(tomorrow|tmrw|tmw)\b/)) date = addDays(today, 1);
  else if (dm(/\b(today|tonight|this (?:morning|afternoon|evening))\b/)) date = today;
  else if ((m = dm(/\b(next|this|on|coming)?\s*(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|urday|sday|rsday)?\b/))) {
    const wd = WEEKDAYS.findIndex((w) => w.startsWith(m![2].slice(0, 3)));
    const cur = localParts(ctx.now, ctx.tz).weekday;
    let delta = (wd - cur + 7) % 7;
    if (delta === 0) delta = 7;                 // "Monday" said on a Monday means next week
    date = addDays(today, delta);
  } else if ((m = dm(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/)) ||
             (m = dm(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?\b/))) {
    const [d, mon] = /\d/.test(m[1]) ? [+m[1], m[2]] : [+m[2], m[1]];
    date = futureDate(today, MONTHS.indexOf(mon.slice(0, 3)) + 1, d);
  } else if ((m = dm(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/))) {
    const d = +m[1], mo = +m[2];                 // Indian order: day/month
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      date = m[3] ? `${m[3].length === 2 ? '20' + m[3] : m[3]}-${pad(mo)}-${pad(d)}` : futureDate(today, mo, d);
    }
  } else if ((m = dm(/\bon (?:the )?(\d{1,2})(?:st|nd|rd|th)\b/))) {
    const [y, mo] = today.split('-').map(Number);
    const cand = `${y}-${pad(mo)}-${pad(+m[1])}`;
    date = cand >= today ? cand : (mo === 12 ? `${y + 1}-01-${pad(+m[1])}` : `${y}-${pad(mo + 1)}-${pad(+m[1])}`);
  }

  // ---------- times
  const hits: TimeHit[] = [];
  const timeRe = /\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?(?=[\s,.;)]|$)|\b(noon|midday|midnight)\b/gi;
  while ((m = timeRe.exec(body))) {
    if (m[4]) { hits.push({ idx: m.index, text: m[0], h: m[4].toLowerCase() === 'midnight' ? 0 : 12, m: 0, mer: m[4].toLowerCase() === 'midnight' ? 'am' : 'pm', role: 'start' }); continue; }
    const h = +m[1], min = m[2] ? +m[2] : 0;
    const before = body.slice(Math.max(0, m.index - 30), m.index).toLowerCase();
    const after = body.slice(m.index + m[0].length, m.index + m[0].length + 12).toLowerCase();
    const mer = m[3] ? ((m[3][0].toLowerCase() + 'm') as 'am' | 'pm') : null;
    // a bare number only counts as a time after "at/by/from/till/to/-" or with am/pm or minutes
    const cue = /(?:\bat|\bby|\bfrom|\btill|\buntil|\bto|-|–|\baround|\babout)\s*$/.test(before);
    if (!mer && !m[2] && !cue) continue;
    if (/^\s*(min|mins|minutes|hour|hours|hr|hrs|people|seats|years|th|st|nd|rd)\b/.test(after)) continue;
    if (h > 23 || min > 59) continue;
    let role: TimeHit['role'] = 'start';
    if (/(leave|leaves|leaving|depart|start(?:s)? from home|pick(?:ed)? up (?:at|from)|car (?:at|by)|driver (?:at|by))[^.]{0,25}$/.test(before)) role = 'leave';
    else if (/(till|until|to|-|–|ends? at|finish(?:es)? at)\s*$/.test(before) && hits.some((x) => x.role === 'start')) role = 'end';
    hits.push({ idx: m.index, text: m[0].trim(), h, m: min, mer, role });
  }
  const startHit = hits.find((h) => h.role === 'start') ?? null;
  const endHit = hits.find((h) => h.role === 'end') ?? null;
  const leaveHit = hits.find((h) => h.role === 'leave') ?? null;

  const resolve = (hit: TimeHit | null, field: Question['field'], what: string, ref?: number | null): string | null => {
    if (!hit) return null;
    let h = hit.h;
    if (hit.mer === 'pm' && h < 12) h += 12;
    if (hit.mer === 'am' && h === 12) h = 0;
    if (!hit.mer && h >= 13) return minToTime(h * 60 + hit.m);
    if (!hit.mer && h <= 12) {
      // with a reference time (start → end, start → leave) pick the reading that makes sense
      if (ref != null) {
        const am = (h % 12) * 60 + hit.m, pm = am + 720;
        const pick = field === 'leave_ampm'
          ? [am, pm].filter((t) => t <= ref && ref - t <= 360).sort((a, b) => b - a)[0]
          : [am, pm].filter((t) => t > ref && t - ref <= 720).sort((a, b) => a - b)[0];
        if (pick != null) return minToTime(pick);
      }
      const am = `${h === 12 ? 12 : h}:${pad(hit.m)}`;
      questions.push({ field, prompt: `${what} ${hit.text} — morning or evening?`, options: [
        { label: `${am} AM`, value: minToTime((h % 12) * 60 + hit.m) },
        { label: `${am} PM`, value: minToTime((h % 12) * 60 + hit.m + 720) },
      ] });
      return null;
    }
    return minToTime(h * 60 + hit.m);
  };
  const start = resolve(startHit, 'ampm', 'Start time');
  const startMin = start ? timeToMin(start) : null;
  const end = resolve(endHit, 'end_ampm', 'End time', startMin);
  const leaveAt = resolve(leaveHit, 'leave_ampm', 'Leave time', startMin);

  // ---------- duration
  let durationMin: number | null = null;
  if ((m = /\bfor (?:an? |one )?(half an hour|\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?)?\b/.exec(bodyLower))) {
    if (m[1] === 'half an hour') durationMin = 30;
    else durationMin = Math.round(parseFloat(m[1]) * (/^h/.test(m[2] ?? 'h') ? 60 : 1));
  } else if (/\bfor an hour\b/.test(bodyLower)) durationMin = 60;

  // ---------- people
  const personIds: string[] = [];
  for (const p of ctx.people) {
    const keys = [p.name, p.name.split(' ')[0], p.relation].filter(Boolean) as string[];
    if (keys.some((k) => new RegExp(`\\b${esc(k.toLowerCase())}(?:'s)?\\b`).test(bodyLower))) personIds.push(p.id);
  }

  // ---------- location
  let location: string | null = null;
  for (const pl of ctx.places) {
    if (new RegExp(`\\b${esc(pl.name.toLowerCase())}\\b`).test(bodyLower)) { location = pl.address; break; }
  }
  if (!location && (m = /\b(?:in|at)\s+((?:[A-Z][\w'&-]*)(?:\s+(?:[A-Z][\w'&-]*|West|East|road|Rd|Nagar|marg))*)/.exec(body))) {
    const cand = m[1].replace(/[.,]$/, '');
    if (!/^\d/.test(cand) && !/^(AM|PM|The)$/i.test(cand)) location = cand;
  }

  // ---------- transport
  let transport: TransportMode | null = null;
  if (/\b(drop (?:and|&) pick ?up|drop.*pick (?:\w+ )?up|pick (?:\w+ )?up after)\b/.test(bodyLower)) transport = 'drop_pickup';
  else if (/\b(wait(?:s)? (?:there|for)|stay with|accompany)\b/.test(bodyLower)) transport = 'wait';
  else if (/\bdrop\b/.test(bodyLower)) transport = 'drop';
  else if (/\b(go(?:es|ing)? (?:on (?:his|her|their) own|by (?:auto|cab|train|metro|bus))|self)\b/.test(bodyLower)) transport = 'self';
  const carHinted = /\b(take|taking|car|driver|drive|pick|leave at)\b/.test(bodyLower) || !!leaveAt;
  if (!transport && carHinted) {
    questions.push({ field: 'transport', prompt: 'What does the car need to do?', options: [
      { label: 'Drop & wait there', value: 'wait' }, { label: 'Drop only', value: 'drop' },
      { label: 'Drop & pick up later', value: 'drop_pickup' }, { label: 'No car needed', value: 'none' },
    ] });
  }

  // ---------- title & category
  let title: string | null = null;
  if ((m = /\b(?:to|for)\s+(?:(?:his|her|their|my|the|a|an)\s+)?([a-z][\w' -]*?)(?=\s+(?:at|in|on|by|from|tomorrow|today|tonight|next|this|with|and|\d)\b|[,.]|$)/i.exec(body))) {
    const cand = m[1].trim();
    if (cand.split(' ').length <= 5 && !/^(leave|be|go|get|pick|drop|take|carry|call)\b/i.test(cand)) title = cap(cand);
  }
  if (!title && (m = /^\s*([A-Z][\w' ]{2,40}?)(?=\s+(?:at|on|in|tomorrow|today|for)\b|[,.])/.exec(body))) title = cap(m[1].trim());
  if (title) {
    for (const p of ctx.people) title = title.replace(new RegExp(`\\b${esc(p.name)}(?:'s)?\\b`, 'i'), '').trim() || title;
  }
  const category = categoryOf(`${title ?? ''} ${bodyLower}`);
  const needsConfirmation = /\b(confirm|tentative|not sure|to be confirmed|tbc)\b/.test(lower) || tasks.some((t) => t.kind === 'confirm' || /call the (clinic|doctor|hospital)/i.test(t.title));

  // ---------- questions for anything essential that's missing
  if (!title) questions.unshift({ field: 'title', prompt: 'What is it?', freeText: true, options: [
    { label: 'Doctor', value: 'Doctor' }, { label: 'Dentist', value: 'Dentist' }, { label: 'Class', value: 'Class' },
    { label: 'School', value: 'School' }, { label: 'Meeting', value: 'Meeting' },
  ] });
  if (!personIds.length && ctx.people.length) questions.unshift({ field: 'person', prompt: 'Who is it for?', multi: true,
    options: ctx.people.map((p) => ({ label: p.name, value: p.id })) });
  if (!date) questions.push({ field: 'date', prompt: 'Which day?', options: [
    { label: 'Today', value: today }, { label: 'Tomorrow', value: addDays(today, 1) },
    ...[2, 3, 4, 5].map((n) => ({ label: dayName(addDays(today, n)), value: addDays(today, n) })),
  ] });
  if (!startHit) questions.push({ field: 'start', prompt: 'What time does it start?', options: [
    '08:00', '09:00', '10:00', '11:00', '12:00', '15:00', '16:00', '17:00', '18:00',
  ].map((t) => ({ label: label12(t), value: t })) });
  if (!durationMin && !endHit) questions.push({ field: 'duration', prompt: 'How long will it take?', options: [
    { label: '30 min', value: '30' }, { label: '1 hour', value: '60' }, { label: '1½ hours', value: '90' },
    { label: '2 hours', value: '120' }, { label: 'Half day', value: '240' },
  ] });

  return { title, category, personIds, date, start, end, durationMin, location, transport, leaveAt, tasks, needsConfirmation, questions };
}

function kindOf(s: string): TaskRow['kind'] {
  const t = s.toLowerCase();
  if (/^(call|phone|ring|whatsapp|message)\b/.test(t)) return 'call';
  if (/^(carry|take|bring|pack)\b/.test(t)) return 'carry';
  if (/^(buy|order|get|pick up some)\b/.test(t)) return 'buy';
  if (/^(pay|transfer)\b/.test(t)) return 'pay';
  if (/^confirm\b/.test(t)) return 'confirm';
  if (/\b(book (?:a )?(?:cab|car|taxi)|arrange (?:a )?(?:car|driver))\b/.test(t)) return 'transport';
  return 'todo';
}
function categoryOf(t: string): Category {
  if (/doctor|dentist|dr\.?\s|clinic|hospital|scan|blood test|check.?up|physio|eye test|derma|ent\b/.test(t)) return 'medical';
  if (/school|ptm|parent.?teacher/.test(t)) return 'school';
  if (/class|tuition|lesson|coaching|practice|swimming|dance|music/.test(t)) return 'class';
  if (/flight|train|airport|trip|station|holiday/.test(t)) return 'travel';
  if (/office|meeting|work|call with/.test(t)) return 'work';
  if (/party|dinner|lunch|wedding|birthday|puja|satsang|visit/.test(t)) return 'social';
  if (/plumber|electrician|repair|delivery|maid|cleaning/.test(t)) return 'household';
  return 'appointment';
}
const pad = (n: number) => String(n).padStart(2, '0');
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
function futureDate(today: string, mo: number, d: number): string {
  const y = +today.slice(0, 4);
  const c = `${y}-${pad(mo)}-${pad(d)}`;
  return c >= today ? c : `${y + 1}-${pad(mo)}-${pad(d)}`;
}
function dayName(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', timeZone: 'UTC' });
}
export function label12(t: string): string {
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}${m ? ':' + pad(m) : ''} ${h < 12 ? 'AM' : 'PM'}`;
}

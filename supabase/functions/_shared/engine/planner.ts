// The daily planner. Pure and synchronous: give it rows + a travel lookup, get back an itinerary,
// per-car schedules and a list of problems. When travel times are missing it says so (and lists the
// lookups it needs) instead of guessing.

import { addDays, addMin, diffMin, fmtDuration, fmtTime, localParts, timeToMin, zonedToUtc } from './time.ts';
import { occurrenceDates } from './recurrence.ts';
import type {
  CheckItem, Driver, EventRow, Household, Person, ResourceBlock, TaskRow, TravelEstimate, TravelLookup,
  TravelRequest, Vehicle,
} from './types.ts';

export interface Occurrence { key: string; event: EventRow; date: string; start: Date; end: Date; cancelled: boolean }

export interface Leg {
  kind: 'outbound' | 'pickup' | 'return' | 'reposition';
  from: string; to: string; departAt: Date | null; arriveAt: Date | null; travel: TravelEstimate;
}

export type IssueKind =
  | 'person_overlap' | 'person_tight' | 'car_conflict' | 'driver_conflict' | 'car_missing' | 'driver_missing'
  | 'car_unavailable' | 'driver_unavailable' | 'availability_unknown' | 'location_missing' | 'travel_unknown'
  | 'leave_too_late' | 'needs_confirmation' | 'past_departure';

export interface Issue {
  id: string; severity: 'conflict' | 'warning' | 'info'; kind: IssueKind;
  message: string; suggestions: string[]; occKeys: string[]; date: string;
}

export interface PlanItem {
  occ: Occurrence;
  people: Person[];
  needsTransport: boolean;
  vehicle: Vehicle | null;
  driver: Driver | null;
  selfDrive: boolean;
  legs: Leg[];
  leaveAt: Date | null;          // when the person leaves the pickup point
  travelMin: number | null;
  travelSource: TravelEstimate['source'] | null;
  getReadyAt: Date | null;
  carry: CheckItem[];
  tasksBefore: TaskRow[];
  issues: Issue[];
  nextForCar: string | null;
}

export interface CarJob {
  occKey: string; title: string; who: string; kind: 'drop' | 'wait' | 'pickup';
  startPoint: string; endPoint: string;
  departAt: Date | null;     // leaves startPoint
  freeAt: Date | null;       // car free again (at endPoint)
  repositionFrom: string | null; repositionDepart: Date | null; repositionTravel: TravelEstimate | null;
}
export interface CarDay {
  vehicle: Vehicle; driver: Driver | null; jobs: CarJob[];
  firstNeeded: Date | null; lastFree: Date | null; availabilityKnown: boolean;
}

export interface DayPlan { date: string; items: PlanItem[]; issues: Issue[]; cars: CarDay[] }

export interface PlanInput {
  household: Household;
  people: Person[];
  vehicles: Vehicle[];
  drivers: Driver[];
  blocks: ResourceBlock[];
  events: EventRow[];
  tasks: TaskRow[];
  travel?: TravelLookup;
  now?: Date;
}

export interface PlanResult { days: DayPlan[]; occurrences: Occurrence[]; travelRequests: TravelRequest[] }

export const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

// ---------------------------------------------------------------------------
export function expandOccurrences(events: EventRow[], tz: string, from: string, to: string): Occurrence[] {
  const out: Occurrence[] = [];
  for (const ev of events) {
    const s = new Date(ev.start_at), e = new Date(ev.end_at);
    const sl = localParts(s, tz);
    const lenMin = diffMin(e, s);
    // look back far enough to catch multi-day events that started before `from`
    const dates = occurrenceDates(sl.date, ev.rrule, addDays(from, -Math.ceil(lenMin / 1440)), to, ev.exdates ?? []);
    for (const date of dates) {
      const start = date === sl.date ? s : zonedToUtc(date, sl.time, tz);
      const end = addMin(start, lenMin);
      out.push({ key: `${ev.id}:${date}`, event: ev, date, start, end, cancelled: ev.status === 'cancelled' });
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}

// ---------------------------------------------------------------------------
export function planRange(input: PlanInput, from: string, to: string): PlanResult {
  const { household: hh } = input;
  const tz = hh.timezone;
  const home = hh.home_address?.trim() || hh.home_label || 'Home';
  const homeKey = norm(home);
  const requests = new Map<string, TravelRequest>();
  const peopleById = new Map(input.people.map((p) => [p.id, p]));
  const vehById = new Map(input.vehicles.map((v) => [v.id, v]));
  const drvById = new Map(input.drivers.map((d) => [d.id, d]));
  const buffer = hh.traffic_buffer_min ?? 15;
  const label = (addr: string) => (norm(addr) === homeKey ? hh.home_label || 'Home' : addr);

  const travel = (fromA: string, toB: string, departAt: Date, override?: number | null): TravelEstimate => {
    if (override != null) return { minutes: override, source: 'manual' };
    if (norm(fromA) === norm(toB)) return { minutes: 0, source: 'manual' };
    const found = input.travel?.(fromA, toB, departAt);
    if (found && found.minutes != null) return found;
    if (!hh.home_address && (norm(fromA) === homeKey || norm(toB) === homeKey)) {
      // no home address: can't route from "Home"
    } else {
      const bucket = roundTo15(departAt);
      const k = `${norm(fromA)}|${norm(toB)}|${bucket.toISOString()}`;
      if (!requests.has(k)) requests.set(k, { from: fromA, to: toB, departAt: bucket.toISOString() });
    }
    if (hh.fallback_travel_min) return { minutes: hh.fallback_travel_min, source: 'fallback' };
    return { minutes: null, source: 'unknown' };
  };

  const all = expandOccurrences(input.events, tz, from, to);
  const days: DayPlan[] = [];

  for (let date = from; date <= to; date = addDays(date, 1)) {
    const occs = all.filter((o) => o.date === date || (o.start < zonedToUtc(addDays(date, 1), '00:00', tz) && o.end > zonedToUtc(date, '00:00', tz) && o.date < date));
    const issues: Issue[] = [];
    const items: PlanItem[] = [];
    const jobsByCar = new Map<string, { job: CarJob; item: PlanItem }[]>();
    const missingCar: { item: PlanItem; start: Date; end: Date; who: string }[] = [];
    const issue = (sev: Issue['severity'], kind: IssueKind, message: string, occKeys: string[], suggestions: string[] = []) => {
      const id = `${kind}:${occKeys.join(',')}`;
      if (issues.some((i) => i.id === id)) return null;
      const it: Issue = { id, severity: sev, kind, message, suggestions, occKeys, date };
      issues.push(it);
      return it;
    };

    for (const occ of occs) {
      const ev = occ.event;
      const people = ev.person_ids.map((id) => peopleById.get(id)).filter(Boolean) as Person[];
      const who = people.map((p) => p.name).join(' & ') || 'someone';
      const needsTransport = !occ.cancelled && ['drop', 'drop_pickup', 'wait'].includes(ev.transport_mode);
      const vehicle = ev.vehicle_id ? vehById.get(ev.vehicle_id) ?? null : null;
      const driver = ev.self_drive ? null : (ev.driver_id ? drvById.get(ev.driver_id) : vehicle?.default_driver_id ? drvById.get(vehicle.default_driver_id) : null) ?? null;
      const item: PlanItem = {
        occ, people, needsTransport, vehicle, driver, selfDrive: ev.self_drive, legs: [], leaveAt: null,
        travelMin: null, travelSource: null, getReadyAt: null,
        carry: (ev.checklist ?? []).filter((c) => !c.done),
        tasksBefore: input.tasks.filter((t) => t.event_id === ev.id && t.status !== 'done' && (!t.occurrence_date || t.occurrence_date === occ.date)),
        issues: [], nextForCar: null,
      };
      items.push(item);
      if (occ.cancelled) continue;

      if (ev.needs_confirmation) {
        const i = issue('info', 'needs_confirmation', `${ev.title} (${who}) still needs to be confirmed`, [occ.key], ['Call to confirm, then tap "Mark confirmed"']);
        if (i) item.issues.push(i);
      }

      if (needsTransport) {
        const origin = ev.pickup_from?.trim() || people.find((p) => p.usual_pickup)?.usual_pickup || home;
        const dest = ev.location?.trim();
        const back = ev.return_to?.trim() || origin;
        if (!dest) {
          const i = issue('warning', 'location_missing', `${ev.title}: add a location so travel time can be worked out`, [occ.key]);
          if (i) item.issues.push(i);
        }
        const out = dest ? travel(origin, dest, addMin(occ.start, -60), ev.travel_min_override) : { minutes: null, source: 'unknown' as const };
        item.travelMin = out.minutes;
        item.travelSource = out.source;
        let depart: Date | null = null;
        if (ev.leave_lead_min != null) {
          depart = addMin(occ.start, -ev.leave_lead_min);
          if (out.minutes != null && out.minutes + buffer > ev.leave_lead_min) {
            const i = issue('warning', 'leave_too_late',
              `${ev.title}: leaving at ${fmtTime(depart, tz)} may be late — the drive is about ${fmtDuration(out.minutes)}${buffer ? ` plus your ${buffer} min buffer` : ''}`,
              [occ.key], [`Leave by ${fmtTime(addMin(occ.start, -(out.minutes + buffer)), tz)} instead`]);
            if (i) item.issues.push(i);
          }
        } else if (out.minutes != null) {
          depart = addMin(occ.start, -(out.minutes + buffer));
        }
        item.leaveAt = depart;
        const arrive = depart && out.minutes != null ? addMin(depart, out.minutes) : null;
        if (dest) item.legs.push({ kind: 'outbound', from: label(origin), to: dest, departAt: depart, arriveAt: arrive, travel: out });

        let retTravel: TravelEstimate | null = null;
        if (dest && (ev.transport_mode === 'wait' || ev.transport_mode === 'drop_pickup')) {
          retTravel = travel(dest, back, occ.end);
          const kind = ev.transport_mode === 'wait' ? 'return' : 'pickup';
          item.legs.push({ kind, from: dest, to: label(back), departAt: occ.end, arriveAt: retTravel.minutes != null ? addMin(occ.end, retTravel.minutes) : null, travel: retTravel });
        }

        if (out.minutes == null && dest) {
          const i = issue('warning', 'travel_unknown', `Travel time for ${ev.title} isn't known yet`, [occ.key],
            [hh.home_address ? 'Connect Google Maps, or type the usual travel time on the plan' : 'Add your home address in Settings, or type the usual travel time on the plan']);
          if (i) item.issues.push(i);
        }

        // car + driver arrangements
        if (!vehicle) {
          missingCar.push({ item, start: depart ?? occ.start, end: ev.transport_mode === 'drop' ? (arrive ?? occ.start) : occ.end, who });
        } else {
          if (!driver && !ev.self_drive) {
            const i = issue('warning', 'driver_missing', `No driver set for ${ev.title} in ${vehicle.name}`, [occ.key], ['Pick a driver, or choose "I\'ll drive"']);
            if (i) item.issues.push(i);
          }
          const list = jobsByCar.get(vehicle.id) ?? [];
          if (dest) {
            const base = { occKey: occ.key, title: ev.title, who, repositionFrom: null, repositionDepart: null, repositionTravel: null };
            if (ev.transport_mode === 'wait') {
              list.push({ item, job: { ...base, kind: 'wait', startPoint: origin, endPoint: back, departAt: depart,
                freeAt: retTravel?.minutes != null ? addMin(occ.end, retTravel.minutes) : null } });
            } else {
              list.push({ item, job: { ...base, kind: 'drop', startPoint: origin, endPoint: dest, departAt: depart, freeAt: arrive } });
              if (ev.transport_mode === 'drop_pickup') {
                list.push({ item, job: { ...base, kind: 'pickup', startPoint: dest, endPoint: back, departAt: occ.end,
                  freeAt: retTravel?.minutes != null ? addMin(occ.end, retTravel.minutes) : null } });
              }
            }
          }
          jobsByCar.set(vehicle.id, list);
        }
      }

      const prepStart = item.leaveAt ?? occ.start;
      if (ev.prep_min > 0) item.getReadyAt = addMin(prepStart, -ev.prep_min);
    }

    for (const m of missingCar) {
      const free = input.vehicles.filter((v) => carLooksFree(v, m.start, m.end, jobsByCar, input.blocks, tz) === true).map((v) => v.name);
      const it = issue('conflict', 'car_missing', `No car arranged for ${m.item.occ.event.title} (${m.who})`, [m.item.occ.key], [
        ...free.map((n) => `Assign ${n} — it looks free then`),
        'Book a cab or ask someone to drive',
      ]);
      if (it) m.item.issues.push(it);
    }

    // --- per-person overlaps and tight gaps --------------------------------
    for (const p of input.people) {
      const mine = items.filter((it) => !it.occ.cancelled && !it.occ.event.all_day && it.occ.event.person_ids.includes(p.id))
        .sort((a, b) => a.occ.start.getTime() - b.occ.start.getTime());
      for (let i = 1; i < mine.length; i++) {
        const a = mine[i - 1], b = mine[i];
        if (b.occ.start < a.occ.end) {
          const it = issue('conflict', 'person_overlap',
            `${p.name} has ${a.occ.event.title} (${fmtTime(a.occ.start, tz)}–${fmtTime(a.occ.end, tz)}) and ${b.occ.event.title} (${fmtTime(b.occ.start, tz)}) at the same time`,
            [a.occ.key, b.occ.key], [`Move ${b.occ.event.title}`, `Cancel one of them`]);
          if (it) { a.issues.push(it); b.issues.push(it); }
        } else if (a.occ.event.location && b.occ.event.location && norm(a.occ.event.location) !== norm(b.occ.event.location)) {
          const t = travel(a.occ.event.location, b.occ.event.location, a.occ.end);
          const gap = diffMin(b.occ.start, a.occ.end);
          if (t.minutes != null && t.minutes > gap) {
            const it = issue('warning', 'person_tight',
              `${p.name} needs about ${fmtDuration(t.minutes)} to get from ${a.occ.event.title} to ${b.occ.event.title} but has ${fmtDuration(gap)}`,
              [a.occ.key, b.occ.key], [`Start ${b.occ.event.title} after ${fmtTime(addMin(a.occ.end, t.minutes), tz)}`, `Leave ${a.occ.event.title} early`]);
            if (it) { a.issues.push(it); b.issues.push(it); }
          }
        }
      }
    }

    // --- per-car sequencing, availability, drivers ---------------------------
    const cars: CarDay[] = [];
    const driverJobs = new Map<string, { job: CarJob; item: PlanItem; car: Vehicle }[]>();
    for (const [vid, list] of jobsByCar) {
      const vehicle = vehById.get(vid)!;
      list.sort((a, b) => (a.job.departAt ?? a.item.occ.start).getTime() - (b.job.departAt ?? b.item.occ.start).getTime());
      let loc = home, freeAt: Date | null = null, prev: { job: CarJob; item: PlanItem } | null = null;
      const availabilityKnown = vehicle.available_days != null;
      if (!availabilityKnown) {
        const it = issue('warning', 'availability_unknown', `${vehicle.name}'s availability hasn't been entered — please confirm it's free`, list.map((l) => l.item.occ.key), ['Set availability under More → Cars & drivers']);
        if (it) list.forEach((l) => l.item.issues.push(it));
      }
      for (const entry of list) {
        const { job, item } = entry;
        const need = job.departAt;
        if (need) {
          const repo = norm(loc) === norm(job.startPoint) ? { minutes: 0, source: 'manual' as const } : travel(loc, job.startPoint, addMin(need, -45));
          if (repo.minutes && repo.minutes > 0) {
            job.repositionFrom = label(loc);
            job.repositionTravel = repo;
            job.repositionDepart = addMin(need, -repo.minutes);
          }
          const mustLeave = repo.minutes != null ? addMin(need, -repo.minutes) : need;
          if (prev && freeAt && mustLeave < freeAt) {
            const late = diffMin(freeAt, mustLeave);
            const others = input.vehicles.filter((v) => v.id !== vid && carLooksFree(v, mustLeave, job.freeAt ?? item.occ.end, jobsByCar, input.blocks, tz) === true).map((v) => v.name);
            const it = issue('conflict', 'car_conflict',
              `${vehicle.name} can't do both: ${prev.job.title} (${prev.job.who}) keeps it until ${fmtTime(freeAt, tz)}, but it must leave ${label(loc)} by ${fmtTime(mustLeave, tz)} for ${job.title} (${job.who}) — about ${fmtDuration(late)} short`,
              [prev.item.occ.key, item.occ.key],
              [...others.map((n) => `Send ${n} for ${job.title}`), 'Book a cab for one of the trips', `Ask to move ${job.title} by ${fmtDuration(late + 5)}`]);
            if (it) { prev.item.issues.push(it); item.issues.push(it); }
          }
          const avail = carLooksFree(vehicle, mustLeave, job.freeAt ?? item.occ.end, new Map(), input.blocks, tz);
          if (avail === false) {
            const it = issue('conflict', 'car_unavailable', `${vehicle.name} isn't available at ${fmtTime(mustLeave, tz)} for ${job.title}`, [item.occ.key], ['Choose another car', 'Book a cab']);
            if (it) item.issues.push(it);
          }
        }
        if (job.freeAt) { freeAt = job.freeAt; loc = job.endPoint; }
        else if (job.departAt) { freeAt = null; loc = job.endPoint; }
        prev = entry;
        const drv = item.driver;
        if (drv) {
          const dl = driverJobs.get(drv.id) ?? [];
          dl.push({ job, item, car: vehicle });
          driverJobs.set(drv.id, dl);
        }
      }
      // next-for-car hints
      list.forEach((entry, i) => {
        const nxt = list.slice(i + 1).find((n) => n.item !== entry.item);
        if (nxt && !entry.item.nextForCar && nxt.job.departAt) {
          const verb = nxt.job.kind === 'pickup' ? `pick up ${nxt.job.who} at ${nxt.job.title}` : `${nxt.job.title} (${nxt.job.who})`;
          entry.item.nextForCar = `Then ${vehicle.name} is needed by ${fmtTime(nxt.job.repositionDepart ?? nxt.job.departAt, tz)} for ${verb}`;
        }
      });
      const driver = list.find((l) => l.item.driver)?.item.driver ?? null;
      const times = list.map((l) => l.job.repositionDepart ?? l.job.departAt).filter(Boolean) as Date[];
      const frees = list.map((l) => l.job.freeAt).filter(Boolean) as Date[];
      cars.push({
        vehicle, driver, jobs: list.map((l) => l.job), availabilityKnown,
        firstNeeded: times.length ? new Date(Math.min(...times.map((t) => t.getTime()))) : null,
        lastFree: frees.length ? new Date(Math.max(...frees.map((t) => t.getTime()))) : null,
      });
    }

    for (const [did, list] of driverJobs) {
      const drv = drvById.get(did)!;
      if (drv.available_days == null) {
        const it = issue('warning', 'availability_unknown', `${drv.name}'s working hours haven't been entered — please confirm`, list.map((l) => l.item.occ.key));
        if (it) list.forEach((l) => l.item.issues.push(it));
      }
      for (const l of list) {
        const s = l.job.repositionDepart ?? l.job.departAt;
        if (s && availableAt(drv, s, l.job.freeAt ?? l.item.occ.end, input.blocks, tz, 'driver') === false) {
          const it = issue('conflict', 'driver_unavailable', `${drv.name} isn't working at ${fmtTime(s, tz)} (${l.job.title})`, [l.item.occ.key], ['Choose another driver', "Choose \"I'll drive\"", 'Book a cab']);
          if (it) l.item.issues.push(it);
        }
      }
      // same driver in two different cars at once
      list.sort((a, b) => ((a.job.repositionDepart ?? a.job.departAt)?.getTime() ?? 0) - ((b.job.repositionDepart ?? b.job.departAt)?.getTime() ?? 0));
      for (let i = 1; i < list.length; i++) {
        const a = list[i - 1], b = list[i];
        const bStart = b.job.repositionDepart ?? b.job.departAt;
        if (a.car.id !== b.car.id && a.job.freeAt && bStart && bStart < a.job.freeAt) {
          const it = issue('conflict', 'driver_conflict', `${drv.name} can't drive ${a.car.name} (${a.job.title}) and ${b.car.name} (${b.job.title}) at the same time`, [a.item.occ.key, b.item.occ.key], ['Choose another driver for one trip', 'Book a cab']);
          if (it) { a.item.issues.push(it); b.item.issues.push(it); }
        }
      }
    }

    items.sort((a, b) => sortTime(a).getTime() - sortTime(b).getTime());
    issues.sort((a, b) => sevRank(a.severity) - sevRank(b.severity));
    days.push({ date, items, issues, cars });
  }

  return { days, occurrences: all, travelRequests: [...requests.values()] };
}

const sevRank = (s: Issue['severity']) => (s === 'conflict' ? 0 : s === 'warning' ? 1 : 2);
const sortTime = (it: PlanItem) => (it.occ.event.all_day ? new Date(0) : it.leaveAt ?? it.occ.start);
export function roundTo15(d: Date): Date {
  const q = 15 * 60000;
  return new Date(Math.round(d.getTime() / q) * q);
}

/** true = known free, false = known busy/unavailable, null = availability not entered */
function availableAt(r: { id: string; available_days: number[] | null; available_from: string | null; available_to: string | null },
  start: Date, end: Date, blocks: ResourceBlock[], tz: string, type: 'vehicle' | 'driver'): boolean | null {
  for (const b of blocks) {
    const match = type === 'vehicle' ? b.vehicle_id === r.id : b.driver_id === r.id;
    if (match && new Date(b.starts_at) < end && new Date(b.ends_at) > start) return false;
  }
  if (r.available_days == null) return null;
  const s = localParts(start, tz), e = localParts(end, tz);
  if (!r.available_days.includes(s.weekday)) return false;
  const from = r.available_from ? timeToMin(r.available_from) : 0;
  const to = r.available_to ? timeToMin(r.available_to) : 1440;
  const sm = s.hh * 60 + s.mm, em = e.date === s.date ? e.hh * 60 + e.mm : 1440;
  return sm >= from && em <= to;
}

function carLooksFree(v: Vehicle, start: Date, end: Date, jobs: Map<string, { job: CarJob; item: PlanItem }[]>, blocks: ResourceBlock[], tz: string): boolean | null {
  for (const { job, item } of jobs.get(v.id) ?? []) {
    const s = job.repositionDepart ?? job.departAt ?? item.occ.start;
    const e = job.freeAt ?? item.occ.end;
    if (s < end && e > start) return false;
  }
  return availableAt(v, start, end, blocks, tz, 'vehicle');
}

// ---------------------------------------------------------------------------
// "What needs attention" for the home screen
export interface Attention { id: string; tone: 'urgent' | 'normal'; text: string; sub?: string; ref?: { type: 'event' | 'task'; id: string; date?: string } }

export function attentionList(day: DayPlan, tasks: TaskRow[], tz: string, now: Date): Attention[] {
  const today = localParts(now, tz).date;
  const out: Attention[] = [];
  const nextLeave = day.items.find((i) => i.leaveAt && i.leaveAt > now && !i.occ.cancelled);
  if (day.date === today && nextLeave?.leaveAt) {
    out.push({ id: 'leave', tone: diffMin(nextLeave.leaveAt, now) <= 30 ? 'urgent' : 'normal',
      text: `Leave at ${fmtTime(nextLeave.leaveAt, tz)} for ${nextLeave.occ.event.title}`,
      sub: [nextLeave.people.map((p) => p.name).join(', '), nextLeave.vehicle?.name, nextLeave.driver?.name].filter(Boolean).join(' · '),
      ref: { type: 'event', id: nextLeave.occ.event.id, date: nextLeave.occ.date } });
  }
  for (const i of day.issues.filter((x) => x.severity === 'conflict')) {
    out.push({ id: i.id, tone: 'urgent', text: i.message, sub: i.suggestions[0] });
  }
  const overdue = tasks.filter((t) => t.status !== 'done' && t.due_date && t.due_date < today);
  if (overdue.length) out.push({ id: 'overdue', tone: 'urgent', text: `${overdue.length} overdue task${overdue.length > 1 ? 's' : ''}`, sub: overdue.slice(0, 2).map((t) => t.title).join(', ') });
  for (const i of day.issues.filter((x) => x.severity === 'warning').slice(0, 3)) out.push({ id: i.id, tone: 'normal', text: i.message, sub: i.suggestions[0] });
  return out;
}

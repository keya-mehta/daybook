import { describe, expect, it } from 'vitest';
import { zonedToUtc, localParts, fmtTime, addDays } from '../supabase/functions/_shared/engine/time.ts';
import { occurrenceDates, describeRule } from '../supabase/functions/_shared/engine/recurrence.ts';
import { planRange, attentionList } from '../supabase/functions/_shared/engine/planner.ts';
import { desiredReminders } from '../supabase/functions/_shared/engine/reminders.ts';
import { parseSentence } from '../supabase/functions/_shared/engine/parser.ts';
import type { Driver, EventRow, Household, Person, TaskRow, Vehicle } from '../supabase/functions/_shared/engine/types.ts';

const tz = 'Asia/Kolkata';
const now = zonedToUtc('2026-10-20', '13:44', tz); // a Tuesday
const hh: Household = { id: 'h', name: 'Test', timezone: tz, home_label: 'Home', home_address: 'Carmichael Road, Mumbai',
  traffic_buffer_min: 15, fallback_travel_min: null, default_reminders: [1440, 60], leave_reminder_min: 15 };
const person = (id: string, name: string, relation: string | null = null): Person => ({ id, household_id: 'h', name, relation, initials: null,
  color: '#000', photo_url: null, phone: null, email: null, notes: null, usual_pickup: null, sort: 0, archived: false, is_sample: false });
const people = [person('dad', 'Rajiv', 'Dad'), person('ana', 'Ananya'), person('dadi', 'Kamla', 'Dadi')];
const ramesh: Driver = { id: 'ram', household_id: 'h', name: 'Ramesh', phone: null, notes: null, available_days: [1, 2, 3, 4, 5, 6], available_from: '08:00', available_to: '20:00', is_sample: false };
const city: Vehicle = { id: 'city', household_id: 'h', name: 'Honda City', seats: 4, default_driver_id: 'ram', notes: null, available_days: [0, 1, 2, 3, 4, 5, 6], available_from: '07:00', available_to: '22:00', is_sample: false };
const innova: Vehicle = { ...city, id: 'innova', name: 'Innova', default_driver_id: null, available_days: null, available_from: null, available_to: null };

let n = 0;
const ev = (p: Partial<EventRow> & { date: string; from: string; to: string }): EventRow => ({
  id: p.id ?? `e${++n}`, household_id: 'h', title: p.title ?? 'Thing', category: p.category ?? 'appointment', person_ids: p.person_ids ?? ['dad'],
  start_at: zonedToUtc(p.date, p.from, tz).toISOString(), end_at: zonedToUtc(p.date, p.to, tz).toISOString(), all_day: false,
  location: p.location ?? null, place_id: null, status: p.status ?? 'planned', needs_confirmation: p.needs_confirmation ?? false,
  transport_mode: p.transport_mode ?? 'none', pickup_from: p.pickup_from ?? null, return_to: null, vehicle_id: p.vehicle_id ?? null,
  driver_id: p.driver_id ?? null, self_drive: p.self_drive ?? false, leave_lead_min: p.leave_lead_min ?? null, travel_min_override: p.travel_min_override ?? null,
  prep_min: p.prep_min ?? 0, reminder_offsets: p.reminder_offsets ?? null, remind_leave: true, rrule: p.rrule ?? null, exdates: p.exdates ?? [],
  series_id: null, checklist: p.checklist ?? [], notes: null, gcal_event_id: null, is_sample: false,
});
// fake Maps: Home ↔ Bandra 40, Home ↔ Peddar 15, Bandra ↔ Peddar 45, Bandra ↔ Khar 10
const table: Record<string, number> = { 'carmichael road, mumbai|bandra': 40, 'carmichael road, mumbai|peddar road': 15, 'bandra|peddar road': 45, 'bandra|khar': 10, 'carmichael road, mumbai|khar': 45 };
const travel = (a: string, b: string) => {
  const k1 = `${a.toLowerCase()}|${b.toLowerCase()}`, k2 = `${b.toLowerCase()}|${a.toLowerCase()}`;
  const v = table[k1] ?? table[k2];
  return v == null ? undefined : { minutes: v, source: 'google_traffic' as const };
};
const base = { household: hh, people, vehicles: [city, innova], drivers: [ramesh], blocks: [], tasks: [] as TaskRow[], travel, now };

describe('time', () => {
  it('converts local IST to UTC and back', () => {
    const d = zonedToUtc('2026-10-21', '11:00', tz);
    expect(d.toISOString()).toBe('2026-10-21T05:30:00.000Z');
    expect(localParts(d, tz).time).toBe('11:00');
    expect(fmtTime(d, tz)).toBe('11:00 AM');
  });
  it('handles DST zones', () => {
    expect(zonedToUtc('2026-07-01', '09:00', 'Europe/London').toISOString()).toBe('2026-07-01T08:00:00.000Z');
    expect(zonedToUtc('2026-12-01', '09:00', 'Europe/London').toISOString()).toBe('2026-12-01T09:00:00.000Z');
  });
});

describe('recurrence', () => {
  it('weekdays', () => {
    expect(occurrenceDates('2026-10-19', 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', '2026-10-23', '2026-10-27'))
      .toEqual(['2026-10-23', '2026-10-26', '2026-10-27']);
    expect(describeRule('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR')).toBe('Weekdays');
  });
  it('every 2 weeks, count, until, exdates', () => {
    expect(occurrenceDates('2026-10-20', 'FREQ=WEEKLY;INTERVAL=2', '2026-10-01', '2026-12-01')).toEqual(['2026-10-20', '2026-11-03', '2026-11-17', '2026-12-01']);
    expect(occurrenceDates('2026-10-20', 'FREQ=DAILY;COUNT=3', '2026-10-01', '2026-12-01')).toEqual(['2026-10-20', '2026-10-21', '2026-10-22']);
    expect(occurrenceDates('2026-10-20', 'FREQ=DAILY;UNTIL=20261022', '2026-10-01', '2026-12-01', ['2026-10-21'])).toEqual(['2026-10-20', '2026-10-22']);
  });
  it('monthly on the 31st skips short months', () => {
    expect(occurrenceDates('2026-10-31', 'FREQ=MONTHLY', '2026-10-01', '2027-01-31')).toEqual(['2026-10-31', '2026-12-31', '2027-01-31']);
  });
});

describe('planner', () => {
  it('works out leave time from travel + buffer and lists what to carry', () => {
    const e = ev({ title: 'Dentist', date: '2026-10-21', from: '11:00', to: '11:45', location: 'Bandra', transport_mode: 'wait', vehicle_id: 'city',
      checklist: [{ id: 'c', text: 'X-rays', done: false }] });
    const day = planRange({ ...base, events: [e] }, '2026-10-21', '2026-10-21').days[0];
    const it = day.items[0];
    expect(fmtTime(it.leaveAt!, tz)).toBe('10:05 AM'); // 11:00 − 40 − 15
    expect(it.travelSource).toBe('google_traffic');
    expect(it.driver?.name).toBe('Ramesh');
    expect(it.carry.map((c) => c.text)).toEqual(['X-rays']);
    expect(it.legs.map((l) => l.kind)).toEqual(['outbound', 'return']);
    expect(day.cars[0].jobs[0].freeAt && fmtTime(day.cars[0].jobs[0].freeAt, tz)).toBe('12:25 PM');
    expect(day.issues.filter((i) => i.severity === 'conflict')).toEqual([]);
  });

  it('flags when one car cannot do two trips, and suggests the other car', () => {
    const a = ev({ title: 'Dentist', date: '2026-10-21', from: '11:00', to: '11:45', location: 'Bandra', transport_mode: 'wait', vehicle_id: 'city' });
    const b = ev({ title: 'School pickup', person_ids: ['ana'], date: '2026-10-21', from: '12:00', to: '12:30', location: 'Peddar Road', transport_mode: 'drop', vehicle_id: 'city' });
    const day = planRange({ ...base, events: [a, b] }, '2026-10-21', '2026-10-21').days[0];
    const c = day.issues.find((i) => i.kind === 'car_conflict');
    expect(c).toBeTruthy();
    expect(c!.message).toContain("Honda City can't do both");
  });

  it('chains a car from one place to the next when there is time', () => {
    const a = ev({ title: 'Dentist', date: '2026-10-21', from: '11:00', to: '11:30', location: 'Bandra', transport_mode: 'drop', vehicle_id: 'city' });
    const b = ev({ title: 'Class', person_ids: ['ana'], date: '2026-10-21', from: '13:30', to: '14:30', location: 'Khar', transport_mode: 'drop', vehicle_id: 'city' });
    const day = planRange({ ...base, events: [a, b] }, '2026-10-21', '2026-10-21').days[0];
    expect(day.issues.find((i) => i.kind === 'car_conflict')).toBeUndefined();
    const job = day.cars[0].jobs[1];
    expect(job.repositionFrom).toBe('Bandra');             // car goes from Bandra back home to collect Ananya
    expect(day.items[0].nextForCar).toContain('Honda City is needed by');
  });

  it('never assumes a car: no car → conflict; unknown availability → warning', () => {
    const a = ev({ title: 'Dance', person_ids: ['ana'], date: '2026-10-21', from: '16:00', to: '17:00', location: 'Khar', transport_mode: 'drop' });
    const b = ev({ title: 'Satsang', person_ids: ['dadi'], date: '2026-10-21', from: '17:00', to: '18:00', location: 'Bandra', transport_mode: 'drop', vehicle_id: 'innova' });
    const day = planRange({ ...base, events: [a, b] }, '2026-10-21', '2026-10-21').days[0];
    const missing = day.issues.find((i) => i.kind === 'car_missing')!;
    expect(missing.severity).toBe('conflict');
    expect(missing.suggestions[0]).toBe('Assign Honda City — it looks free then');
    expect(day.issues.some((i) => i.kind === 'availability_unknown' && i.message.includes('Innova'))).toBe(true);
    expect(day.issues.some((i) => i.kind === 'driver_missing')).toBe(true);
  });

  it('detects overlapping plans for the same person and tight gaps', () => {
    const a = ev({ title: 'Physio', date: '2026-10-21', from: '10:00', to: '11:00', location: 'Bandra' });
    const b = ev({ title: 'Bank', date: '2026-10-21', from: '10:30', to: '11:00', location: 'Bandra' });
    const c = ev({ title: 'Lunch', date: '2026-10-21', from: '11:15', to: '12:00', location: 'Peddar Road' });
    const day = planRange({ ...base, events: [a, b, c] }, '2026-10-21', '2026-10-21').days[0];
    expect(day.issues.some((i) => i.kind === 'person_overlap')).toBe(true);
    expect(day.issues.some((i) => i.kind === 'person_tight')).toBe(true);
  });

  it('respects a fixed leave time and warns if it is too late', () => {
    const e = ev({ title: 'Dentist', date: '2026-10-21', from: '11:00', to: '11:45', location: 'Bandra', transport_mode: 'wait', vehicle_id: 'city', leave_lead_min: 45 });
    const day = planRange({ ...base, events: [e] }, '2026-10-21', '2026-10-21').days[0];
    expect(fmtTime(day.items[0].leaveAt!, tz)).toBe('10:15 AM');
    expect(day.issues.some((i) => i.kind === 'leave_too_late')).toBe(true);
  });

  it('does not invent travel times: lists lookups needed and marks unknown', () => {
    const e = ev({ title: 'Wedding', date: '2026-10-21', from: '19:00', to: '22:00', location: 'Thane', transport_mode: 'wait', vehicle_id: 'city' });
    const r = planRange({ ...base, events: [e] }, '2026-10-21', '2026-10-21');
    expect(r.days[0].items[0].leaveAt).toBeNull();
    expect(r.days[0].items[0].travelSource).toBe('unknown');
    expect(r.travelRequests.length).toBeGreaterThan(0);
    expect(r.days[0].issues.some((i) => i.kind === 'travel_unknown')).toBe(true);
  });

  it('flags a driver outside working hours and on blocked days', () => {
    const e = ev({ title: 'Early flight', date: '2026-10-25', from: '07:00', to: '08:00', location: 'Bandra', transport_mode: 'drop', vehicle_id: 'city' }); // Sunday
    const day = planRange({ ...base, events: [e] }, '2026-10-25', '2026-10-25').days[0];
    expect(day.issues.some((i) => i.kind === 'driver_unavailable')).toBe(true);
    const blocked = planRange({ ...base, blocks: [{ id: 'b', household_id: 'h', vehicle_id: 'city', driver_id: null, starts_at: zonedToUtc('2026-10-21', '00:00', tz).toISOString(), ends_at: zonedToUtc('2026-10-22', '00:00', tz).toISOString(), reason: 'service' }],
      events: [ev({ title: 'X', date: '2026-10-21', from: '11:00', to: '12:00', location: 'Bandra', transport_mode: 'drop', vehicle_id: 'city' })] }, '2026-10-21', '2026-10-21').days[0];
    expect(blocked.issues.some((i) => i.kind === 'car_unavailable')).toBe(true);
  });

  it('expands recurring events and ignores cancelled ones in conflicts', () => {
    const school = ev({ title: 'School', person_ids: ['ana'], date: '2026-10-19', from: '08:00', to: '13:30', rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' });
    const cancelled = ev({ title: 'Old plan', person_ids: ['ana'], date: '2026-10-21', from: '09:00', to: '10:00', status: 'cancelled' });
    const r = planRange({ ...base, events: [school, cancelled] }, '2026-10-20', '2026-10-26');
    expect(r.days.filter((d) => d.items.some((i) => i.occ.event.title === 'School')).map((d) => d.date))
      .toEqual(['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-26']);
    expect(r.days[1].issues.some((i) => i.kind === 'person_overlap')).toBe(false);
  });
});

describe('reminders', () => {
  it('creates leave, before, confirm and task reminders with stable keys, skipping the past', () => {
    const e = ev({ id: 'dent', title: 'Dentist', date: '2026-10-21', from: '11:00', to: '11:45', location: 'Bandra', transport_mode: 'wait', vehicle_id: 'city', needs_confirmation: true });
    const t: TaskRow = { id: 't1', household_id: 'h', title: 'Pay bill', description: null, due_date: '2026-10-20', due_time: '18:00', priority: 2,
      person_id: null, event_id: null, occurrence_date: null, estimate_min: null, rrule: null, checklist: [], status: 'open', waiting_on: null,
      source: 'user', kind: 'pay', completed_at: null, is_sample: false };
    const plan = planRange({ ...base, events: [e] }, '2026-10-20', '2026-10-22');
    const rs = desiredReminders(hh, plan.days, [t], now);
    const keys = rs.map((r) => r.dedupe_key).sort();
    // the 1-day-before reminder (20th 11:00) is already past at 13:44, so it is skipped
    expect(keys).toEqual(['confirm:dent:2026-10-21', 'leave:dent:2026-10-21', 'task:t1:2026-10-20:18:00']);
    // 1-hour-before reminder dropped as it would land 10 min after the leave reminder
    const leave = rs.find((r) => r.kind === 'leave')!;
    expect(fmtTime(leave.fire_at, tz)).toBe('9:50 AM');
    expect(leave.title).toBe('Leave at 10:05 AM · Dentist');
    // planning again gives identical keys (no duplicates)
    expect(desiredReminders(hh, planRange({ ...base, events: [e] }, '2026-10-20', '2026-10-22').days, [t], now).map((r) => r.dedupe_key).sort()).toEqual(keys);
  });
});

describe('attention', () => {
  it('surfaces next departure, conflicts and overdue tasks', () => {
    const e = ev({ title: 'Dentist', date: '2026-10-20', from: '16:00', to: '17:00', location: 'Bandra', transport_mode: 'wait', vehicle_id: 'city' });
    const plan = planRange({ ...base, events: [e] }, '2026-10-20', '2026-10-20');
    const overdue = { id: 'o', status: 'open', due_date: '2026-10-19', title: 'Pay bill' } as TaskRow;
    const a = attentionList(plan.days[0], [overdue], tz, now);
    expect(a[0].text).toBe('Leave at 3:05 PM for Dentist');
    expect(a.some((x) => x.id === 'overdue')).toBe(true);
  });
});

describe('sentence reader', () => {
  const ctx = { now, tz, people: people.map((p) => ({ id: p.id, name: p.name, relation: p.relation })), places: [] };
  it('reads the example sentence', () => {
    const p = parseSentence('Tomorrow, take Dad to his dentist at 11 am in Bandra. The car needs to leave at 10:15. Remind me to carry his reports and call the clinic before leaving.', ctx);
    expect(p.personIds).toEqual(['dad']);
    expect(p.date).toBe('2026-10-21');
    expect(p.start).toBe('11:00');
    expect(p.leaveAt).toBe('10:15');
    expect(p.title).toBe('Dentist');
    expect(p.category).toBe('medical');
    expect(p.location).toBe('Bandra');
    expect(p.tasks).toEqual([{ title: 'Carry his reports', kind: 'carry' }, { title: 'Call the clinic', kind: 'call' }]);
    // "take" doesn't say whether the car waits → asks; duration not given → asks
    expect(p.questions.map((q) => q.field).sort()).toEqual(['duration', 'transport']);
  });
  it('asks instead of guessing missing or ambiguous details', () => {
    const p = parseSentence('Dance class at 5', ctx);
    expect(p.date).toBeNull();
    expect(p.start).toBeNull();
    const f = p.questions.map((q) => q.field);
    expect(f).toContain('person');
    expect(f).toContain('date');
    expect(f).toContain('ampm');
    expect(p.questions.find((q) => q.field === 'ampm')!.options.map((o) => o.value)).toEqual(['05:00', '17:00']);
  });
  it('handles ranges, weekdays, dates and drop & pick up', () => {
    const p = parseSentence('Drop Ananya at swimming on Friday from 4 pm to 5:30 and pick her up after', ctx);
    expect(p.date).toBe('2026-10-23');
    expect(p.start).toBe('16:00');
    expect(p.end).toBe('17:30');
    expect(p.transport).toBe('drop_pickup');
    expect(p.personIds).toEqual(['ana']);
    expect(parseSentence('Dadi eye test 3/11 at 10am', ctx).date).toBe('2026-11-03');
    expect(parseSentence('Kamla puja on 5 Jan at 9 am', ctx).date).toBe('2027-01-05');
    expect(addDays('2026-10-20', 1)).toBe('2026-10-21');
  });
});

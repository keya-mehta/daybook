// Demo mode: the real app running on sample data kept only in this browser (localStorage).
// No account, no server, no reminders or maps — used to try Daybook before the database is set up.
import { useRef, useState, type ReactNode } from 'react';
import { StoreContext, type StoreCtx, type Data } from './store';
import { toast } from './toast';
import { addDays, localParts, zonedToUtc } from '@engine/time.ts';

const KEY = 'daybook:demo';
export const demoOn = () => { try { return localStorage.getItem(KEY + ':on') === '1'; } catch { return false; } };
export type LocalMode = 'sample' | 'own';
export const localMode = (): LocalMode => { try { return localStorage.getItem(KEY + ':mode') === 'own' ? 'own' : 'sample'; } catch { return 'sample'; } };
export function startDemo(mode: LocalMode = 'sample') { localStorage.setItem(KEY + ':on', '1'); localStorage.setItem(KEY + ':mode', mode); localStorage.removeItem(KEY); location.reload(); }
export function endDemo() { localStorage.removeItem(KEY + ':on'); localStorage.removeItem(KEY + ':mode'); localStorage.removeItem(KEY); location.reload(); }

/** drop every sample item, keep what the user added, and switch to "my own family" */
export function clearSampleLocal() {
  const d = load();
  const keep = <T,>(list: T[]) => list.filter((x) => !(x as { is_sample?: boolean }).is_sample);
  const events = keep(d.events);
  const ids = new Set(events.map((e) => e.id));
  const next = { ...d, people: keep(d.people), places: keep(d.places), vehicles: keep(d.vehicles), drivers: keep(d.drivers), events,
    tasks: keep(d.tasks).filter((t) => !t.event_id || ids.has(t.event_id)), notes: keep(d.notes), reminders: [],
    household: { ...d.household, name: d.household.name === 'Demo family' ? 'My family' : d.household.name } };
  localStorage.setItem(KEY, JSON.stringify(next));
  localStorage.setItem(KEY + ':mode', 'own');
  location.reload();
}

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
const TABLE: Record<string, keyof Data> = { people: 'people', places: 'places', vehicles: 'vehicles', drivers: 'drivers', resource_blocks: 'blocks', events: 'events', tasks: 'tasks', reminders: 'reminders', notes: 'notes', invites: 'invites' };

function sample(): Data {
  const tz = 'Asia/Kolkata';
  const d0 = localParts(new Date(), tz).date;
  const at = (d: string, t: string) => zonedToUtc(d, t, tz).toISOString();
  const H = 'demo';
  const base = { household_id: H, is_sample: true };
  const P = (id: string, name: string, relation: string, color: string, sort: number) => ({ ...base, id, name, relation, initials: null, color, photo_url: null, phone: null, email: null, notes: null, usual_pickup: null, sort, archived: false });
  const E = (o: Record<string, unknown>) => ({ ...base, category: 'appointment', all_day: false, place_id: null, status: 'planned', needs_confirmation: false, transport_mode: 'none', pickup_from: null, return_to: null, vehicle_id: null, driver_id: null, self_drive: false, leave_lead_min: null, travel_min_override: null, prep_min: 0, reminder_offsets: null, remind_leave: true, rrule: null, exdates: [], series_id: null, checklist: [], notes: null, gcal_event_id: null, updated_at: new Date().toISOString(), ...o });
  const T = (o: Record<string, unknown>) => ({ ...base, description: null, due_time: null, priority: 2, person_id: null, event_id: null, occurrence_date: null, estimate_min: null, rrule: null, checklist: [], status: 'open', waiting_on: null, source: 'user', kind: 'todo', completed_at: null, ...o });
  return {
    household: { id: H, name: 'Demo family', timezone: tz, home_label: 'Home', home_address: 'Carmichael Road, Mumbai', traffic_buffer_min: 15, fallback_travel_min: 30, default_reminders: [1440, 60], leave_reminder_min: 15 },
    members: [{ household_id: H, user_id: 'demo-user', role: 'owner', email: 'demo', display_name: null, person_id: null, driver_id: null, email_summary: false, summary_hour: 7 }],
    invites: [],
    people: [P('dad', 'Rajiv', 'Dad', '#6c8768', 1), P('ana', 'Ananya', 'Granddaughter', '#a7835f', 2), P('dadi', 'Kamla', 'Dadi', '#7f7499', 3)],
    places: [{ ...base, id: 'pl1', name: 'Dr. Shah Dental', address: 'Hill Road, Bandra West, Mumbai', phone: null, notes: null }, { ...base, id: 'pl2', name: "Ananya's school", address: 'Peddar Road, Mumbai', phone: null, notes: null }],
    drivers: [{ ...base, id: 'ram', name: 'Ramesh', phone: null, notes: null, available_days: [1, 2, 3, 4, 5, 6], available_from: '07:00', available_to: '20:00' }],
    vehicles: [{ ...base, id: 'city', name: 'Honda City', seats: 4, default_driver_id: 'ram', notes: null, available_days: [0, 1, 2, 3, 4, 5, 6], available_from: '07:00', available_to: '22:00' },
      { ...base, id: 'inn', name: 'Innova', seats: 7, default_driver_id: null, notes: null, available_days: null, available_from: null, available_to: null }],
    blocks: [],
    events: [
      E({ id: 'e1', title: 'Dentist', category: 'medical', person_ids: ['dad'], start_at: at(addDays(d0, 1), '11:00'), end_at: at(addDays(d0, 1), '11:45'), location: 'Hill Road, Bandra West, Mumbai', transport_mode: 'wait', vehicle_id: 'city', driver_id: 'ram', needs_confirmation: true, checklist: [{ id: 'c1', text: 'Previous X-rays', done: false }, { id: 'c2', text: 'Insurance card', done: false }] }),
      E({ id: 'e2', title: 'School', category: 'school', person_ids: ['ana'], start_at: at(addDays(d0, -1), '08:00'), end_at: at(addDays(d0, -1), '13:30'), location: 'Peddar Road, Mumbai', transport_mode: 'drop_pickup', vehicle_id: 'city', driver_id: 'ram', rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' }),
      E({ id: 'e3', title: 'Bharatanatyam class', category: 'class', person_ids: ['ana'], start_at: at(d0, '17:00'), end_at: at(d0, '18:00'), location: 'Khar West, Mumbai', transport_mode: 'drop' }),
      E({ id: 'e4', title: 'Satsang', category: 'social', person_ids: ['dadi'], start_at: at(d0, '18:30'), end_at: at(d0, '20:00'), location: 'Juhu, Mumbai', transport_mode: 'self' }),
      E({ id: 'e5', title: 'Eye check-up', category: 'medical', person_ids: ['dadi'], start_at: at(addDays(d0, 2), '11:00'), end_at: at(addDays(d0, 2), '12:00'), location: 'Breach Candy Hospital, Mumbai', transport_mode: 'wait', vehicle_id: 'inn' }),
    ],
    tasks: [
      T({ id: 't1', title: 'Call clinic to confirm', kind: 'call', event_id: 'e1', person_id: 'dad', due_date: d0, source: 'suggested' }),
      T({ id: 't2', title: "Collect Dad's reports", kind: 'carry', event_id: 'e1', person_id: 'dad', due_date: d0 }),
      T({ id: 't3', title: 'Pay electricity bill', kind: 'pay', due_date: addDays(d0, -1), priority: 1 }),
      T({ id: 't4', title: "Order Dadi's medicines", kind: 'buy', due_date: d0 }),
      T({ id: 't5', title: 'Plumber to confirm visit', status: 'waiting', waiting_on: 'Plumber' }),
    ],
    reminders: [],
    notes: [
      { ...base, id: 'n1', kind: 'shopping', title: 'Groceries', body: null, items: [{ id: 'a', text: 'Milk', done: false }, { id: 'b', text: 'Atta', done: false }], phone: null, the_date: null, repeats_yearly: false, person_id: null, event_id: null, task_id: null, pinned: false },
      { ...base, id: 'n2', kind: 'checklist', title: 'Doctor visit', body: null, items: [{ id: 'k1', text: 'Reports', done: false }, { id: 'k2', text: 'Prescription', done: false }, { id: 'k3', text: 'Insurance card', done: false }], phone: null, the_date: null, repeats_yearly: false, person_id: null, event_id: null, task_id: null, pinned: false },
    ],
  } as unknown as Data;
}

function load(): Data {
  try { const s = localStorage.getItem(KEY); if (s) return JSON.parse(s); } catch { /* fall through */ }
  return localMode() === 'own' ? empty() : sample();
}

function empty(): Data {
  const H = 'demo';
  return {
    household: { id: H, name: 'My family', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata', home_label: 'Home', home_address: null,
      traffic_buffer_min: 15, fallback_travel_min: 30, default_reminders: [1440, 60], leave_reminder_min: 15 },
    members: [{ household_id: H, user_id: 'demo-user', role: 'owner', email: 'this device', display_name: null, person_id: null, driver_id: null, email_summary: false, summary_hour: 7 }],
    invites: [], people: [], places: [], vehicles: [], drivers: [], blocks: [], events: [], tasks: [], reminders: [], notes: [],
  } as unknown as Data;
}

export function DemoStoreProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Data>(load);
  const latest = useRef(data);
  const commit = (d: Data) => { latest.current = d; setData(d); try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* full */ } };
  const upsert = (d: Data, table: string, rows: Record<string, unknown>[]): Data => {
    if (table === 'households') return { ...d, household: { ...d.household, ...rows[0] } };
    if (table === 'household_members') return { ...d, members: d.members.map((m) => ({ ...m, ...rows[0] })) };
    const k = TABLE[table];
    if (!k) return d;
    let list = [...(d[k] as unknown as Record<string, unknown>[])];
    for (const r of rows) {
      const row: Record<string, unknown> = { household_id: 'demo', ...r, id: (r.id as string) || uid(), updated_at: new Date().toISOString() };
      if (table === 'tasks' && row.status === 'done' && !row.completed_at) row.completed_at = new Date().toISOString();
      const i = list.findIndex((x) => x.id === row.id);
      if (i >= 0) list[i] = { ...list[i], ...row }; else list.push(defaults(table, row));
    }
    return { ...d, [k]: list };
  };
  const ctx = {
    session: { user: { id: 'demo-user', email: 'demo' } }, authReady: true, householdId: 'demo', households: [{ id: 'demo', name: data.household.name }], setHouseholdId: () => {},
    data, loading: false, loadError: null, reload: async () => {}, me: data.members[0], canEdit: true,
    save: async (table: string, row: Record<string, unknown>, opts?: { quiet?: boolean; message?: string }) => {
      const next = upsert(latest.current, table, [row]);
      commit(next);
      if (!opts?.quiet) toast(opts?.message ?? 'Saved');
      const k = TABLE[table];
      const list = k ? (next[k] as unknown as Record<string, unknown>[]) : [];
      return (row.id ? list.find((x) => x.id === row.id) : list[list.length - 1]) ?? row;
    },
    saveMany: async (table: string, rows: Record<string, unknown>[], opts?: { quiet?: boolean; message?: string }) => {
      commit(upsert(latest.current, table, rows)); if (!opts?.quiet) toast(opts?.message ?? 'Saved'); return true;
    },
    remove: async (table: string, id: string, opts?: { quiet?: boolean; message?: string }) => {
      const k = TABLE[table]; if (!k) return false;
      const cur = latest.current;
      commit({ ...cur, [k]: (cur[k] as unknown as { id: string }[]).filter((x) => x.id !== id) });
      if (!opts?.quiet) toast(opts?.message ?? 'Deleted'); return true;
    },
    travel: new Map(), maps: { status: 'off', error: null, checking: false, offline: false }, ensureTravel: () => {}, online: true, demo: localMode(),
  } as unknown as StoreCtx;
  return <StoreContext.Provider value={ctx}>{children}</StoreContext.Provider>;
}

function defaults(table: string, r: Record<string, unknown>): Record<string, unknown> {
  if (table === 'events') return { all_day: false, status: 'planned', needs_confirmation: false, transport_mode: 'none', self_drive: false, prep_min: 0, remind_leave: true, exdates: [], checklist: [], person_ids: [], category: 'appointment', is_sample: false, ...r };
  if (table === 'tasks') return { status: 'open', priority: 2, checklist: [], source: 'user', kind: 'todo', is_sample: false, ...r };
  if (table === 'people') return { archived: false, sort: 0, color: '#6c8768', is_sample: false, ...r };
  if (table === 'notes') return { items: [], pinned: false, repeats_yearly: false, is_sample: false, ...r };
  if (table === 'vehicles' || table === 'drivers') return { available_days: null, is_sample: false, ...r };
  return r;
}

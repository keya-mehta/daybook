import { useMemo, useState } from 'react';
import { useStore, useToday, useData } from '../lib/store';
import { Chips, MultiChips, Q, Sheet, Banner, PERSON_COLORS } from '../ui/kit';
import { addDays, timeToMin, minToTime, localParts, zonedToUtc, weekdayOf, daysBetween } from '@engine/time.ts';
import { formatRule, parseRule } from '@engine/recurrence.ts';
import { suggestTasks } from '@engine/suggestions.ts';
import { parseSentence, type ParsedPlan, type Question } from '@engine/parser.ts';
import type { Category, CheckItem, EventRow, TaskRow, TransportMode } from '@engine/types.ts';
import { shortDay, timeLabel, longDate } from '../lib/format';
import { ISpark, ITalk, IPlus } from '../ui/icons';
import { toast } from '../lib/toast';
import { uid } from '../ui/kit';

type Repeat = 'none' | 'daily' | 'weekdays' | 'weekly' | 'biweekly' | 'monthly' | 'days';
interface Draft {
  title: string; category: Category; personIds: string[]; date: string; start: string | null; duration: number; allDay: boolean;
  location: string; transport: TransportMode; vehicleId: string | null; driverId: string | null | 'self'; pickupFrom: string | null;
  lead: number | null; repeat: Repeat; repeatDays: number[]; reminders: number[]; remindLeave: boolean;
  needsConfirmation: boolean; tentative: boolean; checklist: CheckItem[]; notes: string; prepMin: number;
  newTasks: { title: string; kind: TaskRow['kind']; source: TaskRow['source']; daysBefore: number; on: boolean }[];
}

const TITLES = ['Doctor', 'Dentist', 'School', 'Class', 'Tuition', 'Meeting', 'Puja', 'Lunch', 'Dinner', 'Shopping', 'Bank', 'Salon'];
const DURATIONS: [string, number][] = [['15 min', 15], ['30 min', 30], ['45 min', 45], ['1 hour', 60], ['1½ hours', 90], ['2 hours', 120], ['3 hours', 180], ['Half day', 240]];
const HOURS = Array.from({ length: 17 }, (_, i) => i + 6); // 6 AM – 10 PM
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOW_RR = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function guessCategory(t: string): Category {
  const s = t.toLowerCase();
  if (/doctor|dentist|clinic|hospital|test|scan|physio|eye/.test(s)) return 'medical';
  if (/school|ptm/.test(s)) return 'school';
  if (/class|tuition|lesson|coaching|practice/.test(s)) return 'class';
  if (/flight|train|trip|airport/.test(s)) return 'travel';
  if (/meeting|office/.test(s)) return 'work';
  if (/puja|lunch|dinner|party|wedding|visit|satsang/.test(s)) return 'social';
  return 'appointment';
}

export function AddPlan({ onClose, editId, date: initialDate, personId, editMode }: {
  onClose: () => void; editId?: string; date?: string; personId?: string; editMode?: 'series' | 'single';
}) {
  const { save, saveMany, data: d0, canEdit } = useStore();
  const data = useData();
  const { today, tz } = useToday();
  const existing = editId ? data.events.find((e) => e.id === editId) : undefined;
  const [mode, setMode] = useState<'tap' | 'type'>(existing ? 'tap' : 'tap');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => existing ? fromEvent(existing, tz, initialDate, editMode) : {
    title: '', category: 'appointment', personIds: personId ? [personId] : [], date: initialDate ?? today, start: null, duration: 60, allDay: false,
    location: '', transport: 'none', vehicleId: null, driverId: null, pickupFrom: null, lead: null, repeat: 'none', repeatDays: [],
    reminders: data.household.default_reminders, remindLeave: true, needsConfirmation: false, tentative: false, checklist: [], notes: '', prepMin: 0, newTasks: [],
  });
  const set = (p: Partial<Draft>) => setDraft((x) => ({ ...x, ...p }));

  // suggested prep tasks follow the title / transport
  const suggestions = useMemo(() => existing ? [] : suggestTasks({ title: draft.title, category: draft.category, transport_mode: draft.transport, vehicle_id: draft.vehicleId, needs_confirmation: draft.needsConfirmation }),
    [draft.title, draft.category, draft.transport, draft.vehicleId, draft.needsConfirmation, existing]);

  const people = data.people.filter((p) => !p.archived);
  const recentLocations = useMemo(() => {
    const seen = new Map<string, number>();
    for (const e of data.events) if (e.location) seen.set(e.location, (seen.get(e.location) ?? 0) + 1);
    const placeAddrs = new Set(data.places.map((p) => p.address.toLowerCase()));
    return [...seen].filter(([l]) => !placeAddrs.has(l.toLowerCase())).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([l]) => l);
  }, [data.events, data.places]);
  const checklists = d0?.notes.filter((n) => n.kind === 'checklist') ?? [];

  const startMin = draft.start ? timeToMin(draft.start) : null;
  const endLabel = startMin != null ? timeLabel(minToTime(startMin + draft.duration)) : null;
  const needsCar = ['drop', 'drop_pickup', 'wait'].includes(draft.transport);
  const valid = draft.title.trim() && draft.date && (draft.allDay || draft.start);

  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const startAt = draft.allDay ? zonedToUtc(draft.date, '00:00', tz) : zonedToUtc(draft.date, draft.start!, tz);
      const endAt = new Date(startAt.getTime() + (draft.allDay ? 1440 : draft.duration) * 60000);
      const wd = weekdayOf(draft.date);
      const rrule = draft.repeat === 'none' ? null : formatRule({
        freq: draft.repeat === 'daily' ? 'DAILY' : draft.repeat === 'monthly' ? 'MONTHLY' : 'WEEKLY',
        interval: draft.repeat === 'biweekly' ? 2 : 1,
        byday: draft.repeat === 'weekdays' ? [1, 2, 3, 4, 5] : draft.repeat === 'days' ? (draft.repeatDays.length ? draft.repeatDays : [wd]) : draft.repeat === 'weekly' || draft.repeat === 'biweekly' ? [wd] : undefined,
        until: existing && editMode === 'series' ? parseRule(existing.rrule)?.until : undefined,
      });
      const row: Partial<EventRow> = {
        title: draft.title.trim(), category: draft.category, person_ids: draft.personIds,
        start_at: startAt.toISOString(), end_at: endAt.toISOString(), all_day: draft.allDay,
        location: draft.location.trim() || null, status: draft.tentative ? 'tentative' : 'planned', needs_confirmation: draft.needsConfirmation,
        transport_mode: draft.transport, vehicle_id: needsCar ? draft.vehicleId : null,
        driver_id: needsCar && draft.driverId && draft.driverId !== 'self' ? draft.driverId : null, self_drive: needsCar && draft.driverId === 'self',
        pickup_from: needsCar ? draft.pickupFrom : null, leave_lead_min: needsCar ? draft.lead : null,
        reminder_offsets: draft.reminders, remind_leave: draft.remindLeave, rrule, checklist: draft.checklist, notes: draft.notes.trim() || null, prep_min: draft.prepMin,
      };
      let saved: EventRow | null;
      if (existing && editMode === 'single' && existing.rrule && initialDate) {
        // change just this occurrence: detach a copy and skip the date in the series
        saved = await save<EventRow>('events', { ...row, rrule: null, series_id: existing.id } as EventRow, { quiet: true });
        if (saved) await save('events', { id: existing.id, exdates: [...(existing.exdates ?? []), initialDate] }, { quiet: true });
      } else if (existing) {
        saved = await save<EventRow>('events', { ...row, id: existing.id } as EventRow, { quiet: true });
        // moved to another day → move its open prep tasks with it
        const oldDate = localParts(existing.start_at, tz).date;
        const delta = daysBetween(oldDate, draft.date);
        if (saved && delta && !existing.rrule) {
          const moved = data.tasks.filter((t) => t.event_id === existing.id && t.status !== 'done' && t.due_date).map((t) => ({ ...t, due_date: addDays(t.due_date!, delta) }));
          await saveMany('tasks', moved, { quiet: true });
        }
      } else {
        saved = await save<EventRow>('events', row as EventRow, { quiet: true });
      }
      if (!saved) return;
      const tasks = draft.newTasks.filter((t) => t.on).map((t) => ({
        id: uid(), title: t.title, kind: t.kind, source: t.source, event_id: saved!.id, person_id: draft.personIds[0] ?? null,
        due_date: addDays(draft.date, -t.daysBefore) < today ? today : addDays(draft.date, -t.daysBefore),
        occurrence_date: rrule ? draft.date : null, status: 'open', priority: 2,
      }));
      if (tasks.length) await saveMany('tasks', tasks, { quiet: true });
      toast(existing ? 'Plan updated' : `Added — ${draft.title.trim()}, ${longDate(draft.date, true)}`);
      onClose();
    } finally { setBusy(false); }
  }

  if (!canEdit) return <Sheet title="Add plan" onClose={onClose}><Banner kind="info">You can view plans but not change them. Ask the account owner for editing access.</Banner></Sheet>;

  return (
    <Sheet title={existing ? (editMode === 'single' ? 'Change this day only' : 'Edit plan') : 'New plan'} onClose={onClose}
      footer={mode === 'tap' ? <><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!valid || busy} onClick={submit}>{busy ? 'Saving…' : existing ? 'Save changes' : 'Save plan'}</button></> : undefined}>
      {!existing && (
        <div style={{ marginTop: 12 }} className="seg">
          <button className={mode === 'tap' ? 'on' : ''} onClick={() => setMode('tap')}>Tap to fill</button>
          <button className={mode === 'type' ? 'on' : ''} onClick={() => setMode('type')}><span className="row" style={{ justifyContent: 'center', gap: 6 }}>Type it</span></button>
        </div>
      )}

      {mode === 'type' ? (
        <TypeIt onUse={(p, opts) => {
          setDraft((x) => applyParsed(x, p, data.household.default_reminders));
          if (opts.save) setTimeout(() => setMode('tap'), 0);
          setMode('tap');
          toast('Filled in — check the details and save');
        }} />
      ) : (
        <>
          <Q label="Who is it for?" hint="tap one or more">
            <PeoplePicker value={draft.personIds} onChange={(v) => set({ personIds: v })} />
          </Q>

          <Q label="What is it?">
            <input className="input" value={draft.title} placeholder="e.g. Dentist, Dance class" onChange={(e) => set({ title: e.target.value, category: guessCategory(e.target.value) })} />
            <div className="chips scroll" style={{ marginTop: 8 }}>
              {TITLES.map((t) => <button key={t} type="button" className={`chip ${draft.title === t ? 'on' : ''}`} onClick={() => set({ title: t, category: guessCategory(t) })}>{t}</button>)}
            </div>
          </Q>

          <Q label="Which day?" hint={longDate(draft.date)}>
            <div className="chips scroll">
              {[0, 1, 2, 3, 4, 5, 6].map((n) => {
                const dd = addDays(today, n);
                return <button key={dd} type="button" className={`chip ${draft.date === dd ? 'on' : ''}`} onClick={() => set({ date: dd })}>{n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : shortDay(dd)}</button>;
              })}
              <label className={`chip dashed ${draft.date > addDays(today, 6) || draft.date < today ? 'on' : ''}`} style={{ position: 'relative' }}>
                Other date
                <input type="date" value={draft.date} onChange={(e) => e.target.value && set({ date: e.target.value })} style={{ position: 'absolute', inset: 0, opacity: 0 }} aria-label="Pick a date" />
              </label>
            </div>
          </Q>

          <Q label="What time?" hint={draft.allDay ? 'All day' : draft.start ? `${timeLabel(draft.start)} – ${endLabel}` : 'tap the hour, then the minutes'}>
            <div className="chips scroll">
              <button type="button" className={`chip ${draft.allDay ? 'on' : ''}`} onClick={() => set({ allDay: !draft.allDay })}>All day</button>
              {!draft.allDay && HOURS.map((h) => {
                const on = startMin != null && Math.floor(startMin / 60) === h;
                return <button key={h} type="button" className={`chip ${on ? 'on' : ''}`} onClick={() => set({ start: minToTime(h * 60 + (startMin != null ? startMin % 60 : 0)) })}>
                  {h % 12 === 0 ? 12 : h % 12} {h < 12 ? 'AM' : 'PM'}
                </button>;
              })}
            </div>
            {!draft.allDay && (
              <div className="row wrap" style={{ marginTop: 8, gap: 8 }}>
                <Chips options={[0, 15, 30, 45].map((m) => ({ label: `:${String(m).padStart(2, '0')}`, value: String(m) }))}
                  value={startMin != null ? String(startMin % 60) : null}
                  onChange={(m) => set({ start: minToTime(Math.floor((startMin ?? 9 * 60) / 60) * 60 + +m) })} />
                <label className="chip dashed" style={{ position: 'relative' }}>Exact time
                  <input type="time" value={draft.start ?? ''} onChange={(e) => e.target.value && set({ start: e.target.value })} style={{ position: 'absolute', inset: 0, opacity: 0 }} aria-label="Exact time" />
                </label>
              </div>
            )}
          </Q>

          {!draft.allDay && (
            <Q label="How long?">
              <Chips scroll options={DURATIONS.map(([l, v]) => ({ label: l, value: String(v) }))} value={String(draft.duration)} onChange={(v) => set({ duration: +v })} />
            </Q>
          )}

          <Q label="Where?">
            <div className="chips scroll" style={{ marginBottom: 8 }}>
              {data.places.map((p) => <button key={p.id} type="button" className={`chip ${draft.location === p.address ? 'on' : ''}`} onClick={() => set({ location: p.address })}>{p.name}</button>)}
              {recentLocations.map((l) => <button key={l} type="button" className={`chip ${draft.location === l ? 'on' : ''}`} onClick={() => set({ location: l })}>{l.split(',')[0]}</button>)}
              <button type="button" className={`chip ${draft.location === '' ? 'on' : ''}`} onClick={() => set({ location: '' })}>At home / no place</button>
            </div>
            <input className="input" value={draft.location} placeholder="Address or area, e.g. Hill Road, Bandra" onChange={(e) => set({ location: e.target.value })} />
          </Q>

          <Q label="Does the car need to go?">
            <Chips options={[
              { label: 'No car', value: 'none' }, { label: 'Drop & wait', value: 'wait' }, { label: 'Drop only', value: 'drop' },
              { label: 'Drop & pick up later', value: 'drop_pickup' }, { label: 'Goes on their own', value: 'self' },
            ]} value={draft.transport} onChange={(v) => set({ transport: v as TransportMode })} />
          </Q>

          {needsCar && (
            <>
              <Q label="Which car?">
                {data.vehicles.length ? (
                  <Chips options={[...data.vehicles.map((v) => ({ label: v.name, value: v.id })), { label: 'Not decided', value: '' }]}
                    value={draft.vehicleId ?? ''} onChange={(v) => {
                      const veh = data.vehicles.find((x) => x.id === v);
                      set({ vehicleId: v || null, driverId: draft.driverId ?? veh?.default_driver_id ?? null });
                    }} />
                ) : <Banner kind="info">No cars added yet — add them under More → Cars &amp; drivers. The plan will show "car not arranged" until one is chosen.</Banner>}
              </Q>
              {draft.vehicleId && (
                <Q label="Who drives?">
                  <Chips options={[...data.drivers.map((d) => ({ label: d.name, value: d.id })), { label: "I'll drive", value: 'self' }, { label: 'Not decided', value: '' }]}
                    value={draft.driverId ?? ''} onChange={(v) => set({ driverId: v || null })} />
                </Q>
              )}
              <Q label="Pick up from">
                <div className="chips">
                  <button type="button" className={`chip ${draft.pickupFrom == null ? 'on' : ''}`} onClick={() => set({ pickupFrom: null })}>{data.household.home_label || 'Home'}</button>
                  {data.places.slice(0, 4).map((p) => <button key={p.id} type="button" className={`chip ${draft.pickupFrom === p.address ? 'on' : ''}`} onClick={() => set({ pickupFrom: p.address })}>{p.name}</button>)}
                  <button type="button" className={`chip dashed ${draft.pickupFrom != null && !data.places.some((p) => p.address === draft.pickupFrom) ? 'on' : ''}`}
                    onClick={() => { const v = prompt('Pick up from (address)'); if (v?.trim()) set({ pickupFrom: v.trim() }); }}>Somewhere else…</button>
                </div>
              </Q>
              <Q label="When should the car leave?" hint={draft.lead != null && startMin != null ? `leave at ${timeLabel(minToTime(startMin - draft.lead))}` : ''}>
                <Chips options={[
                  { label: 'Work it out for me', value: 'auto' }, { label: '30 min before', value: '30' }, { label: '45 min before', value: '45' },
                  { label: '1 hour before', value: '60' }, { label: '1½ hours before', value: '90' },
                ]} value={draft.lead == null ? 'auto' : String(draft.lead)} onChange={(v) => set({ lead: v === 'auto' ? null : +v })} />
                {draft.lead == null && <p className="small muted" style={{ margin: '6px 0 0' }}>Uses Google Maps traffic plus your {data.household.traffic_buffer_min}-minute buffer.</p>}
              </Q>
            </>
          )}

          <Q label="Does it repeat?">
            <Chips options={[
              { label: 'Just once', value: 'none' }, { label: 'Every day', value: 'daily' }, { label: 'Weekdays', value: 'weekdays' },
              { label: `Every ${DOW[weekdayOf(draft.date)]}`, value: 'weekly' }, { label: 'Every 2 weeks', value: 'biweekly' },
              { label: 'Every month', value: 'monthly' }, { label: 'Some days…', value: 'days' },
            ]} value={draft.repeat} onChange={(v) => set({ repeat: v as Repeat })} />
            {draft.repeat === 'days' && (
              <div style={{ marginTop: 8 }}>
                <MultiChips options={DOW.map((l, i) => ({ label: l, value: String(i) }))} value={draft.repeatDays.map(String)} onChange={(v) => set({ repeatDays: v.map(Number).sort() })} />
              </div>
            )}
          </Q>

          <Q label="Remind me">
            <MultiChips options={[
              { label: '1 day before', value: '1440' }, { label: '3 hours before', value: '180' }, { label: '1 hour before', value: '60' },
              { label: '30 min before', value: '30' }, { label: 'At start', value: '0' },
            ]} value={draft.reminders.map(String)} onChange={(v) => set({ reminders: v.map(Number) })} />
            {needsCar && (
              <label className="check" style={{ marginTop: 4 }}>
                <input type="checkbox" checked={draft.remindLeave} onChange={(e) => set({ remindLeave: e.target.checked })} />
                <span>Also remind me {data.household.leave_reminder_min} min before it's time to leave</span>
              </label>
            )}
          </Q>

          <Q label="To do beforehand / things to carry">
            <div className="chips">
              {suggestions.filter((s) => !draft.newTasks.some((t) => t.title === s.title)).map((s) => (
                <button key={s.title} type="button" className="chip dashed" onClick={() => set({ newTasks: [...draft.newTasks, { ...s, source: 'suggested', on: true }] })}>
                  <IPlus />{s.title}
                </button>
              ))}
              {checklists.map((c) => (
                <button key={c.id} type="button" className="chip dashed" onClick={() => set({ checklist: [...draft.checklist, ...c.items.filter((i) => !draft.checklist.some((x) => x.text === i.text)).map((i) => ({ id: uid(), text: i.text, done: false }))] })}>
                  <IPlus />Use “{c.title}” list
                </button>
              ))}
            </div>
            {draft.newTasks.length > 0 && (
              <div style={{ marginTop: 10 }}>
                {draft.newTasks.map((t, i) => (
                  <label key={i} className="check">
                    <input type="checkbox" checked={t.on} onChange={(e) => set({ newTasks: draft.newTasks.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)) })} />
                    <span className="grow">{t.title} {t.source === 'suggested' && <span className="tag sage">Suggested</span>} <span className="muted small">{t.daysBefore ? `${t.daysBefore} day before` : 'same day'}</span></span>
                  </label>
                ))}
              </div>
            )}
            <ItemsEditor items={draft.checklist} onChange={(c) => set({ checklist: c })} placeholder="Add something to carry…" />
            <AddTaskLine onAdd={(title) => set({ newTasks: [...draft.newTasks, { title, kind: /^call/i.test(title) ? 'call' : 'todo', source: 'user', daysBefore: 0, on: true }] })} />
          </Q>

          <Q label="Anything else?">
            <div className="chips">
              <button type="button" className={`chip ${draft.needsConfirmation ? 'on' : ''}`} onClick={() => set({ needsConfirmation: !draft.needsConfirmation })}>Still needs confirming</button>
              <button type="button" className={`chip ${draft.tentative ? 'on' : ''}`} onClick={() => set({ tentative: !draft.tentative })}>Tentative</button>
              {[0, 15, 30, 60].map((m) => (
                <button key={m} type="button" className={`chip ${draft.prepMin === m ? 'on' : ''}`} onClick={() => set({ prepMin: m })}>{m ? `${m} min to get ready` : 'No prep time'}</button>
              ))}
            </div>
            <textarea className="input" style={{ marginTop: 10 }} placeholder="Notes (optional)" value={draft.notes} onChange={(e) => set({ notes: e.target.value })} />
          </Q>
          {!valid && <p className="small muted" style={{ marginTop: 16 }}>Fill in what it is, the day and the time to save.</p>}
        </>
      )}
    </Sheet>
  );
}

function fromEvent(e: EventRow, tz: string, occDate?: string, editMode?: string): Draft {
  const s = localParts(e.start_at, tz);
  const r = parseRule(e.rrule);
  let repeat: Repeat = 'none';
  if (r && editMode !== 'single') {
    const days = r.byday ?? [];
    if (r.freq === 'DAILY') repeat = 'daily';
    else if (r.freq === 'MONTHLY') repeat = 'monthly';
    else if (days.join() === '1,2,3,4,5') repeat = 'weekdays';
    else if (days.length <= 1) repeat = r.interval === 2 ? 'biweekly' : 'weekly';
    else repeat = 'days';
  }
  return {
    title: e.title, category: e.category, personIds: e.person_ids, date: editMode === 'single' && occDate ? occDate : s.date, start: e.all_day ? null : s.time,
    duration: Math.max(5, Math.round((Date.parse(e.end_at) - Date.parse(e.start_at)) / 60000)), allDay: e.all_day,
    location: e.location ?? '', transport: e.transport_mode, vehicleId: e.vehicle_id, driverId: e.self_drive ? 'self' : e.driver_id, pickupFrom: e.pickup_from,
    lead: e.leave_lead_min, repeat, repeatDays: r?.byday ?? [], reminders: e.reminder_offsets ?? [1440, 60], remindLeave: e.remind_leave,
    needsConfirmation: e.needs_confirmation, tentative: e.status === 'tentative', checklist: e.checklist ?? [], notes: e.notes ?? '', prepMin: e.prep_min, newTasks: [],
  };
}

function applyParsed(x: Draft, p: ParsedPlan & { answers?: Record<string, string> }, defReminders: number[]): Draft {
  const start = p.start;
  const duration = p.durationMin ?? (start && p.end ? Math.max(5, timeToMin(p.end) - timeToMin(start)) : x.duration);
  const lead = p.leaveAt && start ? Math.max(0, timeToMin(start) - timeToMin(p.leaveAt)) : null;
  return {
    ...x,
    title: p.title ?? x.title, category: p.category, personIds: p.personIds.length ? p.personIds : x.personIds,
    date: p.date ?? x.date, start: start ?? x.start, duration, location: p.location ?? x.location,
    transport: p.transport ?? x.transport, lead, needsConfirmation: p.needsConfirmation, reminders: x.reminders.length ? x.reminders : defReminders,
    newTasks: [...x.newTasks, ...p.tasks.map((t) => ({ title: t.title, kind: t.kind, source: 'sentence' as const, daysBefore: 0, on: true }))],
  };
}

// ---------------------------------------------------------------------------
function TypeIt({ onUse }: { onUse: (p: ParsedPlan, opts: { save?: boolean }) => void }) {
  const data = useData();
  const { now, tz } = useToday();
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<ParsedPlan | null>(null);
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const people = data.people;
  const read = () => {
    const p = parseSentence(text, { now, tz, people: people.map((x) => ({ id: x.id, name: x.name, relation: x.relation })), places: data.places });
    setParsed(p); setAnswers({});
  };
  const open = parsed?.questions.filter((q) => !(q.field in answers)) ?? [];
  const final = (): ParsedPlan | null => {
    if (!parsed) return null;
    const a = answers;
    const p = { ...parsed };
    for (const q of parsed.questions) {
      const v = a[q.field];
      if (v == null) continue;
      if (q.field === 'person') p.personIds = v as string[];
      if (q.field === 'date') p.date = v as string;
      if (q.field === 'start' || q.field === 'ampm') p.start = v as string;
      if (q.field === 'end_ampm') p.end = v as string;
      if (q.field === 'leave_ampm') p.leaveAt = v as string;
      if (q.field === 'transport') p.transport = v as TransportMode;
      if (q.field === 'title') p.title = v as string;
      if (q.field === 'duration') p.durationMin = +v;
    }
    return p;
  };
  const f = final();
  const who = f?.personIds.map((id) => people.find((x) => x.id === id)?.name).filter(Boolean).join(', ');
  return (
    <div>
      <Q label="Type it the way you'd say it">
        <textarea className="input" rows={4} value={text} onChange={(e) => setText(e.target.value)}
          placeholder="Tomorrow, take Dad to his dentist at 11 am in Bandra. The car needs to leave at 10:15. Remind me to carry his reports and call the clinic before leaving." />
        <button className="btn primary block" style={{ marginTop: 10 }} disabled={text.trim().length < 4} onClick={read}><ISpark /> Read it</button>
        <p className="tiny muted" style={{ marginTop: 6 }}>Read on your phone — nothing is guessed. Anything unclear becomes a quick question.</p>
      </Q>
      {f && (
        <>
          <div className="section-title" style={{ marginTop: 22 }}>What I understood</div>
          <dl style={{ margin: 0 }}>
            <Line k="What" v={f.title} />
            <Line k="Who" v={who} />
            <Line k="Day" v={f.date ? longDate(f.date) : null} />
            <Line k="Time" v={f.start ? `${timeLabel(f.start)}${f.end ? ' – ' + timeLabel(f.end) : f.durationMin ? ` · ${f.durationMin} min` : ''}` : null} />
            <Line k="Where" v={f.location} />
            <Line k="Car" v={f.transport ? ({ none: 'No car', wait: 'Drop & wait', drop: 'Drop only', drop_pickup: 'Drop & pick up', self: 'On their own' } as Record<string, string>)[f.transport] : null} />
            <Line k="Car leaves" v={f.leaveAt ? timeLabel(f.leaveAt) : null} />
            <Line k="To do" v={f.tasks.length ? f.tasks.map((t) => t.title).join(' · ') : null} />
          </dl>
          {open.map((q) => <QuestionView key={q.field} q={q} onAnswer={(v) => setAnswers((a) => ({ ...a, [q.field]: v }))} />)}
          <button className="btn primary block" style={{ marginTop: 16 }} disabled={open.some((q) => ['title', 'date', 'start', 'ampm'].includes(q.field))} onClick={() => onUse(f, {})}>
            Looks right — continue
          </button>
          {open.some((q) => ['title', 'date', 'start', 'ampm'].includes(q.field)) && <p className="tiny muted" style={{ textAlign: 'center' }}>Answer the questions above first</p>}
        </>
      )}
    </div>
  );
}
function Line({ k, v }: { k: string; v: string | null | undefined }) {
  return <div className="summary-line"><dt>{k}</dt><dd>{v || <span className="muted">—</span>}</dd></div>;
}
function QuestionView({ q, onAnswer }: { q: Question; onAnswer: (v: string | string[]) => void }) {
  const [multi, setMulti] = useState<string[]>([]);
  const [free, setFree] = useState('');
  return (
    <div className="pill-q">
      <div className="q-label">{q.prompt}</div>
      {q.multi ? (
        <>
          <MultiChips options={q.options} value={multi} onChange={setMulti} />
          <button className="btn" style={{ marginTop: 8 }} disabled={!multi.length} onClick={() => onAnswer(multi)}>Done</button>
        </>
      ) : <Chips options={q.options} value={null} onChange={(v) => onAnswer(v)} />}
      {q.freeText && (
        <div className="row" style={{ marginTop: 8 }}>
          <input className="input" value={free} onChange={(e) => setFree(e.target.value)} placeholder="Or type it" />
          <button className="btn" disabled={!free.trim()} onClick={() => onAnswer(free.trim())}>OK</button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
export function PeoplePicker({ value, onChange, single }: { value: string[]; onChange: (v: string[]) => void; single?: boolean }) {
  const { save } = useStore();
  const data = useData();
  const people = data.people.filter((p) => !p.archived);
  return (
    <div className="chips">
      {people.map((p) => {
        const on = value.includes(p.id);
        return <button key={p.id} type="button" className={`chip ${on ? 'on' : ''}`} onClick={() => onChange(single ? [p.id] : on ? value.filter((v) => v !== p.id) : [...value, p.id])}>
          <span className="dot" style={{ background: p.color }} />{p.name}{p.relation && p.relation !== p.name ? <span className="muted small">{p.relation}</span> : null}
        </button>;
      })}
      <button type="button" className="chip dashed" onClick={async () => {
        const name = prompt('Name of the new person');
        if (!name?.trim()) return;
        const p = await save('people', { name: name.trim(), color: PERSON_COLORS[people.length % PERSON_COLORS.length], sort: people.length }, { message: `${name.trim()} added` });
        if (p?.id) onChange(single ? [p.id] : [...value, p.id]);
      }}><IPlus />New person</button>
    </div>
  );
}

export function ItemsEditor({ items, onChange, placeholder }: { items: CheckItem[]; onChange: (i: CheckItem[]) => void; placeholder: string }) {
  const [t, setT] = useState('');
  const add = () => { if (t.trim()) { onChange([...items, { id: uid(), text: t.trim(), done: false }]); setT(''); } };
  return (
    <div style={{ marginTop: 8 }}>
      {items.map((i) => (
        <div key={i.id} className="row" style={{ minHeight: 40 }}>
          <label className="check grow"><input type="checkbox" checked={i.done} onChange={(e) => onChange(items.map((x) => (x.id === i.id ? { ...x, done: e.target.checked } : x)))} /><span>{i.text}</span></label>
          <button type="button" className="iconbtn" aria-label={`Remove ${i.text}`} onClick={() => onChange(items.filter((x) => x.id !== i.id))}>×</button>
        </div>
      ))}
      <div className="row"><input className="input" value={t} placeholder={placeholder} onChange={(e) => setT(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())} /><button type="button" className="btn" onClick={add} disabled={!t.trim()}>Add</button></div>
    </div>
  );
}
function AddTaskLine({ onAdd }: { onAdd: (t: string) => void }) {
  const [t, setT] = useState('');
  return (
    <div className="row" style={{ marginTop: 8 }}>
      <input className="input" value={t} placeholder="Add a to-do, e.g. Call the clinic" onChange={(e) => setT(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && t.trim()) { e.preventDefault(); onAdd(t.trim()); setT(''); } }} />
      <button type="button" className="btn" disabled={!t.trim()} onClick={() => { onAdd(t.trim()); setT(''); }}><ITalk />Add</button>
    </div>
  );
}

import { useState } from 'react';
import { useStore, useData, usePlan, useToday } from '../lib/store';
import { Sheet, Banner, Avatar, Chips, uid } from '../ui/kit';
import { travelNote, MODE_LABEL } from '../ui/PlanItemView';
import { fmtTime, longDate, timeLabel } from '../lib/format';
import { addDays, localParts, zonedToUtc } from '@engine/time.ts';
import { describeRule } from '@engine/recurrence.ts';
import { IAlert, ICar, IClock, IPin, IEdit, ICopy, ITrash, IBell, IRepeat, ICheck } from '../ui/icons';
import type { EventRow } from '@engine/types.ts';
import { TaskRowView } from './Tasks';
import { AddPlan, ItemsEditor } from './AddPlan';
import { toast } from '../lib/toast';

export function EventSheet({ id, date, onClose }: { id: string; date: string; onClose: () => void }) {
  const { save, remove, canEdit } = useStore();
  const data = useData();
  const { now, tz, today } = useToday();
  const plan = usePlan(date, date);
  const [edit, setEdit] = useState<null | 'ask' | 'series' | 'single'>(null);
  const [resched, setResched] = useState(false);
  const ev = data.events.find((e) => e.id === id);
  if (!ev) return <Sheet title="Plan" onClose={onClose}><Banner kind="info">This plan was deleted or you don't have access to it.</Banner></Sheet>;
  const it = plan.days[0]?.items.find((i) => i.occ.event.id === id);
  const recurring = !!ev.rrule;
  const tasks = data.tasks.filter((t) => t.event_id === id && (!t.occurrence_date || t.occurrence_date === date));
  const reminders = data.reminders.filter((r) => r.ref_type === 'event' && r.ref_id === id && r.occurrence_date === date);
  const start = it?.occ.start ?? new Date(ev.start_at), end = it?.occ.end ?? new Date(ev.end_at);

  if (edit === 'series' || edit === 'single') return <AddPlan editId={id} date={date} editMode={edit} onClose={() => { setEdit(null); }} />;

  // detach this occurrence (for single-day changes to a repeating plan)
  async function detach(patch: Partial<EventRow>) {
    const copy = { ...ev!, ...patch } as Partial<EventRow>;
    delete copy.id; delete copy.updated_at; delete copy.gcal_event_id;
    const s = localParts(ev!.start_at, tz).time;
    const startAt = patch.start_at ?? zonedToUtc(date, s, tz).toISOString();
    const len = Date.parse(ev!.end_at) - Date.parse(ev!.start_at);
    const made = await save<EventRow>('events', { ...copy, start_at: startAt, end_at: patch.end_at ?? new Date(Date.parse(startAt) + len).toISOString(), rrule: null, exdates: [], series_id: ev!.id } as EventRow, { quiet: true });
    if (made) await save('events', { id: ev!.id, exdates: [...(ev!.exdates ?? []), date] }, { quiet: true });
    return made;
  }
  async function cancel(scope: 'single' | 'series') {
    if (scope === 'series' || !recurring) await save('events', { id, status: 'cancelled' }, { message: 'Marked as cancelled' });
    else { await detach({ status: 'cancelled' }); toast('Cancelled for this day'); }
  }
  async function restore() { await save('events', { id, status: 'planned' }, { message: 'Restored' }); }
  async function del(scope: 'single' | 'series') {
    if (scope === 'single' && recurring) { await save('events', { id, exdates: [...(ev!.exdates ?? []), date] }, { message: 'Removed for this day' }); onClose(); return; }
    if (!confirm(recurring ? `Delete every "${ev!.title}"?` : `Delete "${ev!.title}"?`)) return;
    const snapshot = { ...ev! };
    if (await remove('events', id, { quiet: true })) {
      toast('Deleted', 'ok', { label: 'Undo', run: () => { const { updated_at: _u, gcal_event_id: _g, ...rest } = snapshot; save('events', { ...rest, id: undefined, gcal_event_id: null } as unknown as EventRow, { message: 'Restored' }); } });
      onClose();
    }
  }
  async function duplicate() {
    const { id: _i, updated_at: _u, gcal_event_id: _g, ...rest } = ev!;
    const s = localParts(start, tz).time;
    const startAt = zonedToUtc(addDays(date, 7), s, tz);
    const made = await save<EventRow>('events', { ...rest, start_at: startAt.toISOString(), end_at: new Date(startAt.getTime() + (end.getTime() - start.getTime())).toISOString(), rrule: null, exdates: [], series_id: null, status: 'planned' }, { message: `Copied to ${longDate(addDays(date, 7), true)}` });
    if (made) onClose();
  }
  async function moveTo(newDate: string, newTime: string) {
    const startAt = zonedToUtc(newDate, newTime, tz);
    const endAt = new Date(startAt.getTime() + (end.getTime() - start.getTime()));
    if (recurring) await detach({ start_at: startAt.toISOString(), end_at: endAt.toISOString() });
    else await save('events', { id, start_at: startAt.toISOString(), end_at: endAt.toISOString() }, { quiet: true });
    // move its open prep tasks by the same number of days
    const delta = Math.round((Date.parse(newDate) - Date.parse(date)) / 86400000);
    if (delta) for (const t of tasks.filter((t) => t.status !== 'done' && t.due_date)) await save('tasks', { id: t.id, due_date: addDays(t.due_date!, delta) }, { quiet: true });
    toast(`Moved to ${longDate(newDate, true)}, ${timeLabel(newTime)}`);
    setResched(false);
    onClose();
  }
  async function applySuggestion(s: string) {
    const v = data.vehicles.find((x) => s.startsWith(`Assign ${x.name}`) || s.startsWith(`Send ${x.name}`));
    if (!v) return;
    if (recurring) { await detach({ vehicle_id: v.id, driver_id: v.default_driver_id }); toast(`${v.name} assigned for this day`); }
    else await save('events', { id, vehicle_id: v.id, driver_id: ev!.driver_id ?? v.default_driver_id }, { message: `${v.name} assigned` });
  }

  const issues = it?.issues ?? [];
  return (
    <Sheet title={ev.title} onClose={onClose}
      footer={canEdit ? <>
        <button className="btn" onClick={() => setResched(true)}><IClock />Move</button>
        <button className="btn primary" onClick={() => setEdit(recurring ? 'ask' : 'series')}><IEdit />Edit</button>
      </> : undefined}>
      <div style={{ marginTop: 14 }}>
        <div className="serif" style={{ fontSize: 20 }}>{longDate(date)}</div>
        <div className="ink2">{ev.all_day ? 'All day' : `${fmtTime(start, tz)} – ${fmtTime(end, tz)}`}{recurring && <> · <IRepeat className="" /> {describeRule(ev.rrule)}</>}</div>
        <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
          {ev.status === 'cancelled' && <span className="tag clay">Cancelled</span>}
          {ev.status === 'tentative' && <span className="tag amber">Tentative</span>}
          {ev.needs_confirmation && <span className="tag amber">Needs confirming</span>}
          {ev.series_id && <span className="tag">Changed from a repeating plan</span>}
          {ev.is_sample && <span className="tag">Sample</span>}
        </div>
      </div>

      {edit === 'ask' && (
        <div className="pill-q">
          <div className="q-label">This plan repeats. What do you want to change?</div>
          <Chips options={[{ label: `Just ${longDate(date, true)}`, value: 'single' }, { label: 'Every time', value: 'series' }]} value={null} onChange={(v) => setEdit(v as 'single' | 'series')} />
        </div>
      )}
      {resched && <Reschedule date={date} time={localParts(start, tz).time} today={today} onPick={moveTo} onCancel={() => setResched(false)} />}

      {issues.length > 0 && (
        <div className="section">
          {issues.map((i) => (
            <div key={i.id} className={`att ${i.severity === 'conflict' ? 'urgent' : ''}`}>
              <span className="mark" />
              <div className="grow">
                <div>{i.message}</div>
                {i.suggestions.length > 0 && (
                  <div className="chips" style={{ marginTop: 6 }}>
                    {i.suggestions.map((s) => /^(Assign|Send) /.test(s) && canEdit
                      ? <button key={s} className="chip" onClick={() => applySuggestion(s)}>{s}</button>
                      : <span key={s} className="small muted" style={{ display: 'block' }}>· {s}</span>)}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <dl className="kv section">
        <dt>Who</dt>
        <dd>{it?.people.length ? <span className="row wrap" style={{ gap: 6 }}>{it.people.map((p) => <span key={p.id} className="row" style={{ gap: 6 }}><Avatar p={p} size="sm" />{p.name}</span>)}</span> : <span className="muted">No one set</span>}</dd>
        <dt>Where</dt><dd>{ev.location || <span className="muted">Not set</span>}</dd>
        {ev.notes && <><dt>Notes</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{ev.notes}</dd></>}
      </dl>

      {ev.transport_mode !== 'none' && (
        <div className="section">
          <div className="section-title">Transport</div>
          {it?.needsTransport ? (
            <div className="facts" style={{ marginTop: 10, display: 'grid', gap: 6 }}>
              <div className="fact"><IClock /><span>{it.leaveAt ? <>Leave <b>{fmtTime(it.leaveAt, tz)}</b>{ev.leave_lead_min != null ? ' (time you set)' : ''}</> : 'Leave time not known yet'}</span></div>
              <div className="fact"><ICar /><span>{travelNote(it)}{it.travelSource === 'google_traffic' && <span className="est"> · includes {data.household.traffic_buffer_min} min buffer</span>}</span></div>
              <div className={`fact ${it.vehicle ? '' : 'bad'}`}><ICar /><span>{it.vehicle ? <><b>{it.vehicle.name}</b> · {it.selfDrive ? 'you drive' : it.driver?.name ?? 'driver not set'}</> : 'No car arranged'} · {MODE_LABEL[ev.transport_mode]}</span></div>
              {it.legs.length > 0 && (
                <ul className="legs">
                  {it.legs.map((l, i) => (
                    <li key={i}>
                      {l.kind === 'outbound' ? 'Leave' : l.kind === 'pickup' ? 'Pick up from' : 'Come back from'} {l.from} {l.departAt ? `at ${fmtTime(l.departAt, tz)}` : ''} → {l.to}
                      {l.arriveAt ? `, arrive ~${fmtTime(l.arriveAt, tz)}` : ''}
                      {l.travel.source === 'fallback' && <span className="est"> (rough)</span>}
                    </li>
                  ))}
                </ul>
              )}
              {it.nextForCar && <div className="fact"><IPin /><span>{it.nextForCar}</span></div>}
            </div>
          ) : <p className="ink2">{MODE_LABEL[ev.transport_mode]}</p>}
        </div>
      )}

      <div className="section">
        <div className="section-title">Before you go</div>
        {tasks.length === 0 && ev.checklist.length === 0 && <p className="muted small">Nothing to prepare.</p>}
        {tasks.map((t) => <TaskRowView key={t.id} t={t} hideEvent />)}
        {canEdit && <ItemsEditor items={ev.checklist ?? []} placeholder="Add something to carry…" onChange={(c) => save('events', { id, checklist: c }, { quiet: true })} />}
        {canEdit && <AddPrepTask onAdd={(title) => save('tasks', { id: uid(), title, event_id: id, occurrence_date: recurring ? date : null, due_date: date < today ? today : date, person_id: ev.person_ids[0] ?? null, kind: /^call/i.test(title) ? 'call' : 'todo' }, { message: 'To-do added' })} />}
      </div>

      <div className="section">
        <div className="section-title">Reminders</div>
        {reminders.length === 0 && <p className="muted small">{ev.status === 'cancelled' ? 'None — this plan is cancelled.' : 'Reminders are set up automatically after saving; they appear here within a few seconds.'}</p>}
        {reminders.map((r) => (
          <div key={r.id} className="row" style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
            <IBell className="" />
            <div className="grow"><div>{r.title}</div><div className="small muted">{longDate(localParts(r.fire_at, tz).date, true)}, {fmtTime(r.fire_at, tz)} · {r.status === 'pending' ? 'scheduled' : r.status}</div></div>
          </div>
        ))}
      </div>

      {canEdit && (
        <div className="section">
          <div className="section-title">More</div>
          <div className="chips" style={{ marginTop: 10 }}>
            {ev.needs_confirmation && <button className="chip" onClick={() => save('events', { id, needs_confirmation: false }, { message: 'Marked confirmed' })}><ICheck />Mark confirmed</button>}
            <button className="chip" onClick={duplicate}><ICopy />Copy to next week</button>
            {ev.status === 'cancelled'
              ? <button className="chip" onClick={restore}>Restore</button>
              : recurring
                ? <><button className="chip" onClick={() => cancel('single')}>Cancel this day</button><button className="chip" onClick={() => cancel('series')}>Cancel all</button></>
                : <button className="chip" onClick={() => cancel('single')}>Mark cancelled</button>}
            {recurring && <button className="chip" onClick={() => del('single')}>Remove this day</button>}
            <button className="chip" style={{ color: 'var(--clay)' }} onClick={() => del('series')}><ITrash />Delete{recurring ? ' all' : ''}</button>
          </div>
        </div>
      )}
      {!canEdit && <Banner kind="info">You can see this plan but not change it.</Banner>}
      {plan.maps.status === 'off' && it?.needsTransport && <Banner kind="info">Google Maps isn't connected, so travel times aren't from live maps.</Banner>}
    </Sheet>
  );
}

function AddPrepTask({ onAdd }: { onAdd: (t: string) => void }) {
  const [t, setT] = useState('');
  return (
    <div className="row" style={{ marginTop: 8 }}>
      <input className="input" value={t} placeholder="Add a to-do for this…" onChange={(e) => setT(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && t.trim()) { onAdd(t.trim()); setT(''); } }} />
      <button className="btn" disabled={!t.trim()} onClick={() => { onAdd(t.trim()); setT(''); }}>Add</button>
    </div>
  );
}

function Reschedule({ date, time, today, onPick, onCancel }: { date: string; time: string; today: string; onPick: (d: string, t: string) => void; onCancel: () => void }) {
  const [d, setD] = useState(date);
  const [t, setT] = useState(time);
  const shift = (min: number) => { const [h, m] = t.split(':').map(Number); const x = Math.min(23 * 60 + 45, Math.max(0, h * 60 + m + min)); setT(`${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`); };
  return (
    <div className="pill-q">
      <div className="q-label">Move to…</div>
      <div className="chips">
        {[['Today', today], ['Tomorrow', addDays(today, 1)], ['Day after', addDays(date, 1)], ['Next week', addDays(date, 7)]].map(([l, v]) => (
          <button key={l} className={`chip ${d === v ? 'on' : ''}`} onClick={() => setD(v)}>{l}</button>
        ))}
        <label className="chip dashed" style={{ position: 'relative' }}>{longDate(d, true)}<input type="date" value={d} onChange={(e) => e.target.value && setD(e.target.value)} style={{ position: 'absolute', inset: 0, opacity: 0 }} /></label>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <div className="stepper"><button onClick={() => shift(-30)}>−30</button><span>{timeLabel(t)}</span><button onClick={() => shift(30)}>+30</button></div>
        <label className="chip dashed" style={{ position: 'relative' }}>Exact<input type="time" value={t} onChange={(e) => e.target.value && setT(e.target.value)} style={{ position: 'absolute', inset: 0, opacity: 0 }} /></label>
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn primary grow" disabled={d === date && t === time} onClick={() => onPick(d, t)}>Move</button>
      </div>
    </div>
  );
}

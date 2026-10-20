import { useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useStore, useData, useToday } from '../lib/store';
import { Chips, MultiChips, Q, Sheet, Empty, uid } from '../ui/kit';
import { ICheck, IPlus } from '../ui/icons';
import { addDays, weekdayOf } from '@engine/time.ts';
import { formatRule, nextOccurrence, describeRule } from '@engine/recurrence.ts';
import type { TaskRow } from '@engine/types.ts';
import { dayLabel, longDate, timeLabel } from '../lib/format';
import { ItemsEditor, PeoplePicker } from './AddPlan';
import { openEvent } from '../ui/PlanItemView';
import { toast } from '../lib/toast';

export function useCompleteTask() {
  const { save } = useStore();
  const { today } = useToday();
  return async (t: TaskRow, done: boolean) => {
    const ok = await save('tasks', { id: t.id, status: done ? 'done' : 'open' }, { quiet: true });
    if (!ok) return;
    if (done && t.rrule) {
      const next = nextOccurrence(t.due_date ?? today, t.rrule, t.due_date && t.due_date > today ? t.due_date : today);
      if (next) {
        const { id: _i, completed_at: _c, ...rest } = t;
        await save('tasks', { ...rest, id: uid(), status: 'open', due_date: next, checklist: t.checklist.map((c) => ({ ...c, done: false })) }, { quiet: true });
        toast(`Done — next one ${longDate(next, true)}`);
        return;
      }
    }
    if (done) toast('Done', 'ok', { label: 'Undo', run: () => save('tasks', { id: t.id, status: 'open' }, { quiet: true }) });
  };
}

export function TaskRowView({ t, hideEvent, showMove }: { t: TaskRow; hideEvent?: boolean; showMove?: boolean }) {
  const { save, canEdit } = useStore();
  const data = useData();
  const { today } = useToday();
  const complete = useCompleteTask();
  const [open, setOpen] = useState(false);
  const nav = useNavigate(), loc = useLocation();
  const person = data.people.find((p) => p.id === t.person_id);
  const ev = t.event_id ? data.events.find((e) => e.id === t.event_id) : null;
  const done = t.status === 'done';
  const overdue = !done && t.due_date && t.due_date < today;
  const move = (d: string | null) => save('tasks', { id: t.id, due_date: d }, { message: d ? `Moved to ${dayLabel(d, today).toLowerCase()}` : 'Date removed' });
  return (
    <>
      <div className="task">
        <button className={`tick ${done ? 'done' : ''} ${t.priority === 1 && !done ? 'p1' : ''}`} aria-label={done ? 'Mark not done' : 'Mark done'} disabled={!canEdit && !t.person_id} onClick={() => complete(t, !done)}>
          {done && <ICheck />}
        </button>
        <div className="grow" onClick={() => setOpen(true)} style={{ cursor: 'pointer' }}>
          <div className={`title ${done ? 'done' : ''}`}>
            {t.title} {t.source === 'suggested' && !done && <span className="tag sage">Suggested</span>} {t.priority === 1 && !done && <span className="tag clay">Important</span>}
          </div>
          <div className="small muted">
            {[t.due_date ? `${overdue ? 'Was due ' : ''}${dayLabel(t.due_date, today)}${t.due_time ? ' ' + timeLabel(t.due_time.slice(0, 5)) : ''}` : null,
              t.status === 'waiting' ? `Waiting for ${t.waiting_on || 'someone'}` : null,
              person?.name, !hideEvent && ev ? `for ${ev.title}` : null, t.rrule ? describeRule(t.rrule) : null,
              t.checklist.length ? `${t.checklist.filter((c) => c.done).length}/${t.checklist.length}` : null,
            ].filter(Boolean).join(' · ')}
          </div>
          {showMove && overdue && canEdit && (
            <div className="task-actions" onClick={(e) => e.stopPropagation()}>
              <button className="chip" onClick={() => move(today)}>Move to today</button>
              <button className="chip" onClick={() => move(addDays(today, 1))}>Tomorrow</button>
              <button className="chip" onClick={() => move(addDays(today, 7))}>Next week</button>
              <button className="chip" onClick={() => move(null)}>No date</button>
            </div>
          )}
          {t.source === 'suggested' && !done && canEdit && (
            <div className="task-actions" onClick={(e) => e.stopPropagation()}>
              <button className="chip" onClick={() => save('tasks', { id: t.id, source: 'user' }, { message: 'Kept' })}>Keep</button>
              <button className="chip" onClick={() => save('tasks', { id: t.id, status: 'done' }, { message: 'Dismissed' })}>Not needed</button>
              {ev && <button className="chip" onClick={() => openEvent(nav, loc, ev.id, t.occurrence_date ?? t.due_date ?? today)}>See plan</button>}
            </div>
          )}
        </div>
      </div>
      {open && <TaskSheet task={t} onClose={() => setOpen(false)} />}
    </>
  );
}

const DUE_CHIPS = (today: string) => {
  const sat = addDays(today, (6 - weekdayOf(today) + 7) % 7 || 7);
  return [{ label: 'Today', value: today }, { label: 'Tomorrow', value: addDays(today, 1) }, { label: 'This weekend', value: sat }, { label: 'Next week', value: addDays(today, 7) }, { label: 'No date', value: '' }];
};

export function TaskSheet({ task, onClose, preset }: { task?: TaskRow; onClose: () => void; preset?: Partial<TaskRow> }) {
  const { save, remove, canEdit } = useStore();
  const data = useData();
  const { today } = useToday();
  const [t, setT] = useState<Partial<TaskRow>>(task ?? { title: '', due_date: today, priority: 2, status: 'open', checklist: [], kind: 'todo', ...preset });
  const set = (p: Partial<TaskRow>) => setT((x) => ({ ...x, ...p }));
  const dueChips = DUE_CHIPS(today);
  const custom = t.due_date && !dueChips.some((c) => c.value === t.due_date);
  const submit = async () => {
    if (!t.title?.trim()) return;
    const ok = await save('tasks', { ...t, title: t.title.trim(), id: task?.id ?? uid(), due_date: t.due_date || null, due_time: t.due_time || null }, { message: task ? 'Saved' : 'Task added' });
    if (ok) onClose();
  };
  return (
    <Sheet title={task ? 'Task' : 'New task'} onClose={onClose} footer={canEdit ? <>
      {task && <button className="btn danger" onClick={async () => { if (confirm('Delete this task?') && await remove('tasks', task.id)) onClose(); }}>Delete</button>}
      <button className="btn primary" disabled={!t.title?.trim()} onClick={submit}>Save</button></> : undefined}>
      <Q label="What needs doing?"><input className="input" autoFocus={!task} value={t.title ?? ''} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Pay electricity bill" /></Q>
      <Q label="When?" hint={t.due_date ? longDate(t.due_date) : 'no date'}>
        <div className="chips">
          {dueChips.map((c) => <button key={c.label} className={`chip ${(t.due_date ?? '') === c.value ? 'on' : ''}`} onClick={() => set({ due_date: c.value || null })}>{c.label}</button>)}
          <label className={`chip dashed ${custom ? 'on' : ''}`} style={{ position: 'relative' }}>{custom ? longDate(t.due_date!, true) : 'Pick date'}<input type="date" value={t.due_date ?? ''} onChange={(e) => set({ due_date: e.target.value || null })} style={{ position: 'absolute', inset: 0, opacity: 0 }} /></label>
        </div>
      </Q>
      {t.due_date && (
        <Q label="At a time?" hint="for a reminder at that time">
          <Chips scroll options={[{ label: 'Any time', value: '' }, ...['08:00', '09:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00'].map((x) => ({ label: timeLabel(x), value: x }))]}
            value={t.due_time?.slice(0, 5) ?? ''} onChange={(v) => set({ due_time: v || null })} />
        </Q>
      )}
      <Q label="How important?"><Chips options={[{ label: 'Important', value: '1' }, { label: 'Normal', value: '2' }, { label: 'Whenever', value: '3' }]} value={String(t.priority ?? 2)} onChange={(v) => set({ priority: +v as 1 | 2 | 3 })} /></Q>
      <Q label="Status">
        <Chips options={[{ label: 'To do', value: 'open' }, { label: 'Waiting for someone', value: 'waiting' }, { label: 'Done', value: 'done' }]} value={t.status ?? 'open'} onChange={(v) => set({ status: v as TaskRow['status'] })} />
        {t.status === 'waiting' && <input className="input" style={{ marginTop: 8 }} placeholder="Waiting for who? e.g. Plumber" value={t.waiting_on ?? ''} onChange={(e) => set({ waiting_on: e.target.value })} />}
      </Q>
      <Q label="For whom?" hint="optional"><PeoplePicker single value={t.person_id ? [t.person_id] : []} onChange={(v) => set({ person_id: v[0] === t.person_id ? null : v[0] ?? null })} /></Q>
      <Q label="Repeat?">
        <Chips options={[{ label: 'No', value: '' }, { label: 'Daily', value: 'FREQ=DAILY' }, { label: 'Weekly', value: formatRule({ freq: 'WEEKLY', interval: 1, byday: [weekdayOf(t.due_date ?? today)] }) }, { label: 'Monthly', value: 'FREQ=MONTHLY' }]}
          value={t.rrule ?? ''} onChange={(v) => set({ rrule: v || null, due_date: t.due_date ?? today })} />
      </Q>
      <Q label="Time needed?" hint="optional">
        <Chips options={[{ label: '—', value: '' }, { label: '5 min', value: '5' }, { label: '15 min', value: '15' }, { label: '30 min', value: '30' }, { label: '1 hour', value: '60' }, { label: '2 hours', value: '120' }]}
          value={t.estimate_min ? String(t.estimate_min) : ''} onChange={(v) => set({ estimate_min: v ? +v : null })} />
      </Q>
      {t.event_id && <Q label="Linked plan"><div className="ink2">{data.events.find((e) => e.id === t.event_id)?.title ?? '—'}</div></Q>}
      <Q label="Checklist"><ItemsEditor items={t.checklist ?? []} onChange={(c) => set({ checklist: c })} placeholder="Add a step…" /></Q>
      <Q label="Notes"><textarea className="input" value={t.description ?? ''} onChange={(e) => set({ description: e.target.value })} /></Q>
    </Sheet>
  );
}

export function Tasks() {
  const { save, canEdit } = useStore();
  const data = useData();
  const { today } = useToday();
  const [text, setText] = useState('');
  const [due, setDue] = useState<string>(today);
  const [people, setPeople] = useState<string[]>([]);
  const [showDone, setShowDone] = useState(false);
  const [sheet, setSheet] = useState(false);
  const g = useMemo(() => {
    const open = data.tasks.filter((t) => t.status !== 'done');
    const by = (a: TaskRow, b: TaskRow) => (a.priority - b.priority) || (a.due_date ?? '9').localeCompare(b.due_date ?? '9') || (a.due_time ?? '').localeCompare(b.due_time ?? '');
    return {
      overdue: open.filter((t) => t.status === 'open' && t.due_date && t.due_date < today).sort(by),
      today: open.filter((t) => t.status === 'open' && t.due_date === today).sort(by),
      upcoming: open.filter((t) => t.status === 'open' && t.due_date && t.due_date > today).sort(by),
      someday: open.filter((t) => t.status === 'open' && !t.due_date).sort(by),
      waiting: open.filter((t) => t.status === 'waiting').sort(by),
      done: data.tasks.filter((t) => t.status === 'done' && t.source !== 'suggested').sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? '')),
    };
  }, [data.tasks, today]);

  const add = async () => {
    if (!text.trim()) return;
    const ok = await save('tasks', { id: uid(), title: text.trim(), due_date: due || null, person_id: people[0] ?? null, kind: /^call\b/i.test(text) ? 'call' : /^pay\b/i.test(text) ? 'pay' : /^buy\b/i.test(text) ? 'buy' : 'todo' }, { message: 'Added' });
    if (ok) setText('');
  };
  const Section = ({ title, list, move }: { title: string; list: TaskRow[]; move?: boolean }) => list.length ? (
    <div className="section"><div className="section-title"><span>{title}</span><span>{list.length}</span></div>{list.map((t) => <TaskRowView key={t.id} t={t} showMove={move} />)}</div>
  ) : null;

  return (
    <div className="page">
      <div className="page-head"><h1>To do</h1>{canEdit && <button className="btn ghost" onClick={() => setSheet(true)}><IPlus />Details</button>}</div>
      {canEdit && (
        <div className="card">
          <div className="row">
            <input className="input" value={text} placeholder="Add a task…" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} enterKeyHint="done" />
            <button className="btn primary" disabled={!text.trim()} onClick={add}>Add</button>
          </div>
          <div style={{ marginTop: 10 }}><Chips scroll options={DUE_CHIPS(today)} value={due} onChange={setDue} /></div>
          {text.trim() && data.people.length > 0 && <div style={{ marginTop: 8 }}><MultiChips scroll options={data.people.map((p) => ({ label: p.name, value: p.id, dot: p.color }))} value={people} onChange={(v) => setPeople(v.slice(-1))} /></div>}
        </div>
      )}
      <Section title="Overdue" list={g.overdue} move />
      <Section title="Today" list={g.today} />
      <Section title="Coming up" list={g.upcoming} />
      <Section title="Any time" list={g.someday} />
      <Section title="Waiting for someone" list={g.waiting} />
      {!g.overdue.length && !g.today.length && !g.upcoming.length && !g.someday.length && !g.waiting.length && <Empty title="All clear">Nothing left to do. Add a task above.</Empty>}
      {g.done.length > 0 && (
        <div className="section">
          <button className="btn ghost" onClick={() => setShowDone(!showDone)}>{showDone ? 'Hide' : 'Show'} completed ({g.done.length})</button>
          {showDone && g.done.map((t) => <TaskRowView key={t.id} t={t} />)}
        </div>
      )}
      {sheet && <TaskSheet onClose={() => setSheet(false)} />}
    </div>
  );
}

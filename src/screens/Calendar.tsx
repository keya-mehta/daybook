import { useMemo, useState } from 'react';
import { useData, usePlan, useToday } from '../lib/store';
import { addDays, weekdayOf } from '@engine/time.ts';
import type { PlanItem } from '@engine/planner.ts';
import { PlanItemView } from '../ui/PlanItemView';
import { TaskRowView } from './Tasks';
import { MultiChips, Chips, Empty } from '../ui/kit';
import { IBack, IChev } from '../ui/icons';
import { dayLabel, longDate } from '../lib/format';

type View = 'day' | 'week' | 'month';
type Kind = 'all' | 'plans' | 'transport' | 'tasks';

export function Calendar() {
  const data = useData();
  const { today, tz, now } = useToday();
  const [view, setView] = useState<View>('month');
  const [sel, setSel] = useState(today);
  const [who, setWho] = useState<string[]>([]);
  const [kind, setKind] = useState<Kind>('all');

  const monthStart = sel.slice(0, 8) + '01';
  const gridStart = addDays(monthStart, -weekdayOf(monthStart));
  const weekStart = addDays(sel, -weekdayOf(sel));
  const [from, to] = view === 'month' ? [gridStart, addDays(gridStart, 41)] : view === 'week' ? [weekStart, addDays(weekStart, 6)] : [sel, sel];
  const plan = usePlan(from, to);

  const keep = (i: PlanItem) => (!who.length || i.occ.event.person_ids.some((p) => who.includes(p))) && (kind !== 'transport' || i.needsTransport) && kind !== 'tasks';
  const tasksOn = (d: string) => kind === 'plans' || kind === 'transport' ? [] : data.tasks.filter((t) => t.due_date === d && t.status !== 'done' && (!who.length || (t.person_id && who.includes(t.person_id))));
  const dayMap = useMemo(() => new Map(plan.days.map((d) => [d.date, d])), [plan.days]);
  const step = (n: number) => {
    if (view === 'day') setSel(addDays(sel, n));
    else if (view === 'week') setSel(addDays(sel, 7 * n));
    else { const [y, m] = sel.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1 + n, 1)); setSel(t.toISOString().slice(0, 10)); }
  };
  const title = view === 'month' ? new Date(monthStart + 'T00:00:00Z').toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    : view === 'week' ? `${longDate(from, true)} – ${longDate(to, true)}` : dayLabel(sel, today);

  const selDay = dayMap.get(sel);
  return (
    <div className="page">
      <div className="page-head">
        <h1>{title}</h1>
        <div className="row" style={{ gap: 0 }}>
          <button className="iconbtn" onClick={() => step(-1)} aria-label="Previous"><IBack /></button>
          <button className="btn ghost" onClick={() => setSel(today)}>Today</button>
          <button className="iconbtn" onClick={() => step(1)} aria-label="Next"><IChev /></button>
        </div>
      </div>
      <div className="seg">{(['day', 'week', 'month'] as View[]).map((v) => <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>{v[0].toUpperCase() + v.slice(1)}</button>)}</div>
      <div style={{ marginTop: 10 }}>
        <MultiChips scroll options={data.people.map((p) => ({ label: p.name, value: p.id, dot: p.color }))} value={who} onChange={setWho} />
        <div style={{ marginTop: 6 }}><Chips scroll options={[{ label: 'Everything', value: 'all' }, { label: 'Plans', value: 'plans' }, { label: 'Car needed', value: 'transport' }, { label: 'Tasks', value: 'tasks' }]} value={kind} onChange={(v) => setKind(v as Kind)} /></div>
      </div>

      {view === 'month' && (
        <>
          <div className="month" style={{ marginTop: 12 }}>
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <div key={i} className="dow">{d}</div>)}
            {Array.from({ length: 42 }, (_, i) => addDays(gridStart, i)).map((d) => {
              const day = dayMap.get(d);
              const items = (day?.items ?? []).filter((x) => !x.occ.cancelled && keep(x) && x.occ.date === d);
              const tc = tasksOn(d).length;
              const bad = day?.issues.some((x) => x.severity === 'conflict');
              return (
                <button key={d} className={`cell ${d.slice(0, 7) !== sel.slice(0, 7) ? 'out' : ''} ${d === today ? 'today' : ''} ${d === sel ? 'sel' : ''}`} onClick={() => setSel(d)} aria-label={`${longDate(d)}: ${items.length} plans`}>
                  <span className="row" style={{ gap: 4, justifyContent: 'space-between', width: '100%' }}><span className="n">{+d.slice(8)}</span>{bad && <span className="warnmark" />}</span>
                  <span className="dots">
                    {items.slice(0, 6).map((x) => <i key={x.occ.key} style={{ background: x.people[0]?.color ?? 'var(--muted)' }} />)}
                    {tc > 0 && <i style={{ background: 'transparent', border: '1.5px solid var(--muted)', width: 7, height: 7 }} />}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="section">
            <div className="section-title">{dayLabel(sel, today)}{sel !== today && sel !== addDays(today, 1) ? '' : ` · ${longDate(sel, true)}`}</div>
            <DayItems items={(selDay?.items ?? []).filter(keep)} tz={tz} now={now} />
            {tasksOn(sel).map((t) => <TaskRowView key={t.id} t={t} />)}
          </div>
        </>
      )}
      {view === 'week' && plan.days.map((d) => (
        <div key={d.date} className="week-day">
          <h3 onClick={() => { setSel(d.date); setView('day'); }} style={{ cursor: 'pointer' }}>{dayLabel(d.date, today)} <span className="muted small" style={{ fontWeight: 400 }}>{longDate(d.date, true)}</span></h3>
          <DayItems items={d.items.filter(keep)} tz={tz} now={now} compact />
          {tasksOn(d.date).map((t) => <TaskRowView key={t.id} t={t} />)}
        </div>
      ))}
      {view === 'day' && (
        <div className="section">
          <DayItems items={(plan.days[0]?.items ?? []).filter(keep)} tz={tz} now={now} />
          {tasksOn(sel).length > 0 && <div className="section-title" style={{ marginTop: 18 }}>Tasks</div>}
          {tasksOn(sel).map((t) => <TaskRowView key={t.id} t={t} />)}
        </div>
      )}
    </div>
  );
}

function DayItems({ items, tz, now, compact }: { items: PlanItem[]; tz: string; now: Date; compact?: boolean }) {
  if (!items.length) return <Empty title="Nothing planned" />;
  return <div className="timeline">{items.map((it) => <PlanItemView key={it.occ.key} it={it} tz={tz} now={now} compact={compact} />)}</div>;
}

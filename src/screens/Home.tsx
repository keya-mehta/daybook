import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore, useData, usePlan, useToday } from '../lib/store';
import { attentionList, type CarDay, type DayPlan } from '@engine/planner.ts';
import { addDays, diffMin } from '@engine/time.ts';
import { PlanItemView } from '../ui/PlanItemView';
import { TaskRowView } from './Tasks';
import { Banner, Empty } from '../ui/kit';
import { ICar, IClock, IAlert } from '../ui/icons';
import { dayLabel, fmtTime, greeting, longDate, fmtDuration } from '../lib/format';

export function Home() {
  const { me, online, canEdit } = useStore();
  const data = useData();
  const { now, tz, today } = useToday();
  const [view, setView] = useState<'today' | 'tomorrow' | 'week'>('today');
  const from = view === 'tomorrow' ? addDays(today, 1) : today;
  const to = view === 'week' ? addDays(today, 6) : from;
  const plan = usePlan(from, to);
  const day = plan.days[0];
  const name = me?.display_name?.split(' ')[0];

  return (
    <div className="page">
      <div className="eyebrow">{longDate(today)}</div>
      <h1 className="serif" style={{ fontSize: 28, marginTop: 2 }}>{greeting(now, tz)}{name ? `, ${name}` : ''}</h1>
      <div className="seg" style={{ marginTop: 14 }}>
        {(['today', 'tomorrow', 'week'] as const).map((v) => <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>{v === 'today' ? 'Today' : v === 'tomorrow' ? 'Tomorrow' : 'This week'}</button>)}
        <Link to="/calendar" style={{ flex: 1, display: 'flex' }}><button style={{ flex: 1 }}>Calendar</button></Link>
      </div>

      {!online && <Banner>You're offline. Showing the last saved plan — changes can't be saved until you're back online.</Banner>}
      {plan.maps.status === 'error' && online && <Banner>Couldn't get travel times from Google Maps{plan.maps.error ? `: ${plan.maps.error}` : ''}. Leave times may be missing.</Banner>}
      {data.people.length === 0 && canEdit && (
        <Banner kind="info">Start by adding the people you plan for — <Link to="/people">go to People</Link>. Then add your cars and driver under <Link to="/more/transport">More → Cars &amp; drivers</Link>, and your home address in <Link to="/more/settings">Settings</Link>.</Banner>
      )}

      {view === 'week' ? <WeekList days={plan.days} tz={tz} today={today} now={now} /> : day && <DayView day={day} tz={tz} now={now} today={today} isToday={view === 'today'} mapsStatus={plan.maps.status} />}
    </div>
  );
}

function DayView({ day, tz, now, today, isToday, mapsStatus }: { day: DayPlan; tz: string; now: Date; today: string; isToday: boolean; mapsStatus: string }) {
  const data = useData();
  const attention = useMemo(() => attentionList(day, data.tasks, tz, now), [day, data.tasks, tz, now]);
  const live = day.items.filter((i) => !i.occ.cancelled);
  const next = isToday ? live.find((i) => (i.leaveAt ?? i.occ.start) > now) : live[0];
  const tasksDue = data.tasks.filter((t) => t.status === 'open' && (isToday ? t.due_date && t.due_date <= today : t.due_date === day.date))
    .sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? '') || a.priority - b.priority);
  const usesFallback = live.some((i) => i.travelSource === 'fallback');

  return (
    <>
      {next && (
        <div className={`nextup ${next.leaveAt && isToday && diffMin(next.leaveAt, now) <= 30 ? 'urgent' : ''}`}>
          {next.leaveAt ? <ICar /> : <IClock />}
          <div className="grow">
            <div className="small ink2">{next.leaveAt ? `Leave for ${next.occ.event.title}` : `Next: ${next.occ.event.title}`}</div>
            <div className="big">{fmtTime(next.leaveAt ?? next.occ.start, tz)}
              {isToday && <span className="small muted" style={{ fontWeight: 400 }}> · in {fmtDuration(Math.max(0, diffMin(next.leaveAt ?? next.occ.start, now)))}</span>}
            </div>
            <div className="small ink2">{[next.people.map((p) => p.name).join(', '), next.vehicle?.name, next.selfDrive ? 'you drive' : next.driver?.name].filter(Boolean).join(' · ')}</div>
          </div>
        </div>
      )}

      {attention.filter((a) => a.id !== 'leave').length > 0 && (
        <div className="section">
          <div className="section-title">Needs attention</div>
          {attention.filter((a) => a.id !== 'leave').map((a) => (
            <div key={a.id} className={`att ${a.tone === 'urgent' ? 'urgent' : ''}`}>
              <span className="mark" />
              <div><div>{a.text}</div>{a.sub && <div className="sub">{a.sub}</div>}</div>
            </div>
          ))}
        </div>
      )}

      <div className="section">
        <div className="section-title"><span>{isToday ? 'Today’s plan' : dayLabel(day.date, today) + '’s plan'}</span><span>{live.length || ''}</span></div>
        {day.items.length === 0 ? <Empty title="Nothing planned">Tap “Add” to put something on {isToday ? 'today' : 'this day'}.</Empty>
          : <div className="timeline">{day.items.map((it) => <PlanItemView key={it.occ.key} it={it} tz={tz} now={now} />)}</div>}
        {usesFallback && <p className="tiny muted">Times marked “rough default” use your fallback travel time, not maps.</p>}
        {mapsStatus === 'off' && live.some((i) => i.needsTransport) && <p className="tiny muted">Google Maps isn't connected, so leave times need a travel time you enter on each plan.</p>}
      </div>

      {day.cars.length > 0 && (
        <div className="section">
          <div className="section-title">Cars</div>
          {day.cars.map((c) => <CarSummary key={c.vehicle.id} c={c} tz={tz} />)}
        </div>
      )}

      {tasksDue.length > 0 && (
        <div className="section">
          <div className="section-title"><span>To do{isToday ? ' today' : ''}</span><Link to="/tasks">All tasks</Link></div>
          {tasksDue.map((t) => <TaskRowView key={t.id} t={t} showMove />)}
        </div>
      )}
      {isToday && <ComingUpPreview />}
    </>
  );
}

export function CarSummary({ c, tz }: { c: CarDay; tz: string }) {
  return (
    <div style={{ padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
      <div className="row"><ICar className="" /><b>{c.vehicle.name}</b><span className="muted small">{c.driver ? `· ${c.driver.name}` : ''}{!c.availabilityKnown ? ' · availability not set' : ''}</span></div>
      <ul className="legs">
        {c.jobs.map((j, i) => (
          <li key={i}>
            {j.repositionFrom && j.repositionDepart ? `${fmtTime(j.repositionDepart, tz)} leaves ${j.repositionFrom} → ` : ''}
            {j.departAt ? fmtTime(j.departAt, tz) : '—'} {j.kind === 'pickup' ? `pick up ${j.who}` : `${j.who}`} · {j.title}
            {j.freeAt ? <span className="muted"> · free ~{fmtTime(j.freeAt, tz)}</span> : j.kind === 'drop' ? '' : <span className="muted"> · return time unknown</span>}
          </li>
        ))}
      </ul>
      {c.lastFree && <div className="small muted" style={{ paddingLeft: 18 }}>Free for the day after ~{fmtTime(c.lastFree, tz)}</div>}
    </div>
  );
}

function WeekList({ days, tz, today, now }: { days: DayPlan[]; tz: string; today: string; now: Date }) {
  return (
    <div className="section">
      {days.map((d) => {
        const problems = d.issues.filter((i) => i.severity === 'conflict').length;
        return (
          <div key={d.date} className="week-day">
            <h3>{dayLabel(d.date, today)} <span className="muted small" style={{ fontWeight: 400 }}>{d.date === today || d.date === addDays(today, 1) ? longDate(d.date, true) : ''}</span>
              {problems > 0 && <span className="tag clay"><IAlert className="" />&nbsp;{problems}</span>}</h3>
            {d.items.length === 0 ? <div className="small muted" style={{ padding: '6px 0 10px', borderBottom: '1px solid var(--line)' }}>Nothing planned</div>
              : d.items.map((it) => <PlanItemView key={it.occ.key} it={it} tz={tz} now={now} compact />)}
          </div>
        );
      })}
    </div>
  );
}

function ComingUpPreview() {
  const data = useData();
  const { today } = useToday();
  const plan = usePlan(addDays(today, 1), addDays(today, 7));
  const prep = plan.days.flatMap((d) => d.items.filter((i) => !i.occ.cancelled && (i.tasksBefore.length || i.carry.length || i.issues.some((x) => x.severity !== 'info') || i.occ.event.needs_confirmation)));
  const soonTasks = data.tasks.filter((t) => t.status === 'open' && t.due_date && t.due_date > today && t.due_date <= addDays(today, 3));
  if (!prep.length && !soonTasks.length) return null;
  return (
    <div className="section">
      <div className="section-title"><span>Coming up</span><Link to="/more/coming-up">See all</Link></div>
      {prep.slice(0, 4).map((i) => (
        <div key={i.occ.key} className="att"><span className="mark" style={{ background: 'var(--sage)' }} />
          <div><div>{i.occ.event.title} <span className="muted small">· {dayLabel(i.occ.date, today)}</span></div>
            <div className="sub">{[i.occ.event.needs_confirmation ? 'confirm' : '', ...i.tasksBefore.map((t) => t.title), ...i.carry.map((c) => c.text), ...i.issues.filter((x) => x.severity === 'conflict').map((x) => x.message)].filter(Boolean).slice(0, 3).join(' · ')}</div></div>
        </div>
      ))}
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useData, usePlan, useToday, useStore } from '../lib/store';
import { supabase } from '../lib/supabase';
import { ICar, IBell, INote, IPin, ISettings, ISearch, IChev, ISun, IBack, IAlert } from '../ui/icons';
import { Empty } from '../ui/kit';
import { addDays } from '@engine/time.ts';
import { dayLabel, fmtTime, longDate } from '../lib/format';
import { openEvent } from '../ui/PlanItemView';
import { TaskRowView } from './Tasks';

export function BackTo({ to = '/more', label = 'More' }: { to?: string; label?: string }) {
  const nav = useNavigate();
  return <button className="btn ghost" style={{ marginLeft: -10 }} onClick={() => nav(to)}><IBack />{label}</button>;
}

export function More() {
  const data = useData();
  const pending = data.reminders.filter((r) => r.status === 'pending').length;
  const rows: [string, string, JSX.Element, string?][] = [
    ['/more/coming-up', 'Coming up', <ISun />, 'What to prepare in the next few weeks'],
    ['/more/transport', 'Cars & drivers', <ICar />, `${data.vehicles.length} car${data.vehicles.length === 1 ? '' : 's'} · ${data.drivers.length} driver${data.drivers.length === 1 ? '' : 's'}`],
    ['/more/reminders', 'Reminders', <IBell />, pending ? `${pending} scheduled` : 'None scheduled'],
    ['/more/notes', 'Notes & lists', <INote />, 'Shopping, checklists, contacts, dates'],
    ['/more/places', 'Places', <IPin />, 'Addresses you use often'],
    ['/more/settings', 'Settings', <ISettings />, 'Home, notifications, sharing, Google, backup'],
  ];
  return (
    <div className="page">
      <div className="page-head"><h1>More</h1></div>
      <Link to="/more/search" className="searchbar"><ISearch /><span className="muted">Search people, plans, tasks, notes…</span></Link>
      <div style={{ marginTop: 10 }}>
        {rows.map(([to, t, icon, sub]) => (
          <Link key={to} to={to} className="item">
            <span style={{ color: 'var(--sage-ink)', width: 24, display: 'flex' }}>{icon}</span>
            <div className="grow"><div className="title">{t}</div><div className="sub">{sub}</div></div>
            <IChev className="chev" />
          </Link>
        ))}
      </div>
    </div>
  );
}

export function ComingUp() {
  const data = useData();
  const { today } = useToday();
  const nav = useNavigate(), loc = useLocation();
  const [weeks, setWeeks] = useState(2);
  const plan = usePlan(addDays(today, 1), addDays(today, weeks * 7));
  const items = plan.days.flatMap((d) => d.items.filter((i) => i.occ.date === d.date && !i.occ.cancelled));
  const needsWork = items.filter((i) => i.occ.event.needs_confirmation || i.tasksBefore.length || i.carry.length || i.issues.some((x) => x.severity !== 'info') || (i.needsTransport && !i.vehicle));
  const tasks = data.tasks.filter((t) => t.status !== 'done' && t.due_date && t.due_date > today && t.due_date <= addDays(today, weeks * 7));
  return (
    <div className="page">
      <BackTo />
      <div className="page-head"><h1>Coming up</h1></div>
      <div className="seg">{[1, 2, 4].map((w) => <button key={w} className={weeks === w ? 'on' : ''} onClick={() => setWeeks(w)}>{w === 1 ? 'Next week' : `${w} weeks`}</button>)}</div>
      {needsWork.length === 0 && tasks.length === 0 && <Empty title="Nothing to prepare">Everything ahead is arranged.</Empty>}
      {needsWork.map((i) => {
        const ev = i.occ.event;
        return (
          <div key={i.occ.key} className="section" style={{ marginTop: 18 }}>
            <button className="item" style={{ borderBottom: 0, paddingBottom: 4 }} onClick={() => openEvent(nav, loc, ev.id, i.occ.date)}>
              <div className="grow"><div className="title">{ev.title}</div><div className="sub">{dayLabel(i.occ.date, today)} · {fmtTime(i.occ.start, data.household.timezone)} · {i.people.map((p) => p.name).join(', ')}</div></div>
              <IChev className="chev" />
            </button>
            <div style={{ paddingLeft: 2 }}>
              {ev.needs_confirmation && <div className="fact warn small"><IAlert /><span><b>Needs confirming</b> — call or message to confirm</span></div>}
              {i.needsTransport && !i.vehicle && <div className="fact bad small"><ICar /><span><b>Transport to arrange</b></span></div>}
              {i.issues.filter((x) => x.severity !== 'info' && x.kind !== 'car_missing').map((x) => <div key={x.id} className={`fact small ${x.severity === 'conflict' ? 'bad' : 'warn'}`}><IAlert /><span>{x.message}</span></div>)}
              {i.carry.length > 0 && <div className="fact small"><span className="tag">To carry</span><span>{i.carry.map((c) => c.text).join(', ')}</span></div>}
              {i.tasksBefore.map((t) => <TaskRowView key={t.id} t={t} hideEvent />)}
            </div>
          </div>
        );
      })}
      {tasks.filter((t) => !t.event_id).length > 0 && (
        <div className="section"><div className="section-title">Other tasks with deadlines</div>{tasks.filter((t) => !t.event_id).map((t) => <TaskRowView key={t.id} t={t} />)}</div>
      )}
      <p className="tiny muted" style={{ marginTop: 16 }}><span className="tag sage">Suggested</span> tasks were added by the app — keep or dismiss them. Everything else was entered by you.</p>
    </div>
  );
}

type Hit = { kind: string; id: string; title: string; subtitle: string | null; at: string | null };
export function Search() {
  const { householdId, online } = useStore();
  const data = useData();
  const { today, tz } = useToday();
  const nav = useNavigate(), loc = useLocation();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const local = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (s.length < 2) return [];
    const m = (x?: string | null) => !!x && x.toLowerCase().includes(s);
    return [
      ...data.people.filter((p) => m(p.name) || m(p.relation) || m(p.notes)).map((p) => ({ kind: 'person', id: p.id, title: p.name, subtitle: p.relation, at: null })),
      ...data.events.filter((e) => m(e.title) || m(e.location) || m(e.notes)).map((e) => ({ kind: 'event', id: e.id, title: e.title, subtitle: e.location, at: e.start_at })),
      ...data.tasks.filter((t) => m(t.title) || m(t.description)).map((t) => ({ kind: 'task', id: t.id, title: t.title, subtitle: t.status === 'done' ? 'done' : t.due_date, at: null })),
      ...data.places.filter((p) => m(p.name) || m(p.address)).map((p) => ({ kind: 'place', id: p.id, title: p.name, subtitle: p.address, at: null })),
      ...data.notes.filter((n) => m(n.title) || m(n.body) || n.items.some((i) => m(i.text))).map((n) => ({ kind: 'note', id: n.id, title: n.title, subtitle: n.kind, at: null })),
    ];
  }, [q, data]);
  // the server also searches older completed tasks that aren't loaded on the phone
  useEffect(() => {
    if (q.trim().length < 2 || !online) { setHits([]); return; }
    const t = setTimeout(async () => {
      const { data: rows } = await supabase.rpc('search_all', { h: householdId, q: q.trim() });
      setHits((rows ?? []) as Hit[]);
    }, 300);
    return () => clearTimeout(t);
  }, [q, householdId, online]);
  const all = [...local, ...hits.filter((h) => !local.some((l) => l.id === h.id))];
  const go = (h: Hit) => {
    if (h.kind === 'person') nav(`/people/${h.id}`);
    else if (h.kind === 'event') openEvent(nav, loc, h.id, h.at ? new Date(h.at).toLocaleDateString('en-CA', { timeZone: tz }) : today);
    else if (h.kind === 'task') nav('/tasks');
    else if (h.kind === 'place') nav('/more/places');
    else nav('/more/notes');
  };
  const label: Record<string, string> = { person: 'Person', event: 'Plan', task: 'Task', place: 'Place', note: 'Note' };
  return (
    <div className="page">
      <BackTo />
      <div className="searchbar"><ISearch /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" enterKeyHint="search" /></div>
      {q.trim().length >= 2 && all.length === 0 && <Empty title="No matches" />}
      {all.map((h) => (
        <button key={h.kind + h.id} className="item" onClick={() => go(h)}>
          <span className="tag">{label[h.kind]}</span>
          <div className="grow"><div className="title">{h.title}</div><div className="sub">{[h.at ? `${longDate(new Date(h.at).toLocaleDateString('en-CA', { timeZone: tz }), true)}` : '', h.subtitle].filter(Boolean).join(' · ')}</div></div>
        </button>
      ))}
    </div>
  );
}

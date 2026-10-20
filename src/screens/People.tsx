import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useStore, useData, usePlan, useToday } from '../lib/store';
import { Avatar, Chips, Q, Sheet, Empty, PERSON_COLORS, Banner } from '../ui/kit';
import { IChev, IPhone, IPlus, IBack, IRepeat } from '../ui/icons';
import { PlanItemView, openEvent } from '../ui/PlanItemView';
import { TaskRowView } from './Tasks';
import { addDays, localParts } from '@engine/time.ts';
import { describeRule } from '@engine/recurrence.ts';
import type { Person } from '@engine/types.ts';
import { dayLabel, fmtTime } from '../lib/format';
import { useLocation } from 'react-router-dom';

export function People() {
  const { canEdit } = useStore();
  const data = useData();
  const [adding, setAdding] = useState(false);
  const { today } = useToday();
  const plan = usePlan(today, addDays(today, 6));
  return (
    <div className="page">
      <div className="page-head"><h1>People</h1>{canEdit && <button className="btn" onClick={() => setAdding(true)}><IPlus />Add person</button>}</div>
      {data.people.length === 0 ? <Empty title="No one added yet">Add the family members and others whose plans you look after.</Empty> : (
        <div>
          {data.people.map((p) => {
            const next = plan.days.flatMap((d) => d.items).find((i) => !i.occ.cancelled && i.occ.event.person_ids.includes(p.id) && i.occ.end > new Date());
            return (
              <Link key={p.id} to={`/people/${p.id}`} className="item">
                <Avatar p={p} />
                <div className="grow">
                  <div className="title">{p.name} {p.relation && <span className="muted small" style={{ fontWeight: 400 }}>{p.relation}</span>}</div>
                  <div className="sub ellipsis">{next ? `${dayLabel(next.occ.date, today)} · ${next.occ.event.title}` : 'Nothing in the next 7 days'}</div>
                </div>
                <IChev className="chev" />
              </Link>
            );
          })}
        </div>
      )}
      {adding && <PersonSheet onClose={() => setAdding(false)} />}
    </div>
  );
}

export function PersonPage() {
  const { id } = useParams();
  const { canEdit } = useStore();
  const data = useData();
  const nav = useNavigate(), loc = useLocation();
  const { today, tz, now } = useToday();
  const [editing, setEditing] = useState(false);
  const plan = usePlan(today, addDays(today, 13));
  const p = data.people.find((x) => x.id === id);
  if (!p) return <div className="page"><Banner kind="info">This person was removed.</Banner><Link to="/people">Back to people</Link></div>;
  const items = plan.days.flatMap((d) => d.items.filter((i) => i.occ.event.person_ids.includes(p.id) && i.occ.date === d.date));
  const regular = data.events.filter((e) => e.rrule && e.person_ids.includes(p.id) && e.status !== 'cancelled');
  const tasks = data.tasks.filter((t) => t.person_id === p.id && t.status !== 'done');
  const notes = data.notes.filter((n) => n.person_id === p.id);
  return (
    <div className="page">
      <button className="btn ghost" style={{ marginLeft: -10 }} onClick={() => nav('/people')}><IBack />People</button>
      <div className="row" style={{ marginTop: 6, gap: 14 }}>
        <Avatar p={p} size="lg" />
        <div className="grow"><h1 className="serif" style={{ fontSize: 26 }}>{p.name}</h1>{p.relation && <div className="muted">{p.relation}</div>}</div>
        {canEdit && <button className="btn" onClick={() => setEditing(true)}>Edit</button>}
      </div>
      <div className="row wrap" style={{ marginTop: 12, gap: 8 }}>
        {p.phone && <a className="chip" href={`tel:${p.phone}`}><IPhone />Call</a>}
        {canEdit && <button className="chip" onClick={() => { const q = new URLSearchParams(loc.search); q.set('add', '1'); q.set('person', p.id); nav({ search: q.toString() }); }}><IPlus />Plan for {p.name.split(' ')[0]}</button>}
      </div>
      {(p.notes || p.usual_pickup || p.email) && (
        <dl className="kv section">
          {p.usual_pickup && <><dt>Usually picked up from</dt><dd>{p.usual_pickup}</dd></>}
          {p.email && <><dt>Email</dt><dd>{p.email}</dd></>}
          {p.notes && <><dt>Notes</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{p.notes}</dd></>}
        </dl>
      )}
      <div className="section">
        <div className="section-title">Next two weeks</div>
        {items.length ? <div className="timeline">{items.map((it) => (
          <div key={it.occ.key}><div className="eyebrow" style={{ marginTop: 10 }}>{dayLabel(it.occ.date, today)}</div><PlanItemView it={it} tz={tz} now={now} compact /></div>
        ))}</div> : <Empty title="Nothing planned" />}
      </div>
      {regular.length > 0 && (
        <div className="section">
          <div className="section-title">Regular commitments</div>
          {regular.map((e) => (
            <button key={e.id} className="item" onClick={() => openEvent(nav, loc, e.id, localParts(e.start_at, tz).date)}>
              <IRepeat className="chev" />
              <div className="grow"><div className="title">{e.title}</div><div className="sub">{describeRule(e.rrule)} · {fmtTime(e.start_at, tz)}{e.location ? ` · ${e.location}` : ''}</div></div>
            </button>
          ))}
        </div>
      )}
      {tasks.length > 0 && <div className="section"><div className="section-title">Tasks</div>{tasks.map((t) => <TaskRowView key={t.id} t={t} />)}</div>}
      {notes.length > 0 && <div className="section"><div className="section-title">Notes</div>{notes.map((n) => <div key={n.id} className="item" style={{ cursor: 'default' }}><div className="grow"><div className="title">{n.title}</div>{n.body && <div className="sub">{n.body}</div>}</div></div>)}</div>}
      {editing && <PersonSheet person={p} onClose={() => setEditing(false)} />}
    </div>
  );
}

const RELATIONS = ['Me', 'Husband', 'Dad', 'Mum', 'Son', 'Daughter', 'Granddaughter', 'Grandson', 'Dadi', 'Nani', 'Helper', 'Driver'];

export function PersonSheet({ person, onClose }: { person?: Person; onClose: () => void }) {
  const { save, remove } = useStore();
  const data = useData();
  const nav = useNavigate();
  const [p, setP] = useState<Partial<Person>>(person ?? { name: '', color: PERSON_COLORS[data.people.length % PERSON_COLORS.length], sort: data.people.length });
  const set = (x: Partial<Person>) => setP((o) => ({ ...o, ...x }));
  const photo = async (f: File | undefined) => {
    if (!f) return;
    const img = await createImageBitmap(f);
    const c = document.createElement('canvas');
    const s = Math.min(img.width, img.height);
    c.width = c.height = 160;
    c.getContext('2d')!.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 160, 160);
    set({ photo_url: c.toDataURL('image/jpeg', 0.82) });
  };
  return (
    <Sheet title={person ? `Edit ${person.name}` : 'Add a person'} onClose={onClose} footer={<>
      {person && <button className="btn danger" onClick={async () => {
        if (!confirm(`Remove ${person.name}? Their plans stay but won't show a name.`)) return;
        if (await remove('people', person.id, { message: `${person.name} removed` })) { onClose(); nav('/people'); }
      }}>Remove</button>}
      <button className="btn primary" disabled={!p.name?.trim()} onClick={async () => { if (await save('people', { ...p, name: p.name!.trim() }, { message: person ? 'Saved' : `${p.name} added` })) onClose(); }}>Save</button>
    </>}>
      <div className="row" style={{ marginTop: 14 }}>
        <Avatar p={{ name: p.name || '?', initials: p.initials ?? null, color: p.color!, photo_url: p.photo_url ?? null }} size="lg" />
        <label className="btn">{p.photo_url ? 'Change photo' : 'Add photo'}<input type="file" accept="image/*" hidden onChange={(e) => photo(e.target.files?.[0])} /></label>
        {p.photo_url && <button className="btn ghost" onClick={() => set({ photo_url: null })}>Remove</button>}
      </div>
      <Q label="Name"><input className="input" value={p.name ?? ''} onChange={(e) => set({ name: e.target.value })} autoFocus={!person} /></Q>
      <Q label="Who are they to you?" hint="helps when you type plans">
        <Chips scroll options={RELATIONS.map((r) => ({ label: r, value: r }))} value={p.relation ?? null} onChange={(v) => set({ relation: p.relation === v ? null : v })} />
        <input className="input" style={{ marginTop: 8 }} placeholder="Or type, e.g. Ananya's tutor" value={p.relation ?? ''} onChange={(e) => set({ relation: e.target.value || null })} />
      </Q>
      <Q label="Colour"><Chips options={PERSON_COLORS.map((c) => ({ label: <span className="dot" style={{ background: c, width: 16, height: 16, borderRadius: 8, display: 'inline-block' }} />, value: c }))} value={p.color!} onChange={(v) => set({ color: v })} /></Q>
      <Q label="Phone" hint="optional"><input className="input" type="tel" value={p.phone ?? ''} onChange={(e) => set({ phone: e.target.value || null })} /></Q>
      <Q label="Usually picked up from" hint="if not home"><input className="input" value={p.usual_pickup ?? ''} placeholder="e.g. Office, Nariman Point" onChange={(e) => set({ usual_pickup: e.target.value || null })} /></Q>
      <Q label="Notes & preferences"><textarea className="input" value={p.notes ?? ''} placeholder="e.g. Needs wheelchair at the hospital; prefers morning appointments" onChange={(e) => set({ notes: e.target.value || null })} /></Q>
    </Sheet>
  );
}

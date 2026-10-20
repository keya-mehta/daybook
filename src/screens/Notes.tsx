import { useState } from 'react';
import { useStore, useData, useToday } from '../lib/store';
import type { Note } from '../lib/store';
import { Chips, Q, Sheet, Empty, uid } from '../ui/kit';
import { IPlus, IChev, IPhone, IPin } from '../ui/icons';
import { ItemsEditor, PeoplePicker } from './AddPlan';
import { BackTo } from './More';
import { longDate } from '../lib/format';
import type { Place } from '@engine/types.ts';

const KINDS: { value: Note['kind']; label: string; plural: string }[] = [
  { value: 'shopping', label: 'Shopping list', plural: 'Shopping lists' },
  { value: 'checklist', label: 'Reusable checklist', plural: 'Reusable checklists' },
  { value: 'note', label: 'Note', plural: 'Household notes' },
  { value: 'contact', label: 'Contact', plural: 'Important contacts' },
  { value: 'date', label: 'Important date', plural: 'Important dates' },
];

export function Notes() {
  const { canEdit } = useStore();
  const data = useData();
  const { today } = useToday();
  const [open, setOpen] = useState<Partial<Note> | null>(null);
  return (
    <div className="page">
      <BackTo />
      <div className="page-head"><h1>Notes & lists</h1></div>
      {canEdit && <Chips scroll options={KINDS.map((k) => ({ label: <><IPlus />{k.label}</>, value: k.value }))} value={null} onChange={(v) => setOpen({ kind: v, title: '', items: [] })} />}
      {data.notes.length === 0 && <Empty title="Nothing here yet">Keep shopping lists, reusable checklists (e.g. “Doctor visit”), contacts and important dates.</Empty>}
      {KINDS.map((k) => {
        const list = data.notes.filter((n) => n.kind === k.value).sort((a, b) => k.value === 'date' ? nextDate(a, today).localeCompare(nextDate(b, today)) : 0);
        if (!list.length) return null;
        return (
          <div key={k.value} className="section">
            <div className="section-title">{k.plural}</div>
            {list.map((n) => (
              <button key={n.id} className="item" onClick={() => setOpen(n)}>
                <div className="grow">
                  <div className="title">{n.title}</div>
                  <div className="sub ellipsis">
                    {n.kind === 'shopping' || n.kind === 'checklist' ? `${n.items.filter((i) => !i.done).length} of ${n.items.length} left` :
                      n.kind === 'contact' ? n.phone ?? n.body : n.kind === 'date' && n.the_date ? `${longDate(nextDate(n, today), true)}${n.repeats_yearly ? ' · every year' : ''}` : n.body}
                  </div>
                </div>
                {n.kind === 'contact' && n.phone && <a className="iconbtn" href={`tel:${n.phone}`} onClick={(e) => e.stopPropagation()} aria-label="Call"><IPhone /></a>}
                <IChev className="chev" />
              </button>
            ))}
          </div>
        );
      })}
      {open && <NoteSheet note={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
function nextDate(n: Note, today: string) {
  if (!n.the_date) return '9999';
  if (!n.repeats_yearly) return n.the_date;
  const y = +today.slice(0, 4);
  const d = `${y}${n.the_date.slice(4)}`;
  return d >= today ? d : `${y + 1}${n.the_date.slice(4)}`;
}

function NoteSheet({ note, onClose }: { note: Partial<Note>; onClose: () => void }) {
  const { save, remove, canEdit } = useStore();
  const [n, setN] = useState<Partial<Note>>(note);
  const set = (x: Partial<Note>) => setN((o) => ({ ...o, ...x }));
  const persist = async (close = true) => { if (n.title?.trim()) { const ok = await save('notes', { ...n, id: n.id ?? uid(), title: n.title.trim() }, { quiet: !close, message: 'Saved' }); if (ok && !n.id) set({ id: ok.id }); if (ok && close) onClose(); } };
  const list = n.kind === 'shopping' || n.kind === 'checklist';
  return (
    <Sheet title={KINDS.find((k) => k.value === n.kind)?.label ?? 'Note'} onClose={onClose} footer={canEdit ? <>
      {n.id && <button className="btn danger" onClick={async () => { if (confirm('Delete this?') && await remove('notes', n.id!)) onClose(); }}>Delete</button>}
      <button className="btn primary" disabled={!n.title?.trim()} onClick={() => persist()}>Save</button></> : undefined}>
      <Q label="Title"><input className="input" value={n.title ?? ''} autoFocus={!n.id} onChange={(e) => set({ title: e.target.value })} placeholder={n.kind === 'checklist' ? 'e.g. Doctor visit' : n.kind === 'contact' ? 'e.g. Dr. Shah clinic' : n.kind === 'date' ? "e.g. Dadi's birthday" : ''} /></Q>
      {list && <Q label="Items"><ItemsEditor items={n.items ?? []} onChange={(items) => set({ items })} placeholder="Add item…" />
        {n.kind === 'shopping' && (n.items ?? []).some((i) => i.done) && <button className="btn ghost" onClick={() => set({ items: (n.items ?? []).filter((i) => !i.done) })}>Clear bought items</button>}
        {n.kind === 'checklist' && <p className="small muted">Add this list to any plan from the “To do beforehand” section.</p>}</Q>}
      {n.kind === 'contact' && <Q label="Phone"><input className="input" type="tel" value={n.phone ?? ''} onChange={(e) => set({ phone: e.target.value })} /></Q>}
      {n.kind === 'date' && <>
        <Q label="Date"><input className="input" type="date" value={n.the_date ?? ''} onChange={(e) => set({ the_date: e.target.value })} /></Q>
        <label className="check"><input type="checkbox" checked={!!n.repeats_yearly} onChange={(e) => set({ repeats_yearly: e.target.checked })} />Every year</label>
      </>}
      <Q label="About someone?" hint="optional"><PeoplePicker single value={n.person_id ? [n.person_id] : []} onChange={(v) => set({ person_id: v[0] === n.person_id ? null : v[0] ?? null })} /></Q>
      <Q label="Notes"><textarea className="input" value={n.body ?? ''} onChange={(e) => set({ body: e.target.value })} /></Q>
    </Sheet>
  );
}

export function Places() {
  const { save, remove, canEdit } = useStore();
  const data = useData();
  const [open, setOpen] = useState<Partial<Place> | null>(null);
  return (
    <div className="page">
      <BackTo />
      <div className="page-head"><h1>Places</h1>{canEdit && <button className="btn" onClick={() => setOpen({ name: '', address: '' })}><IPlus />Add</button>}</div>
      <p className="small muted">Saved places show up as one-tap choices when adding plans. Use full addresses so travel times are accurate.</p>
      <div className="item" style={{ cursor: 'default' }}><IPin className="chev" /><div className="grow"><div className="title">{data.household.home_label || 'Home'}</div><div className="sub">{data.household.home_address || 'Set your home address in Settings'}</div></div></div>
      {data.places.map((p) => (
        <button key={p.id} className="item" onClick={() => canEdit && setOpen(p)}>
          <IPin className="chev" /><div className="grow"><div className="title">{p.name}</div><div className="sub">{p.address}</div></div><IChev className="chev" />
        </button>
      ))}
      {open && (
        <Sheet title={open.id ? 'Edit place' : 'Add a place'} onClose={() => setOpen(null)} footer={<>
          {open.id && <button className="btn danger" onClick={async () => { if (await remove('places', open.id!)) setOpen(null); }}>Delete</button>}
          <button className="btn primary" disabled={!open.name?.trim() || !open.address?.trim()} onClick={async () => { if (await save('places', { ...open, name: open.name!.trim(), address: open.address!.trim() })) setOpen(null); }}>Save</button></>}>
          <Q label="Name"><input className="input" value={open.name ?? ''} placeholder="e.g. Dr. Shah's clinic" onChange={(e) => setOpen({ ...open, name: e.target.value })} /></Q>
          <Q label="Address"><textarea className="input" value={open.address ?? ''} placeholder="Street, area, city" onChange={(e) => setOpen({ ...open, address: e.target.value })} /></Q>
          <Q label="Phone" hint="optional"><input className="input" type="tel" value={open.phone ?? ''} onChange={(e) => setOpen({ ...open, phone: e.target.value })} /></Q>
        </Sheet>
      )}
    </div>
  );
}

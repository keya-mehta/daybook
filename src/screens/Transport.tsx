import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useStore, useData, usePlan, useToday } from '../lib/store';
import { Chips, MultiChips, Q, Sheet, Empty, Banner, uid } from '../ui/kit';
import { ICar, ISteering, IPlus, IChev, IAlert } from '../ui/icons';
import { addDays, zonedToUtc, localParts } from '@engine/time.ts';
import type { Driver, Vehicle } from '@engine/types.ts';
import { CarSummary } from './Home';
import { BackTo } from './More';
import { dayLabel, fmtTime, longDate, timeLabel } from '../lib/format';
import { openEvent, travelNote } from '../ui/PlanItemView';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const TIMES = ['05:00', '06:00', '07:00', '08:00', '09:00', '10:00', '12:00', '14:00', '17:00', '18:00', '19:00', '20:00', '21:00', '22:00', '23:00'];

function availText(r: { available_days: number[] | null; available_from: string | null; available_to: string | null }) {
  if (r.available_days == null) return 'Availability not set';
  const days = r.available_days.length === 7 ? 'Every day' : r.available_days.join() === '1,2,3,4,5,6' ? 'Mon–Sat' : r.available_days.join() === '1,2,3,4,5' ? 'Mon–Fri' : r.available_days.map((d) => DOW[d]).join(', ');
  return `${days}${r.available_from ? ` · ${timeLabel(r.available_from.slice(0, 5))}–${timeLabel((r.available_to ?? '23:59').slice(0, 5))}` : ''}`;
}

export function Transport() {
  const { canEdit } = useStore();
  const data = useData();
  const { today, tz } = useToday();
  const nav = useNavigate(), loc = useLocation();
  const [date, setDate] = useState(today);
  const [edit, setEdit] = useState<{ kind: 'vehicle' | 'driver'; row?: Vehicle | Driver } | null>(null);
  const plan = usePlan(date, date);
  const day = plan.days[0];
  const unassigned = day?.items.filter((i) => i.needsTransport && !i.vehicle) ?? [];
  const trips = day?.items.filter((i) => i.needsTransport) ?? [];
  const carIssues = day?.issues.filter((i) => ['car_conflict', 'driver_conflict', 'car_unavailable', 'driver_unavailable', 'availability_unknown', 'driver_missing'].includes(i.kind)) ?? [];

  return (
    <div className="page">
      <BackTo />
      <div className="page-head"><h1>Cars & drivers</h1></div>
      <Chips scroll options={[0, 1, 2, 3, 4, 5, 6].map((n) => ({ label: n < 2 ? dayLabel(addDays(today, n), today) : longDate(addDays(today, n), true), value: addDays(today, n) }))} value={date} onChange={setDate} />

      <div className="section">
        <div className="section-title">Transport · {dayLabel(date, today)}</div>
        {!trips.length && <Empty title="No car needed">No plans need a car {dayLabel(date, today).toLowerCase() === 'today' ? 'today' : 'that day'}.</Empty>}
        {carIssues.map((i) => <div key={i.id} className={`att ${i.severity === 'conflict' ? 'urgent' : ''}`}><span className="mark" /><div><div>{i.message}</div>{i.suggestions[0] && <div className="sub">{i.suggestions.join(' · ')}</div>}</div></div>)}
        {day?.cars.map((c) => <CarSummary key={c.vehicle.id} c={c} tz={tz} />)}
        {unassigned.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div className="small" style={{ color: 'var(--clay)', fontWeight: 600 }}><IAlert className="" /> Needs a car</div>
            {unassigned.map((i) => (
              <button key={i.occ.key} className="item" onClick={() => openEvent(nav, loc, i.occ.event.id, i.occ.date)}>
                <div className="grow"><div className="title">{i.occ.event.title} · {i.people.map((p) => p.name).join(', ')}</div>
                  <div className="sub">{i.leaveAt ? `Leave ${fmtTime(i.leaveAt, tz)} · ` : ''}{travelNote(i)}</div></div>
                <IChev className="chev" />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="section">
        <div className="section-title"><span>Cars</span>{canEdit && <button className="btn ghost" onClick={() => setEdit({ kind: 'vehicle' })}><IPlus />Add</button>}</div>
        {data.vehicles.length === 0 && <p className="muted small">No cars yet. Add the cars you can use; the planner never assumes one is free unless you say so.</p>}
        {data.vehicles.map((v) => (
          <button key={v.id} className="item" onClick={() => canEdit && setEdit({ kind: 'vehicle', row: v })}>
            <ICar className="chev" />
            <div className="grow"><div className="title">{v.name}</div><div className="sub">{[availText(v), data.drivers.find((d) => d.id === v.default_driver_id)?.name].filter(Boolean).join(' · ')}</div></div>
            <IChev className="chev" />
          </button>
        ))}
      </div>
      <div className="section">
        <div className="section-title"><span>Drivers</span>{canEdit && <button className="btn ghost" onClick={() => setEdit({ kind: 'driver' })}><IPlus />Add</button>}</div>
        {data.drivers.length === 0 && <p className="muted small">No drivers yet.</p>}
        {data.drivers.map((d) => (
          <button key={d.id} className="item" onClick={() => canEdit && setEdit({ kind: 'driver', row: d })}>
            <ISteering className="chev" />
            <div className="grow"><div className="title">{d.name}</div><div className="sub">{[availText(d), d.phone].filter(Boolean).join(' · ')}</div></div>
            <IChev className="chev" />
          </button>
        ))}
      </div>
      {edit && <ResourceSheet kind={edit.kind} row={edit.row} onClose={() => setEdit(null)} />}
    </div>
  );
}

function ResourceSheet({ kind, row, onClose }: { kind: 'vehicle' | 'driver'; row?: Vehicle | Driver; onClose: () => void }) {
  const { save, remove } = useStore();
  const data = useData();
  const { tz, today } = useToday();
  const table = kind === 'vehicle' ? 'vehicles' : 'drivers';
  const [r, setR] = useState<Record<string, unknown>>(row ? { ...row } : { name: '', available_days: [0, 1, 2, 3, 4, 5, 6], available_from: '07:00', available_to: '22:00' });
  const set = (x: Record<string, unknown>) => setR((o) => ({ ...o, ...x }));
  const days = r.available_days as number[] | null;
  const blocks = row ? data.blocks.filter((b) => (kind === 'vehicle' ? b.vehicle_id : b.driver_id) === row.id && new Date(b.ends_at) > new Date()) : [];
  const [offDate, setOffDate] = useState(today);
  const addBlock = async () => {
    if (!row) return;
    await save('resource_blocks', { id: uid(), [kind === 'vehicle' ? 'vehicle_id' : 'driver_id']: row.id, starts_at: zonedToUtc(offDate, '00:00', tz).toISOString(), ends_at: zonedToUtc(addDays(offDate, 1), '00:00', tz).toISOString(), reason: 'Not available' }, { message: `Marked unavailable on ${longDate(offDate, true)}` });
  };
  return (
    <Sheet title={row ? `Edit ${row.name}` : kind === 'vehicle' ? 'Add a car' : 'Add a driver'} onClose={onClose} footer={<>
      {row && <button className="btn danger" onClick={async () => { if (confirm(`Remove ${row.name}?`) && await remove(table, row.id)) onClose(); }}>Remove</button>}
      <button className="btn primary" disabled={!String(r.name ?? '').trim()} onClick={async () => {
        const { id: _i, ...rest } = r;
        if (await save(table, { ...(row ? { id: row.id } : {}), ...rest, name: String(r.name).trim() }, { message: 'Saved' })) onClose();
      }}>Save</button></>}>
      <Q label="Name"><input className="input" autoFocus={!row} value={String(r.name ?? '')} placeholder={kind === 'vehicle' ? 'e.g. Honda City' : 'e.g. Ramesh'} onChange={(e) => set({ name: e.target.value })} /></Q>
      {kind === 'vehicle' && (
        <>
          <Q label="Usual driver">
            <Chips options={[...data.drivers.map((d) => ({ label: d.name, value: d.id })), { label: 'None / family drives', value: '' }]} value={(r.default_driver_id as string) ?? ''} onChange={(v) => set({ default_driver_id: v || null })} />
          </Q>
          <Q label="Seats"><Chips options={['4', '5', '7', '8'].map((s) => ({ label: s, value: s }))} value={r.seats ? String(r.seats) : null} onChange={(v) => set({ seats: +v })} /></Q>
        </>
      )}
      {kind === 'driver' && <Q label="Phone"><input className="input" type="tel" value={String(r.phone ?? '')} onChange={(e) => set({ phone: e.target.value || null })} /></Q>}
      <Q label="Which days is it available?" hint="the planner won't assume otherwise">
        <Chips options={[{ label: 'Every day', value: 'all' }, { label: 'Mon–Sat', value: 'mosa' }, { label: 'Mon–Fri', value: 'mofr' }, { label: 'Choose days', value: 'pick' }, { label: "Don't know yet", value: 'unknown' }]}
          value={days == null ? 'unknown' : days.length === 7 ? 'all' : days.join() === '1,2,3,4,5,6' ? 'mosa' : days.join() === '1,2,3,4,5' ? 'mofr' : 'pick'}
          onChange={(v) => set({ available_days: v === 'unknown' ? null : v === 'all' ? [0, 1, 2, 3, 4, 5, 6] : v === 'mosa' ? [1, 2, 3, 4, 5, 6] : v === 'mofr' ? [1, 2, 3, 4, 5] : days ?? [1] })} />
        {days && !([7, 6, 5].includes(days.length) && ['0,1,2,3,4,5,6', '1,2,3,4,5,6', '1,2,3,4,5'].includes(days.join())) && (
          <div style={{ marginTop: 8 }}><MultiChips options={DOW.map((l, i) => ({ label: l, value: String(i) }))} value={days.map(String)} onChange={(v) => set({ available_days: v.map(Number).sort() })} /></div>
        )}
      </Q>
      {days && (
        <>
          <Q label="From"><Chips scroll options={TIMES.slice(0, 8).map((t) => ({ label: timeLabel(t), value: t }))} value={String(r.available_from ?? '').slice(0, 5)} onChange={(v) => set({ available_from: v })} /></Q>
          <Q label="Until"><Chips scroll options={TIMES.slice(6).map((t) => ({ label: timeLabel(t), value: t }))} value={String(r.available_to ?? '').slice(0, 5)} onChange={(v) => set({ available_to: v })} /></Q>
        </>
      )}
      {row && (
        <Q label="Days off / servicing">
          {blocks.map((b) => (
            <div key={b.id} className="row" style={{ minHeight: 40 }}>
              <span className="grow">{longDate(localParts(b.starts_at, tz).date)}</span>
              <button className="btn ghost" onClick={() => remove('resource_blocks', b.id, { message: 'Removed' })}>Remove</button>
            </div>
          ))}
          <div className="row">
            <input type="date" className="input" value={offDate} onChange={(e) => setOffDate(e.target.value)} />
            <button className="btn" onClick={addBlock}>Mark off</button>
          </div>
        </Q>
      )}
      {!row && <Banner kind="info">After saving you can add days off or servicing dates.</Banner>}
    </Sheet>
  );
}

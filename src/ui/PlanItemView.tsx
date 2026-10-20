import { useNavigate, useLocation } from 'react-router-dom';
import type { PlanItem } from '@engine/planner.ts';
import { fmtTime, fmtDuration } from '../lib/format';
import { Avatar } from './kit';
import { IAlert, IBag, ICar, IClock, IPin, ITasks, IRepeat } from './icons';
import { describeRule } from '@engine/recurrence.ts';

export const MODE_LABEL: Record<string, string> = { none: '', self: 'Goes on their own', drop: 'Drop only', drop_pickup: 'Drop & pick up', wait: 'Drop & wait' };

export function travelNote(it: PlanItem): string {
  if (it.travelMin == null) return 'travel time not known';
  const t = fmtDuration(it.travelMin);
  switch (it.travelSource) {
    case 'google_traffic': return `${t} drive (Google Maps, with traffic)`;
    case 'google': return `${t} drive (Google Maps)`;
    case 'manual': return `${t} drive (your estimate)`;
    case 'fallback': return `~${t} drive (rough default — not from maps)`;
    default: return t;
  }
}

export function openEvent(nav: ReturnType<typeof useNavigate>, loc: ReturnType<typeof useLocation>, id: string, date: string) {
  const p = new URLSearchParams(loc.search);
  p.set('event', id); p.set('date', date);
  nav({ pathname: loc.pathname, search: p.toString() });
}

export function PlanItemView({ it, tz, now, compact }: { it: PlanItem; tz: string; now: Date; compact?: boolean }) {
  const nav = useNavigate(), loc = useLocation();
  const ev = it.occ.event;
  const past = it.occ.end < now;
  const conflicts = it.issues.filter((i) => i.severity === 'conflict' && i.kind !== 'car_missing');
  const warns = it.issues.filter((i) => i.severity === 'warning');
  return (
    <div className={`tl ${past ? 'past' : ''} ${it.occ.cancelled ? 'cancelled' : ''}`} onClick={() => openEvent(nav, loc, ev.id, it.occ.date)} role="button" tabIndex={0}>
      <div className="time">
        {ev.all_day ? 'All day' : fmtTime(it.occ.start, tz).replace(' ', ' ')}
        {!ev.all_day && <small>to {fmtTime(it.occ.end, tz)}</small>}
      </div>
      <div className="body">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div className="grow">
            <div className="title">{ev.title}</div>
            <div className="meta">
              {[it.people.map((p) => p.name).join(', '), ev.location].filter(Boolean).join(' · ')}
            </div>
          </div>
          <span className="avatars">{it.people.slice(0, 3).map((p) => <Avatar key={p.id} p={p} size="sm" />)}</span>
        </div>
        {(ev.status !== 'planned' || ev.rrule || ev.needs_confirmation) && (
          <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
            {it.occ.cancelled && <span className="tag clay">Cancelled</span>}
            {ev.status === 'tentative' && <span className="tag amber">Tentative</span>}
            {ev.needs_confirmation && !it.occ.cancelled && <span className="tag amber">To confirm</span>}
            {ev.rrule && <span className="tag"><IRepeat className="" />&nbsp;{describeRule(ev.rrule)}</span>}
          </div>
        )}
        {!it.occ.cancelled && !compact && (
          <div className="facts">
            {it.needsTransport && (
              <>
                <div className="fact"><IClock />
                  <span>{it.leaveAt ? <>Leave <b>{fmtTime(it.leaveAt, tz)}</b> · {travelNote(it)}</> : <>Leave time unknown · {travelNote(it)}</>}</span>
                </div>
                <div className={`fact ${it.vehicle ? '' : 'bad'}`}><ICar />
                  <span>{it.vehicle ? <><b>{it.vehicle.name}</b>{it.selfDrive ? ' · you drive' : it.driver ? ` · ${it.driver.name}` : ' · no driver set'} · {MODE_LABEL[ev.transport_mode]}</> : <>Car not arranged · {MODE_LABEL[ev.transport_mode]}</>}</span>
                </div>
              </>
            )}
            {ev.transport_mode === 'self' && <div className="fact"><ICar /><span>Going on their own</span></div>}
            {it.getReadyAt && <div className="fact"><IClock /><span>Start getting ready {fmtTime(it.getReadyAt, tz)}</span></div>}
            {(it.carry.length > 0 || it.tasksBefore.length > 0) && (
              <div className="fact"><IBag /><span>
                {[...it.tasksBefore.map((t) => t.title), ...it.carry.map((c) => c.text)].join(' · ')}
              </span></div>
            )}
            {it.nextForCar && <div className="fact"><IPin /><span>{it.nextForCar}</span></div>}
            {conflicts.map((c) => <div key={c.id} className="fact bad"><IAlert /><span>{c.message}</span></div>)}
            {warns.slice(0, 2).map((c) => <div key={c.id} className="fact warn"><IAlert /><span>{c.message}</span></div>)}
          </div>
        )}
        {compact && !it.occ.cancelled && (it.leaveAt || conflicts.length > 0) && (
          <div className="facts">
            {it.leaveAt && <div className="fact"><ICar /><span>Leave {fmtTime(it.leaveAt, tz)}{it.vehicle ? ` · ${it.vehicle.name}` : ''}</span></div>}
            {conflicts.length > 0 && <div className="fact bad"><IAlert /><span>{conflicts.length === 1 ? conflicts[0].message : `${conflicts.length} problems`}</span></div>}
          </div>
        )}
        {!compact && it.tasksBefore.some((t) => t.source === 'suggested') && <div className="fact" style={{ marginTop: 4 }}><ITasks /><span className="muted small">Has suggested prep tasks</span></div>}
      </div>
    </div>
  );
}

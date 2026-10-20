import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore, useData, useToday } from '../lib/store';
import { Banner, Chips, Empty, Q, Sheet, uid } from '../ui/kit';
import { IBell, IPlus } from '../ui/icons';
import { addDays, localParts, zonedToUtc } from '@engine/time.ts';
import type { ReminderRow } from '@engine/types.ts';
import { BackTo } from './More';
import { dayLabel, fmtTime, timeLabel } from '../lib/format';
import { pushState, enablePush, type PushState } from '../lib/push';
import { enableLocalNotify, localNotifyState, type LocalNotifyState } from '../lib/localNotify';
import { toast } from '../lib/toast';

export function LocalNotifyPrompt() {
  const [st, setSt] = useState<LocalNotifyState>(() => localNotifyState());
  if (st === 'on') return <Banner kind="ok">Notifications are on. They appear while Daybook is open — in a browser tab or from your Home Screen. For alerts even when it's closed, see Settings → Phone calendar.</Banner>;
  if (st === 'denied') return <Banner>Notifications are blocked for this site. Allow them in your browser or phone settings, then reload.</Banner>;
  if (st === 'unsupported') return <Banner>This browser can't show notifications. On iPhone: Share → Add to Home Screen, then open Daybook from the Home Screen.</Banner>;
  return (
    <Banner kind="info">
      <div>Get a notification when it's time to leave, and before each plan.</div>
      <button className="btn primary" style={{ marginTop: 8 }} onClick={async () => { try { await enableLocalNotify(); setSt('on'); } catch (e) { toast((e as Error).message, 'error'); } }}><IBell />Turn on notifications</button>
    </Banner>
  );
}

export function PushPrompt({ compact }: { compact?: boolean }) {
  const { demo } = useStore();
  if (demo) return <LocalNotifyPrompt />;
  return <ServerPushPrompt compact={compact} />;
}

function ServerPushPrompt({ compact }: { compact?: boolean }) {
  const [st, setSt] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { pushState().then(setSt); }, []);
  if (!st || st === 'on') return null;
  if (st === 'needs-install') return <Banner kind="info"><b>To get reminders on this iPhone/iPad:</b> tap the Share button in Safari → <b>Add to Home Screen</b>, then open Daybook from the Home Screen and turn on notifications in Settings.</Banner>;
  if (st === 'not-configured') return compact ? null : <Banner>Notifications aren't set up on the server yet (see the setup guide). Reminders still show here and on the home screen.</Banner>;
  if (st === 'unsupported') return compact ? null : <Banner>This browser can't show notifications. Use Safari on iPhone (added to Home Screen) or Chrome.</Banner>;
  if (st === 'denied') return <Banner>Notifications are blocked for Daybook. Allow them in your phone's Settings → Notifications (or the browser's site settings).</Banner>;
  return (
    <Banner kind="info">
      <div>Turn on notifications so reminders reach you even when Daybook is closed.</div>
      <button className="btn primary" style={{ marginTop: 8 }} disabled={busy} onClick={async () => {
        setBusy(true);
        try { await enablePush(); setSt('on'); toast('Notifications are on for this device'); } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
      }}><IBell />Turn on notifications</button>
    </Banner>
  );
}

export function Reminders() {
  const { save, remove, canEdit } = useStore();
  const data = useData();
  const { today, tz, now } = useToday();
  const nav = useNavigate();
  const [adding, setAdding] = useState(false);
  const [resched, setResched] = useState<ReminderRow | null>(null);
  const pending = data.reminders.filter((r) => r.status === 'pending').sort((a, b) => a.fire_at.localeCompare(b.fire_at));
  const recent = data.reminders.filter((r) => r.status === 'sent' && Date.parse(r.fire_at) > now.getTime() - 2 * 86400_000).sort((a, b) => b.fire_at.localeCompare(a.fire_at));
  const groups = new Map<string, ReminderRow[]>();
  for (const r of pending) { const d = localParts(r.fire_at, tz).date; groups.set(d, [...(groups.get(d) ?? []), r]); }
  const snooze = (r: ReminderRow, at: Date, label: string) => save('reminders', { id: r.id, fire_at: at.toISOString(), status: 'pending', user_modified: true }, { message: label });
  const Row = ({ r }: { r: ReminderRow }) => (
    <div className="task">
      <IBell className="" />
      <div className="grow">
        <div className="title" onClick={() => r.ref_type === 'event' && r.ref_id && nav(`/?event=${r.ref_id}&date=${r.occurrence_date}`)} style={{ cursor: r.ref_type === 'event' ? 'pointer' : 'default' }}>{r.title}</div>
        <div className="small muted">{fmtTime(r.fire_at, tz)}{r.body ? ` · ${r.body}` : ''}{r.user_modified ? ' · changed by you' : ''}</div>
        {canEdit && (
          <div className="task-actions">
            <button className="chip" onClick={() => snooze(r, new Date(Math.max(Date.now(), Date.parse(r.fire_at)) + 10 * 60000), 'Snoozed 10 min')}>+10 min</button>
            <button className="chip" onClick={() => snooze(r, new Date(Math.max(Date.now(), Date.parse(r.fire_at)) + 60 * 60000), 'Snoozed 1 hour')}>+1 hour</button>
            <button className="chip" onClick={() => setResched(r)}>Change time</button>
            <button className="chip" onClick={() => r.origin === 'manual' ? remove('reminders', r.id, { message: 'Removed' }) : save('reminders', { id: r.id, status: 'done' }, { message: 'Marked done' })}>Done</button>
          </div>
        )}
      </div>
    </div>
  );
  return (
    <div className="page">
      <BackTo />
      <div className="page-head"><h1>Reminders</h1>{canEdit && <button className="btn" onClick={() => setAdding(true)}><IPlus />Add</button>}</div>
      <PushPrompt />
      <p className="small muted">Reminders are made automatically from your plans and tasks, and move when plans change. Related reminders at the same moment arrive as one notification.</p>
      {pending.length === 0 && <Empty title="No reminders scheduled" />}
      {[...groups].map(([d, list]) => (
        <div key={d} className="section"><div className="section-title">{dayLabel(d, today)}</div>{list.map((r) => <Row key={r.id} r={r} />)}</div>
      ))}
      {recent.length > 0 && <div className="section"><div className="section-title">Recently sent</div>{recent.map((r) => <Row key={r.id} r={r} />)}</div>}
      {adding && <ReminderSheet onClose={() => setAdding(false)} />}
      {resched && <ReminderSheet existing={resched} onClose={() => setResched(null)} />}
    </div>
  );
}

function ReminderSheet({ existing, onClose }: { existing?: ReminderRow; onClose: () => void }) {
  const { save } = useStore();
  const { today, tz } = useToday();
  const [title, setTitle] = useState(existing?.title ?? '');
  const [date, setDate] = useState(existing ? localParts(existing.fire_at, tz).date : today);
  const [time, setTime] = useState(existing ? localParts(existing.fire_at, tz).time : '18:00');
  const at = zonedToUtc(date, time, tz);
  const submit = async () => {
    if (existing) { if (await save('reminders', { id: existing.id, fire_at: at.toISOString(), status: 'pending', user_modified: true }, { message: 'Reminder moved' })) onClose(); return; }
    const id = uid();
    if (await save('reminders', { id, ref_type: 'custom', kind: 'custom', origin: 'manual', title: title.trim(), fire_at: at.toISOString(), dedupe_key: `manual:${id}` }, { message: 'Reminder set' })) onClose();
  };
  return (
    <Sheet title={existing ? 'Change reminder time' : 'New reminder'} onClose={onClose} footer={<button className="btn primary" disabled={(!existing && !title.trim()) || at < new Date()} onClick={submit}>Save</button>}>
      {!existing && <Q label="Remind me to…"><input className="input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Call the plumber" /></Q>}
      <Q label="Day"><Chips scroll options={[0, 1, 2, 3, 4, 5, 6].map((n) => ({ label: dayLabel(addDays(today, n), today), value: addDays(today, n) }))} value={date} onChange={setDate} /></Q>
      <Q label="Time" hint={timeLabel(time)}>
        <Chips scroll options={['07:00', '08:00', '09:00', '10:00', '12:00', '14:00', '16:00', '18:00', '19:00', '20:00', '21:00'].map((t) => ({ label: timeLabel(t), value: t }))} value={time} onChange={setTime} />
        <label className="chip dashed" style={{ position: 'relative', marginTop: 8 }}>Exact time<input type="time" value={time} onChange={(e) => e.target.value && setTime(e.target.value)} style={{ position: 'absolute', inset: 0, opacity: 0 }} /></label>
      </Q>
      {at < new Date() && <p className="small" style={{ color: 'var(--clay)' }}>That time has already passed.</p>}
    </Sheet>
  );
}

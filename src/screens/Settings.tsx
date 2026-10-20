import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useStore, useData } from '../lib/store';
import { supabase, callFn } from '../lib/supabase';
import { Banner, Chips, MultiChips, Q, Sheet } from '../ui/kit';
import { BackTo } from './More';
import { PushPrompt } from './Reminders';
import { disablePush, pushState, testPush, isIOS, isStandalone, type PushState } from '../lib/push';
import { toast } from '../lib/toast';
import { timeLabel } from '../lib/format';
import { localParts } from '@engine/time.ts';
import { formatRule, parseRule } from '@engine/recurrence.ts';

const ZONES = ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Australia/Sydney'];

export function Settings() {
  const { save, me, canEdit, householdId, households, setHouseholdId, maps, reload, session, demo } = useStore();
  const data = useData();
  const hh = data.household;
  const [params, setParams] = useSearchParams();
  const [form, setForm] = useState({ name: hh.name, home_label: hh.home_label, home_address: hh.home_address ?? '', timezone: hh.timezone });
  const [push, setPush] = useState<PushState | null>(null);
  const [gcal, setGcal] = useState<{ connected: boolean; google_email?: string; last_sync_at?: string; last_error?: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const owner = me?.role === 'owner';
  const deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  useEffect(() => { pushState().then(setPush); }, []);
  const loadG = () => supabase.rpc('gcal_status', { h: householdId }).then(({ data }) => setGcal(data ?? { connected: false }));
  useEffect(() => { loadG(); }, [householdId]); // eslint-disable-line
  useEffect(() => {
    const g = params.get('gcal');
    if (!g) return;
    ({ connected: () => toast('Google Calendar connected'), cancelled: () => toast('Google sign-in was cancelled', 'error'), expired: () => toast('That took too long — please try connecting again', 'error'), error: () => toast("Google didn't allow the connection — please try again", 'error') } as Record<string, () => void>)[g]?.();
    params.delete('gcal'); setParams(params, { replace: true }); loadG();
  }, []); // eslint-disable-line

  const saveHH = (p: Record<string, unknown>, msg = 'Saved') => save('households', { id: hh.id, ...p }, { message: msg });
  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    try { await fn(); if (ok) toast(ok); } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(null); }
  };

  return (
    <div className="page">
      <BackTo />
      <div className="page-head"><h1>Settings</h1></div>
      {demo && <Banner kind="info">This is the demo. Notifications, Google Calendar, email, sharing and Google Maps travel times work once the database is connected. Drives here use a rough 30-minute default.</Banner>}

      {canEdit && (
        <div className="section">
          <div className="section-title">Home</div>
          <Q label="Family name"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Q>
          <Q label="Home address" hint="used to work out travel times"><textarea className="input" value={form.home_address} placeholder="Building, street, area, city" onChange={(e) => setForm({ ...form, home_address: e.target.value })} /></Q>
          <Q label="Time zone">
            <select className="input" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })}>
              {[...new Set([form.timezone, deviceTz, ...ZONES])].map((z) => <option key={z} value={z}>{z.replace('_', ' ')}{z === deviceTz ? ' (this device)' : ''}</option>)}
            </select>
          </Q>
          <button className="btn primary" style={{ marginTop: 12 }} disabled={!form.name.trim()} onClick={() => saveHH({ ...form, home_address: form.home_address.trim() || null })}>Save home details</button>
        </div>
      )}

      {canEdit && (
        <div className="section">
          <div className="section-title">Travel & reminders</div>
          <Q label="Extra time for traffic and delays" hint="added to every drive">
            <Chips options={[0, 10, 15, 20, 30, 45].map((m) => ({ label: m ? `${m} min` : 'None', value: String(m) }))} value={String(hh.traffic_buffer_min)} onChange={(v) => saveHH({ traffic_buffer_min: +v })} />
          </Q>
          <Q label="If maps can't be reached, assume a drive takes…">
            <Chips options={[{ label: "Don't assume — leave it blank", value: '' }, ...[20, 30, 45, 60].map((m) => ({ label: `${m} min`, value: String(m) }))]} value={hh.fallback_travel_min ? String(hh.fallback_travel_min) : ''} onChange={(v) => saveHH({ fallback_travel_min: v ? +v : null })} />
            <p className="small muted" style={{ margin: '6px 0 0' }}>Times using this are always marked “rough default”.</p>
          </Q>
          <Q label="Default reminders for new plans">
            <MultiChips options={[{ label: '1 day before', value: '1440' }, { label: '3 hours', value: '180' }, { label: '1 hour', value: '60' }, { label: '30 min', value: '30' }]} value={hh.default_reminders.map(String)} onChange={(v) => saveHH({ default_reminders: v.map(Number) })} />
          </Q>
          <Q label="Remind me before it's time to leave">
            <Chips options={[10, 15, 20, 30, 45].map((m) => ({ label: `${m} min before`, value: String(m) }))} value={String(hh.leave_reminder_min)} onChange={(v) => saveHH({ leave_reminder_min: +v })} />
          </Q>
          <div style={{ marginTop: 14 }}>
            {maps.status === 'ok' && <Banner kind="ok">Travel times come from Google Maps with traffic.</Banner>}
            {maps.status === 'off' && <Banner kind="info">Google Maps isn't set up on the server, so travel times aren't calculated. You can still type a usual travel time on each plan. (Setup: add a GOOGLE_MAPS_API_KEY — see the setup guide.)</Banner>}
            {maps.status === 'error' && <Banner>Google Maps returned an error: {maps.error}</Banner>}
            {!hh.home_address && <Banner>Add your home address above so drives from home can be worked out.</Banner>}
          </div>
        </div>
      )}

      <div className="section">
        <div className="section-title">Notifications on this device</div>
        <PushPrompt />
        {push === 'on' && (
          <div className="row wrap" style={{ marginTop: 10 }}>
            <span className="tag sage">On</span>
            <button className="btn" disabled={busy === 'test'} onClick={() => run('test', async () => { const r = await testPush(); if (!r.devices) throw new Error("No device received it — try turning notifications off and on again"); }, 'Test sent — check your notifications')}>Send a test</button>
            <button className="btn ghost" onClick={() => run('off', async () => { await disablePush(); setPush('off'); }, 'Notifications off for this device')}>Turn off</button>
          </div>
        )}
      </div>

      {me && me.role !== 'limited' && (
        <div className="section">
          <div className="section-title">Morning email</div>
          <label className="check"><input type="checkbox" checked={me.email_summary} onChange={(e) => save('household_members', { household_id: me.household_id, user_id: me.user_id, email_summary: e.target.checked }, { message: e.target.checked ? 'Daily email on' : 'Daily email off' })} />Email me the day's plan each morning ({me.email})</label>
          {me.email_summary && <Q label="Send it at"><Chips scroll options={[5, 6, 7, 8, 9].map((h) => ({ label: timeLabel(`${String(h).padStart(2, '0')}:00`), value: String(h) }))} value={String(me.summary_hour)} onChange={(v) => save('household_members', { household_id: me.household_id, user_id: me.user_id, summary_hour: +v })} /></Q>}
          <button className="btn" style={{ marginTop: 10 }} disabled={busy === 'mail'} onClick={() => run('mail', () => callFn('email', { action: 'summary_test', household_id: householdId }), `Sent to ${me.email}`)}>Send today's summary now</button>
          <Q label="Your name"><input className="input" defaultValue={me.display_name ?? ''} onBlur={(e) => e.target.value !== (me.display_name ?? '') && save('household_members', { household_id: me.household_id, user_id: me.user_id, display_name: e.target.value || null })} /></Q>
        </div>
      )}

      {canEdit && (
        <div className="section">
          <div className="section-title">Google Calendar</div>
          {gcal?.connected ? (
            <>
              <p>Plans are copied to a <b>“{hh.name} · Daybook”</b> calendar in {gcal.google_email ?? 'your Google account'}. Changes here update it automatically; it never edits your other calendars.</p>
              <p className="small muted">{gcal.last_sync_at ? `Last updated ${new Date(gcal.last_sync_at).toLocaleString('en-IN')}` : 'Not synced yet'}</p>
              {gcal.last_error && <Banner kind="bad">{gcal.last_error}</Banner>}
              <div className="row wrap">
                <button className="btn" disabled={busy === 'gsync'} onClick={() => run('gsync', async () => { const r = await callFn<{ pushed: number; deleted: number }>('gcal', { action: 'sync', household_id: householdId }); toast(`Updated ${r.pushed} plan${r.pushed === 1 ? '' : 's'}`); await loadG(); })}>Sync now</button>
                <button className="btn ghost" onClick={() => confirm('Stop copying plans to Google Calendar?') && run('gdis', async () => { await callFn('gcal', { action: 'disconnect', household_id: householdId }); await loadG(); }, 'Disconnected')}>Disconnect</button>
              </div>
            </>
          ) : (
            <>
              <p className="ink2">Copy every plan into its own Google Calendar so it shows on any phone or computer.</p>
              <button className="btn" disabled={busy === 'gc'} onClick={() => run('gc', async () => { const r = await callFn<{ url: string }>('gcal', { action: 'start', household_id: householdId }); location.href = r.url; })}>Connect Google Calendar</button>
            </>
          )}
        </div>
      )}

      <div className="section">
        <div className="section-title"><span>Who can see this</span>{owner && <button className="btn ghost" onClick={() => setInviting(true)}>Invite</button>}</div>
        {data.members.map((m) => (
          <div key={m.user_id} className="item" style={{ cursor: 'default' }}>
            <div className="grow">
              <div className="title">{m.display_name || m.email}{m.user_id === session?.user.id ? ' (you)' : ''}</div>
              <div className="sub">{m.role === 'owner' ? 'Owner' : m.role === 'editor' ? 'Can see and change everything' : `Sees only ${data.people.find((p) => p.id === m.person_id)?.name ?? data.drivers.find((d) => d.id === m.driver_id)?.name ?? 'their own'} plans`}</div>
            </div>
            {owner && m.user_id !== session?.user.id && <button className="btn ghost" onClick={async () => { if (confirm(`Remove ${m.email}?`)) { const { error } = await supabase.from('household_members').delete().eq('household_id', m.household_id).eq('user_id', m.user_id); if (error) toast(error.message, 'error'); else { toast('Removed'); reload(); } } }}>Remove</button>}
          </div>
        ))}
        {data.invites.filter((i) => !i.accepted_at).map((i) => (
          <div key={i.id} className="item" style={{ cursor: 'default' }}>
            <div className="grow"><div className="title">{i.email}</div><div className="sub">Invited · joins when they sign up with this email</div></div>
            {owner && <button className="btn ghost" onClick={async () => { const { error } = await supabase.from('invites').delete().eq('id', i.id); if (!error) { toast('Invite cancelled'); reload(); } }}>Cancel</button>}
          </div>
        ))}
      </div>

      {canEdit && (
        <div className="section">
          <div className="section-title">Sample data</div>
          <p className="small muted">Load a few realistic plans to see how Daybook works. Sample items are labelled and can be removed in one tap without touching anything you added.</p>
          <div className="row wrap">
            <button className="btn" disabled={!!busy} onClick={() => run('seed', async () => { const { error } = await supabase.rpc('seed_sample', { h: householdId }); if (error) throw error; await reload(); }, 'Sample data added')}>Add sample data</button>
            <button className="btn" disabled={!!busy} onClick={() => confirm('Remove all sample people, plans and tasks?') && run('unseed', async () => { const { error } = await supabase.rpc('remove_sample', { h: householdId }); if (error) throw error; await reload(); }, 'Sample data removed')}>Remove sample data</button>
          </div>
        </div>
      )}

      <div className="section">
        <div className="section-title">Backup</div>
        <div className="row wrap">
          <button className="btn" onClick={() => exportJson(data)}>Download everything (.json)</button>
          <button className="btn" onClick={() => exportIcs(data)}>Download calendar (.ics)</button>
        </div>
        <p className="small muted">Your data is stored securely online and syncs across devices; these files are an extra copy.</p>
      </div>

      {!isStandalone() && (
        <div className="section">
          <div className="section-title">Install on your phone</div>
          <p className="ink2">{isIOS() ? 'In Safari, tap the Share button, then “Add to Home Screen”.' : 'In Chrome, open the menu and choose “Install app” or “Add to Home screen”.'} Daybook will open like a normal app.</p>
        </div>
      )}

      <div className="section">
        <div className="section-title">Account</div>
        {households.length > 1 && <Q label="Switch family"><Chips options={households.map((h) => ({ label: h.name, value: h.id }))} value={householdId} onChange={setHouseholdId} /></Q>}
        <p className="small muted">Signed in as {session?.user.email}</p>
        <button className="btn" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </div>
      {inviting && <InviteSheet onClose={() => setInviting(false)} />}
    </div>
  );
}

function InviteSheet({ onClose }: { onClose: () => void }) {
  const { reload, householdId } = useStore();
  const data = useData();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'editor' | 'limited'>('editor');
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const valid = /^\S+@\S+\.\S+$/.test(email) && (role === 'editor' || link);
  const submit = async () => {
    setBusy(true);
    const person = data.people.find((p) => p.id === link), driver = data.drivers.find((d) => d.id === link);
    const { data: inv, error } = await supabase.from('invites').insert({ household_id: householdId, email: email.trim().toLowerCase(), role, person_id: person?.id ?? null, driver_id: driver?.id ?? null }).select().single();
    if (error) { toast(error.code === '23505' ? 'That email is already invited' : error.message, 'error'); setBusy(false); return; }
    try { await callFn('email', { action: 'invite', invite_id: inv.id }); toast(`Invitation emailed to ${email}`); }
    catch { toast(`Invite saved. Email isn't set up, so tell ${email} to sign up at this site with that address.`); }
    await reload(); setBusy(false); onClose();
  };
  return (
    <Sheet title="Invite someone" onClose={onClose} footer={<button className="btn primary" disabled={!valid || busy} onClick={submit}>Send invite</button>}>
      <Q label="Their email"><input className="input" type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} /></Q>
      <Q label="What can they do?"><Chips options={[{ label: 'See & change everything', value: 'editor' }, { label: 'See only their own plans', value: 'limited' }]} value={role} onChange={(v) => setRole(v as 'editor' | 'limited')} /></Q>
      {role === 'limited' && <Q label="Whose plans are theirs?"><Chips options={[...data.people.map((p) => ({ label: p.name, value: p.id, dot: p.color })), ...data.drivers.map((d) => ({ label: `${d.name} (driver)`, value: d.id }))]} value={link} onChange={setLink} /></Q>}
    </Sheet>
  );
}

function download(name: string, text: string, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function exportJson(data: ReturnType<typeof useData>) {
  download(`daybook-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ exported_at: new Date().toISOString(), ...data }, null, 2), 'application/json');
}
function exportIcs(data: ReturnType<typeof useData>) {
  const tz = data.household.timezone;
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/[,;]/g, (c) => '\\' + c).replace(/\n/g, '\\n');
  const stamp = (iso: string) => { const p = localParts(iso, tz); return `${p.date.replace(/-/g, '')}T${p.time.replace(':', '')}00`; };
  const names = new Map(data.people.map((p) => [p.id, p.name]));
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Daybook//EN', `X-WR-CALNAME:${esc(data.household.name)}`];
  for (const e of data.events) {
    if (e.status === 'cancelled') continue;
    const who = e.person_ids.map((p) => names.get(p)).filter(Boolean).join(', ');
    lines.push('BEGIN:VEVENT', `UID:${e.id}@daybook`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
      e.all_day ? `DTSTART;VALUE=DATE:${localParts(e.start_at, tz).date.replace(/-/g, '')}` : `DTSTART;TZID=${tz}:${stamp(e.start_at)}`,
      e.all_day ? `DTEND;VALUE=DATE:${localParts(e.end_at, tz).date.replace(/-/g, '')}` : `DTEND;TZID=${tz}:${stamp(e.end_at)}`,
      `SUMMARY:${esc(who ? `${e.title} · ${who}` : e.title)}`);
    if (e.location) lines.push(`LOCATION:${esc(e.location)}`);
    if (e.notes) lines.push(`DESCRIPTION:${esc(e.notes)}`);
    const r = parseRule(e.rrule);
    if (r) lines.push('RRULE:' + formatRule(r).replace(/UNTIL=(\d{8})/, 'UNTIL=$1T235959Z'));
    for (const x of e.exdates ?? []) lines.push(`EXDATE;TZID=${tz}:${x.replace(/-/g, '')}T${stamp(e.start_at).slice(9)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  download('daybook.ics', lines.join('\r\n'), 'text/calendar');
}

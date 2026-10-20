// Google Calendar sync: Daybook creates its own "Family plans" calendar in the user's Google account
// and keeps it in step (one-way: Daybook → Google). It uses the narrow calendar.app.created scope, so it
// can only touch calendars it created. Event ids are derived from Daybook ids, so retries never duplicate.
//
//  POST {action:'start', household_id}  → {url}  (send the user there)
//  GET  ?code&state                      ← Google redirects back here
//  POST {action:'sync', household_id}    sync now
//  POST {action:'disconnect', household_id}
//  cron POST {action:'sync_all'}
import { admin, APP_URL, env, handler, HttpError, isCron, json, memberRole, requireUser } from '../_shared/server.ts';
import { parseRule, formatRule } from '../_shared/engine/recurrence.ts';
import { localParts } from '../_shared/engine/time.ts';

const SCOPES = 'openid email https://www.googleapis.com/auth/calendar.app.created';
const API = 'https://www.googleapis.com/calendar/v3';
const redirectUri = () => `${env('SUPABASE_URL')}/functions/v1/gcal`;
const gid = (id: string) => 'db' + id.replace(/-/g, '');

Deno.serve(handler(async (req) => {
  const db = admin();
  const url = new URL(req.url);

  if (req.method === 'GET' && url.searchParams.has('state')) return callback(db, url);

  const body = await req.json().catch(() => ({}));
  if (body.action === 'sync_all' && isCron(req)) {
    const { data } = await db.from('gcal_accounts').select('household_id');
    const out: Record<string, unknown> = {};
    for (const a of data ?? []) out[a.household_id] = await sync(db, a.household_id).catch((e) => String(e));
    return json(out);
  }

  const { client, user } = await requireUser(req);
  const role = await memberRole(client, body.household_id, user.id);
  if (role !== 'owner' && role !== 'editor') throw new HttpError(403, 'Only owners and editors can manage Google Calendar');
  if (!env('GOOGLE_CLIENT_ID') || !env('GOOGLE_CLIENT_SECRET')) throw new HttpError(503, 'Google Calendar is not configured on the server');

  if (body.action === 'start') {
    const state = crypto.randomUUID();
    await db.from('oauth_states').insert({ state, household_id: body.household_id, user_id: user.id });
    const p = new URLSearchParams({ client_id: env('GOOGLE_CLIENT_ID'), redirect_uri: redirectUri(), response_type: 'code',
      scope: SCOPES, access_type: 'offline', prompt: 'consent', state, login_hint: user.email ?? '' });
    return json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${p}` });
  }
  if (body.action === 'sync') return json(await sync(db, body.household_id));
  if (body.action === 'disconnect') {
    const { data: acc } = await db.from('gcal_accounts').select('refresh_token').eq('household_id', body.household_id).maybeSingle();
    if (acc) await fetch(`https://oauth2.googleapis.com/revoke?token=${acc.refresh_token}`, { method: 'POST' }).catch(() => {});
    await db.from('gcal_accounts').delete().eq('household_id', body.household_id);
    await db.from('events').update({ gcal_event_id: null }).eq('household_id', body.household_id);
    return json({ ok: true });
  }
  throw new HttpError(400, 'Unknown action');
}));

async function callback(db: ReturnType<typeof admin>, url: URL) {
  const back = (q: string) => Response.redirect(`${APP_URL()}/more/settings?gcal=${q}`, 302);
  const { data: st } = await db.from('oauth_states').delete().eq('state', url.searchParams.get('state')!).select().maybeSingle();
  if (!st || Date.now() - new Date(st.created_at).getTime() > 15 * 60000) return back('expired');
  const code = url.searchParams.get('code');
  if (!code) return back('cancelled');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: env('GOOGLE_CLIENT_ID'), client_secret: env('GOOGLE_CLIENT_SECRET'), redirect_uri: redirectUri(), grant_type: 'authorization_code' }),
  });
  const tok = await r.json();
  if (!r.ok || !tok.refresh_token) return back('error');
  let email: string | null = null;
  try { email = JSON.parse(atob(tok.id_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).email; } catch { /* optional */ }
  await db.from('gcal_accounts').upsert({ household_id: st.household_id, user_id: st.user_id, google_email: email,
    refresh_token: tok.refresh_token, calendar_id: null, connected_at: new Date().toISOString(), last_sync_at: null, last_error: null });
  try { await sync(db, st.household_id); } catch { /* status is recorded in last_error */ }
  return back('connected');
}

async function accessToken(refresh: string) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ refresh_token: refresh, client_id: env('GOOGLE_CLIENT_ID'), client_secret: env('GOOGLE_CLIENT_SECRET'), grant_type: 'refresh_token' }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error === 'invalid_grant' ? 'Google access was removed — please reconnect' : `Google sign-in failed: ${j.error}`);
  return j.access_token as string;
}

async function sync(db: ReturnType<typeof admin>, householdId: string) {
  const { data: acc } = await db.from('gcal_accounts').select('*').eq('household_id', householdId).maybeSingle();
  if (!acc) throw new HttpError(400, 'Google Calendar is not connected');
  const startedAt = new Date().toISOString();
  try {
    const token = await accessToken(acc.refresh_token);
    const g = (path: string, init: RequestInit = {}) => fetch(API + path, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
    const { data: hh } = await db.from('households').select('timezone,name').eq('id', householdId).single();
    const tz = hh!.timezone;

    let cal = acc.calendar_id;
    if (cal && (await g(`/calendars/${encodeURIComponent(cal)}`)).status === 404) cal = null;
    if (!cal) {
      const r = await g('/calendars', { method: 'POST', body: JSON.stringify({ summary: `${hh!.name} · Daybook`, timeZone: tz }) });
      const j = await r.json();
      if (!r.ok) throw new Error(`Couldn't create calendar: ${j.error?.message}`);
      cal = j.id;
      await db.from('gcal_accounts').update({ calendar_id: cal }).eq('household_id', householdId);
      acc.last_sync_at = null; // new calendar: push everything
    }
    const calPath = `/calendars/${encodeURIComponent(cal!)}/events`;

    const [{ data: events }, { data: people }] = await Promise.all([
      db.from('events').select('*').eq('household_id', householdId),
      db.from('people').select('id,name').eq('household_id', householdId),
    ]);
    const names = new Map((people ?? []).map((p) => [p.id, p.name]));
    let pushed = 0, deleted = 0;
    const changed = (events ?? []).filter((e) => !acc.last_sync_at || e.updated_at > acc.last_sync_at || !e.gcal_event_id);
    for (const e of changed) {
      const id = gid(e.id);
      if (e.status === 'cancelled') {
        const r = await g(`${calPath}/${id}`, { method: 'DELETE' });
        if (r.ok || r.status === 404 || r.status === 410) deleted++;
        continue;
      }
      const who = (e.person_ids as string[]).map((p) => names.get(p)).filter(Boolean).join(', ');
      const transport = { drop: 'Drop', drop_pickup: 'Drop & pick up', wait: 'Car waits', self: 'Going on their own', none: '' }[e.transport_mode as string];
      const s = localParts(e.start_at, tz), en = localParts(e.end_at, tz);
      const rule = parseRule(e.rrule);
      const ev = {
        id, summary: who ? `${e.title} · ${who}` : e.title, location: e.location ?? undefined,
        description: [transport, e.notes, (e.checklist as { text: string }[]).length ? 'Carry: ' + (e.checklist as { text: string }[]).map((c) => c.text).join(', ') : ''].filter(Boolean).join('\n'),
        start: e.all_day ? { date: s.date } : { dateTime: `${s.date}T${s.time}:00`, timeZone: tz },
        end: e.all_day ? { date: en.date } : { dateTime: `${en.date}T${en.time}:00`, timeZone: tz },
        recurrence: rule ? [
          'RRULE:' + formatRule(rule).replace(/UNTIL=(\d{8})/, 'UNTIL=$1T235959Z'),
          ...((e.exdates as string[]) ?? []).map((d) => `EXDATE;TZID=${tz}:${d.replace(/-/g, '')}T${s.time.replace(':', '')}00`),
        ] : undefined,
        status: e.status === 'tentative' ? 'tentative' : 'confirmed',
      };
      let r = await g(`${calPath}/${id}`, { method: 'PUT', body: JSON.stringify(ev) });
      if (r.status === 404) r = await g(calPath, { method: 'POST', body: JSON.stringify(ev) });
      if (!r.ok) throw new Error(`Google rejected "${e.title}": ${(await r.json()).error?.message}`);
      if (e.gcal_event_id !== id) await db.from('events').update({ gcal_event_id: id }).eq('id', e.id).eq('updated_at', e.updated_at);
      pushed++;
    }
    // remove Google copies of events deleted in Daybook
    const live = new Set((events ?? []).filter((e) => e.status !== 'cancelled').map((e) => gid(e.id)));
    let pageToken = '';
    do {
      const r = await g(`${calPath}?maxResults=2500&fields=items(id),nextPageToken${pageToken ? '&pageToken=' + pageToken : ''}`);
      const j = await r.json();
      for (const it of j.items ?? []) if (it.id.startsWith('db') && !live.has(it.id)) { await g(`${calPath}/${it.id}`, { method: 'DELETE' }); deleted++; }
      pageToken = j.nextPageToken ?? '';
    } while (pageToken);

    await db.from('gcal_accounts').update({ last_sync_at: startedAt, last_error: null }).eq('household_id', householdId);
    return { pushed, deleted };
  } catch (e) {
    await db.from('gcal_accounts').update({ last_error: e instanceof Error ? e.message : String(e) }).eq('household_id', householdId);
    throw e;
  }
}

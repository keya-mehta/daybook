// Runs every minute (pg_cron). Claims due reminders atomically so nothing is sent twice,
// groups them per person, and sends Web Push notifications to every device they've enabled.
// POST { test: true } as a signed-in user sends a test notification to that user's devices.
import webpush from 'npm:web-push@3.6.7';
import { admin, env, handler, HttpError, isCron, json, requireUser, APP_URL } from '../_shared/server.ts';

const STALE_MS = 6 * 3600_000; // don't push things that were due hours ago (e.g. after an outage)

Deno.serve(handler(async (req) => {
  const pub = env('VAPID_PUBLIC_KEY'), priv = env('VAPID_PRIVATE_KEY');
  if (!pub || !priv) throw new HttpError(503, 'Push notifications are not configured on the server (VAPID keys missing)');
  webpush.setVapidDetails(env('VAPID_SUBJECT') || 'mailto:admin@example.com', pub, priv);
  const db = admin();
  const body = await req.json().catch(() => ({}));

  if (body.test) {
    const { user } = await requireUser(req);
    const sent = await sendTo(db, [user.id], { title: 'Notifications are working', body: 'Daybook reminders will arrive like this.', url: '/' });
    return json({ devices: sent.ok, failed: sent.failed });
  }
  if (!isCron(req)) throw new HttpError(401, 'Not allowed');

  const now = Date.now();
  // claim: pending → sent in one statement; concurrent runs can't both claim a row
  const { data: due, error } = await db.from('reminders')
    .update({ status: 'sent', sent_at: new Date(now).toISOString() })
    .eq('status', 'pending').lte('fire_at', new Date(now).toISOString())
    .select('*');
  if (error) throw error;
  if (!due?.length) return json({ sent: 0 });

  const fresh = due.filter((r) => now - new Date(r.fire_at).getTime() < STALE_MS);
  // recipients: the target user, or every owner/editor in the household
  const households = [...new Set(fresh.map((r) => r.household_id))];
  const { data: members } = households.length
    ? await db.from('household_members').select('household_id,user_id,role').in('household_id', households)
    : { data: [] };
  const perUser = new Map<string, typeof fresh>();
  for (const r of fresh) {
    const users = r.target_user_id ? [r.target_user_id]
      : (members ?? []).filter((m) => m.household_id === r.household_id && m.role !== 'limited').map((m) => m.user_id);
    for (const u of users) perUser.set(u, [...(perUser.get(u) ?? []), r]);
  }

  let ok = 0, failed = 0;
  for (const [userId, list] of perUser) {
    list.sort((a, b) => a.fire_at.localeCompare(b.fire_at));
    const leave = list.find((r) => r.kind === 'leave');
    const payload = list.length === 1
      ? { title: list[0].title, body: list[0].body ?? '', url: link(list[0]), tag: list[0].dedupe_key }
      : { title: leave ? leave.title : `${list.length} reminders`, url: '/reminders', tag: `group:${list[0].id}`,
          body: list.filter((r) => r !== leave).map((r) => `• ${r.title}`).join('\n') };
    const res = await sendTo(db, [userId], payload);
    ok += res.ok; failed += res.failed;
  }
  return json({ claimed: due.length, sent: ok, failed, skipped_stale: due.length - fresh.length });
}));

function link(r: { ref_type: string; ref_id: string | null; occurrence_date: string | null }) {
  if (r.ref_type === 'event' && r.ref_id) return `/event/${r.ref_id}${r.occurrence_date ? `?date=${r.occurrence_date}` : ''}`;
  if (r.ref_type === 'task') return '/tasks';
  return '/reminders';
}

async function sendTo(db: ReturnType<typeof admin>, userIds: string[], payload: Record<string, unknown>) {
  const { data: subs } = await db.from('push_subscriptions').select('*').in('user_id', userIds);
  let ok = 0, failed = 0;
  await Promise.all((subs ?? []).map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ ...payload, url: APP_URL() + (payload.url ?? '/') }), { TTL: 3600, urgency: 'high' });
      ok++;
      await db.from('push_subscriptions').update({ last_ok_at: new Date().toISOString() }).eq('id', s.id);
    } catch (e) {
      failed++;
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await db.from('push_subscriptions').delete().eq('id', s.id); // device unsubscribed
      else console.error('push failed', code, e);
    }
  }));
  return { ok, failed };
}

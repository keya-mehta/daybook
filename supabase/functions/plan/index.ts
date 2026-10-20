// POST { household_id, from, to, sync? }  → the travel times the planner needs for that range
// (the app runs the same planner locally with these numbers).
// Also re-syncs reminders (in the background) when the caller can edit.
// Cron: POST { all: true } with x-cron-secret → nightly refresh of every household's reminders.
import { admin, handler, HttpError, isCron, json, memberRole, requireUser } from '../_shared/server.ts';
import { planWithTravel, syncReminders } from '../_shared/planning.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;
const background = (p: Promise<unknown>) => {
  const safe = p.catch((e) => console.error('reminder sync failed', e));
  if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(safe); else return safe;
};
const DATE = /^\d{4}-\d{2}-\d{2}$/;

Deno.serve(handler(async (req) => {
  const body = await req.json().catch(() => ({}));
  const now = new Date();
  const db = admin();

  if (isCron(req) && body.all) {
    const { data: hhs } = await db.from('households').select('id');
    const results: Record<string, unknown> = {};
    for (const h of hhs ?? []) {
      try { results[h.id] = await syncReminders(db, h.id, now); } catch (e) { results[h.id] = String(e); }
    }
    return json({ ok: true, results });
  }

  const { client, user } = await requireUser(req);
  const { household_id, from, to, sync } = body;
  if (!household_id || !DATE.test(from) || !DATE.test(to) || to < from) throw new HttpError(400, 'Bad date range');
  if ((Date.parse(to) - Date.parse(from)) / 86400_000 > 62) throw new HttpError(400, 'Range too long');
  const role = await memberRole(client, household_id, user.id);
  if (!role) throw new HttpError(403, 'Not a member of this household');

  const { res, used, maps } = await planWithTravel(client, db, household_id, from, to, now);
  if (sync && (role === 'owner' || role === 'editor')) await background(syncReminders(db, household_id, now));
  return json({ travel: used, pending: res.travelRequests.length, maps, generated_at: now.toISOString() });
}));

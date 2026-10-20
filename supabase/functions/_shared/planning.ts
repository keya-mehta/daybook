// Loads a household, runs the planner with real travel times, and keeps reminders in step.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { planRange, roundTo15, type PlanResult } from './engine/planner.ts';
import { desiredReminders } from './engine/reminders.ts';
import { addDays, localParts } from './engine/time.ts';
import type { Household, TaskRow } from './engine/types.ts';
import { Travel } from './travel.ts';

export async function loadHousehold(db: SupabaseClient, householdId: string, from: string, to: string) {
  const [hh, people, vehicles, drivers, blocks, events, tasks] = await Promise.all([
    db.from('households').select('*').eq('id', householdId).single(),
    db.from('people').select('*').eq('household_id', householdId).eq('archived', false).order('sort'),
    db.from('vehicles').select('*').eq('household_id', householdId),
    db.from('drivers').select('*').eq('household_id', householdId),
    db.from('resource_blocks').select('*').eq('household_id', householdId),
    db.from('events').select('*').eq('household_id', householdId)
      .or(`rrule.not.is.null,and(end_at.gte.${addDays(from, -2)},start_at.lte.${addDays(to, 2)})`),
    db.from('tasks').select('*').eq('household_id', householdId).neq('status', 'done'),
  ]);
  for (const r of [hh, people, vehicles, drivers, blocks, events, tasks]) if (r.error) throw r.error;
  return {
    household: hh.data as Household, people: people.data!, vehicles: vehicles.data!, drivers: drivers.data!,
    blocks: blocks.data!, events: events.data!, tasks: tasks.data as TaskRow[],
  };
}

export async function planWithTravel(db: SupabaseClient, cacheDb: SupabaseClient, householdId: string, from: string, to: string, now: Date) {
  const data = await loadHousehold(db, householdId, from, to);
  const travel = new Travel(cacheDb, data.household.timezone, now);
  let res: PlanResult = planRange({ ...data, travel: travel.lookup, now }, from, to);
  for (let round = 0; round < 3 && res.travelRequests.length; round++) {
    const filled = await travel.fill(res.travelRequests);
    if (!filled) break;
    res = planRange({ ...data, travel: travel.lookup, now }, from, to);
  }
  // record every lookup the final plan used, so the app can run the same planner with the same numbers
  const used: { from: string; to: string; at: string; minutes: number | null; source: string; distance_km?: number | null }[] = [];
  planRange({ ...data, now, travel: (a, b, at) => {
    const est = travel.lookup(a, b, at);
    if (est) used.push({ from: a, to: b, at: roundTo15(at).toISOString(), minutes: est.minutes, source: est.source, distance_km: est.distance_km });
    return est;
  } }, from, to);
  return { data, res, used, maps: { status: travel.status, error: travel.lastError } };
}

export const HORIZON_DAYS = 14;

/** Make the reminders table match what the plan says should exist. Safe to call repeatedly. */
export async function syncReminders(admin: SupabaseClient, householdId: string, now: Date) {
  const { data: hh } = await admin.from('households').select('timezone').eq('id', householdId).single();
  const today = localParts(now, hh!.timezone).date;
  const end = addDays(today, HORIZON_DAYS);
  const { data, res } = await planWithTravel(admin, admin, householdId, today, end, now);
  const desired = desiredReminders(data.household, res.days, data.tasks, now);
  const horizonEnd = new Date(now.getTime() + (HORIZON_DAYS + 1) * 86400_000).toISOString();

  const { data: existing, error } = await admin.from('reminders').select('*')
    .eq('household_id', householdId).eq('origin', 'auto')
    .gte('fire_at', new Date(now.getTime() - 3 * 86400_000).toISOString());
  if (error) throw error;
  const byKey = new Map((existing ?? []).map((r) => [r.dedupe_key, r]));
  const wanted = new Set(desired.map((d) => d.dedupe_key));
  let inserted = 0, updated = 0, removed = 0;

  const inserts = [];
  for (const d of desired) {
    const ex = byKey.get(d.dedupe_key);
    if (!ex) { inserts.push({ household_id: householdId, ...d, origin: 'auto', status: 'pending' }); continue; }
    const moved = Math.abs(new Date(ex.fire_at).getTime() - new Date(d.fire_at).getTime()) > 60_000;
    const patch: Record<string, unknown> = {};
    if (ex.title !== d.title) patch.title = d.title;
    if ((ex.body ?? null) !== (d.body ?? null)) patch.body = d.body;
    if (ex.status === 'pending' && moved && !ex.user_modified) patch.fire_at = d.fire_at;
    // the plan moved later after this already went out: remind again at the new time
    if (ex.status === 'sent' && moved && new Date(d.fire_at) > new Date(ex.fire_at) && new Date(d.fire_at) > now) {
      Object.assign(patch, { fire_at: d.fire_at, status: 'pending', sent_at: null });
    }
    if (Object.keys(patch).length) { await admin.from('reminders').update(patch).eq('id', ex.id); updated++; }
  }
  if (inserts.length) {
    const { error: e } = await admin.from('reminders').upsert(inserts, { onConflict: 'household_id,dedupe_key', ignoreDuplicates: true });
    if (e) throw e;
    inserted = inserts.length;
  }
  const stale = (existing ?? []).filter((r) => r.status === 'pending' && !wanted.has(r.dedupe_key) && r.fire_at <= horizonEnd).map((r) => r.id);
  if (stale.length) { await admin.from('reminders').delete().in('id', stale); removed = stale.length; }
  return { inserted, updated, removed };
}

// Google Routes API with a cache. The key never leaves the server.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { norm, roundTo15 } from './engine/planner.ts';
import { localParts } from './engine/time.ts';
import type { TravelEstimate, TravelRequest } from './engine/types.ts';
import { env } from './server.ts';

const LIVE_WINDOW_MS = 2 * 3600_000;

/** Cache key: near-term trips use live traffic (15-min buckets, short TTL); later trips use
 *  Google's predicted traffic for that weekday + hour (longer TTL). */
export function cacheKey(from: string, to: string, departAt: Date, tz: string, now: Date) {
  const pair = `${norm(from)}|${norm(to)}`;
  if (departAt.getTime() - now.getTime() < LIVE_WINDOW_MS) return { key: `${pair}|live|${roundTo15(departAt).toISOString()}`, ttlMin: 20, live: true };
  const p = localParts(departAt, tz);
  return { key: `${pair}|w${p.weekday}h${p.hh}`, ttlMin: 14 * 24 * 60, live: false };
}

export class Travel {
  mem = new Map<string, TravelEstimate>();
  tried = new Set<string>();
  status: 'off' | 'ok' | 'error' = env('GOOGLE_MAPS_API_KEY') ? 'ok' : 'off';
  lastError: string | null = null;
  constructor(private db: SupabaseClient, private tz: string, private now: Date) {}

  lookup = (from: string, to: string, departAt: Date): TravelEstimate | undefined =>
    this.mem.get(cacheKey(from, to, departAt, this.tz, this.now).key);

  /** resolve the planner's missing lookups: cache first, then Google */
  async fill(reqs: TravelRequest[]): Promise<number> {
    const todo = new Map<string, { req: TravelRequest; ttlMin: number; departAt: Date }>();
    for (const r of reqs) {
      const departAt = new Date(r.departAt);
      const k = cacheKey(r.from, r.to, departAt, this.tz, this.now);
      if (this.mem.has(k.key) || this.tried.has(k.key)) continue;
      this.tried.add(k.key);
      todo.set(k.key, { req: r, ttlMin: k.ttlMin, departAt });
    }
    if (!todo.size) return 0;
    let filled = 0;
    const { data: cached } = await this.db.from('travel_cache').select('*').in('key', [...todo.keys()]);
    for (const row of cached ?? []) {
      const t = todo.get(row.key)!;
      if (Date.now() - new Date(row.fetched_at).getTime() < t.ttlMin * 60000) {
        this.mem.set(row.key, { minutes: row.duration_min, source: row.traffic_aware ? 'google_traffic' : 'google', distance_km: row.distance_km });
        todo.delete(row.key);
        filled++;
      }
    }
    if (this.status === 'off' || !todo.size) return filled;
    const entries = [...todo.entries()].slice(0, 40); // cap per request
    for (let i = 0; i < entries.length; i += 6) {
      await Promise.all(entries.slice(i, i + 6).map(async ([key, t]) => {
        try {
          const est = await routeMinutes(t.req.from, t.req.to, t.departAt, this.now);
          this.mem.set(key, est);
          filled++;
          await this.db.from('travel_cache').upsert({ key, origin: t.req.from, destination: t.req.to, duration_min: est.minutes,
            distance_km: est.distance_km, traffic_aware: est.source === 'google_traffic', fetched_at: new Date().toISOString() });
        } catch (e) {
          this.status = 'error';
          this.lastError = e instanceof Error ? e.message : String(e);
        }
      }));
    }
    return filled;
  }
}

async function routeMinutes(from: string, to: string, departAt: Date, now: Date): Promise<TravelEstimate & { minutes: number }> {
  const future = departAt.getTime() > now.getTime() + 60_000;
  const body: Record<string, unknown> = {
    origin: { address: from }, destination: { address: to }, travelMode: 'DRIVE',
    routingPreference: future ? 'TRAFFIC_AWARE_OPTIMAL' : 'TRAFFIC_AWARE',
    regionCode: env('MAPS_REGION') || 'IN',
  };
  if (future) body.departureTime = departAt.toISOString();
  const r = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': env('GOOGLE_MAPS_API_KEY'), 'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters' },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`Google Maps: ${j?.error?.message ?? r.status}`);
  const route = j.routes?.[0];
  if (!route?.duration) throw new Error(`Google Maps found no driving route from "${from}" to "${to}"`);
  return { minutes: Math.max(1, Math.round(parseInt(route.duration, 10) / 60)), source: 'google_traffic', distance_km: route.distanceMeters ? Math.round(route.distanceMeters / 100) / 10 : null };
}

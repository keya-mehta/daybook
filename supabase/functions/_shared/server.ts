// Helpers shared by the Edge Functions (Deno).
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

export const env = (k: string) => Deno.env.get(k) ?? '';
export const APP_URL = () => env('APP_URL').replace(/\/$/, '');

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

export const admin = (): SupabaseClient =>
  createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

/** client acting as the signed-in caller (RLS applies) */
export function asUser(req: Request): SupabaseClient {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
    auth: { persistSession: false },
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
}

export async function requireUser(req: Request) {
  const c = asUser(req);
  const { data, error } = await c.auth.getUser();
  if (error || !data.user) throw new HttpError(401, 'Please sign in again');
  return { client: c, user: data.user };
}

export function isCron(req: Request) {
  const s = env('CRON_SECRET');
  return !!s && req.headers.get('x-cron-secret') === s;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function handler(fn: (req: Request) => Promise<Response>) {
  return async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
    try {
      return await fn(req);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      console.error(e);
      return json({ error: e instanceof Error ? e.message : String(e) }, status);
    }
  };
}

export async function memberRole(db: SupabaseClient, householdId: string, userId: string): Promise<string | null> {
  const { data } = await db.from('household_members').select('role').eq('household_id', householdId).eq('user_id', userId).maybeSingle();
  return data?.role ?? null;
}

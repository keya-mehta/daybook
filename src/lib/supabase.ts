import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const configured = !!(url && anon);
export const supabase = createClient(url || 'http://localhost', anon || 'missing', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

/** call an Edge Function; throws with a readable message */
export async function callFn<T = unknown>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let msg = error.message;
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx) msg = (await ctx.json()).error ?? msg;
    } catch { /* keep generic */ }
    if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) msg = "Couldn't reach the server — check your internet connection";
    throw new Error(msg);
  }
  return data as T;
}

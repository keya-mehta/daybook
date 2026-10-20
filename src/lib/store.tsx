import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, callFn } from './supabase';
import { toast } from './toast';
import { planRange, norm, roundTo15, type PlanResult } from '@engine/planner.ts';
import { localParts, addDays } from '@engine/time.ts';
import type { Driver, EventRow, Household, Person, Place, ReminderRow, ResourceBlock, TaskRow, TravelEstimate, Vehicle } from '@engine/types.ts';

export interface Member { household_id: string; user_id: string; role: 'owner' | 'editor' | 'limited'; email: string | null; display_name: string | null; person_id: string | null; driver_id: string | null; email_summary: boolean; summary_hour: number }
export interface Invite { id: string; household_id: string; email: string; role: 'editor' | 'limited'; person_id: string | null; driver_id: string | null; accepted_at: string | null }
export interface Note { id: string; household_id: string; kind: 'note' | 'shopping' | 'checklist' | 'contact' | 'date'; title: string; body: string | null; items: { id: string; text: string; done: boolean }[]; phone: string | null; the_date: string | null; repeats_yearly: boolean; person_id: string | null; event_id: string | null; task_id: string | null; pinned: boolean; is_sample: boolean }

export interface Data {
  household: Household; members: Member[]; invites: Invite[];
  people: Person[]; places: Place[]; vehicles: Vehicle[]; drivers: Driver[]; blocks: ResourceBlock[];
  events: EventRow[]; tasks: TaskRow[]; reminders: ReminderRow[]; notes: Note[];
}
type Table = 'people' | 'places' | 'vehicles' | 'drivers' | 'resource_blocks' | 'events' | 'tasks' | 'reminders' | 'notes' | 'invites' | 'households' | 'household_members';
const KEY: Record<string, keyof Data> = { people: 'people', places: 'places', vehicles: 'vehicles', drivers: 'drivers', resource_blocks: 'blocks', events: 'events', tasks: 'tasks', reminders: 'reminders', notes: 'notes', invites: 'invites' };

type MapsStatus = { status: 'ok' | 'off' | 'error' | 'unknown'; error: string | null; checking: boolean; offline: boolean };

interface Ctx {
  session: Session | null; authReady: boolean;
  householdId: string | null; households: { id: string; name: string }[]; setHouseholdId: (id: string) => void;
  data: Data | null; loading: boolean; loadError: string | null; reload: () => Promise<void>;
  me: Member | null; canEdit: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  save: <T = any>(table: Table, row: Record<string, any>, opts?: { quiet?: boolean; message?: string }) => Promise<T | null>;
  saveMany: (table: Table, rows: Record<string, unknown>[], opts?: { quiet?: boolean; message?: string }) => Promise<boolean>;
  remove: (table: Table, id: string, opts?: { quiet?: boolean; message?: string }) => Promise<boolean>;
  travel: Map<string, TravelEstimate>; maps: MapsStatus; ensureTravel: (from: string, to: string) => void;
  online: boolean;
  demo?: 'sample' | 'own' | false;
}
const C = createContext<Ctx>(null as unknown as Ctx);
export const StoreContext = C; // used by tests/preview harness
export type StoreCtx = Ctx;
export const useStore = () => useContext(C);
export const useData = () => useContext(C).data!;

const travelKey = (a: string, b: string, at: Date) => `${norm(a)}|${norm(b)}|${roundTo15(at).toISOString()}`;
const SNAP = 'daybook:snapshot:';
const TRAVEL = 'daybook:travel:';

export function StoreProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [households, setHouseholds] = useState<{ id: string; name: string }[]>([]);
  const [householdId, setHid] = useState<string | null>(() => localStorage.getItem('daybook:hh'));
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [travel, setTravel] = useState<Map<string, TravelEstimate>>(new Map());
  const [maps, setMaps] = useState<MapsStatus>({ status: 'unknown', error: null, checking: false, offline: false });
  const [version, setVersion] = useState(0); // bumps on every change → re-fetch travel & resync reminders

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthReady(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    const on = () => setOnline(true), off = () => setOnline(false);
    addEventListener('online', on); addEventListener('offline', off);
    return () => { sub.subscription.unsubscribe(); removeEventListener('online', on); removeEventListener('offline', off); };
  }, []);

  const setHouseholdId = (id: string) => { localStorage.setItem('daybook:hh', id); setHid(id); };

  // which households am I in?
  const loadHouseholds = useCallback(async () => {
    if (!session) return;
    await supabase.rpc('accept_invites');
    const { data: rows, error } = await supabase.from('household_members').select('household_id, households(name)').eq('user_id', session.user.id);
    if (error) { setLoadError(error.message); setLoading(false); return; }
    const list = (rows ?? []).map((r: { household_id: string; households: { name: string } | { name: string }[] | null }) => ({
      id: r.household_id, name: (Array.isArray(r.households) ? r.households[0]?.name : r.households?.name) ?? 'Family' }));
    setHouseholds(list);
    if (!list.length) { setHid(null); setData(null); setLoading(false); return; }
    if (!householdId || !list.some((h) => h.id === householdId)) setHouseholdId(list[0].id);
  }, [session, householdId]);
  useEffect(() => { if (session) loadHouseholds(); else if (authReady) { setData(null); setLoading(false); } }, [session, authReady]); // eslint-disable-line

  const reload = useCallback(async () => {
    if (!householdId || !session) return;
    const h = householdId;
    const q = <T,>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>) => p;
    const since = new Date(Date.now() - 7 * 86400_000).toISOString();
    const res = await Promise.all([
      q(supabase.from('households').select('*').eq('id', h).single()),
      q(supabase.from('household_members').select('*').eq('household_id', h)),
      q(supabase.from('invites').select('*').eq('household_id', h)),
      q(supabase.from('people').select('*').eq('household_id', h).order('sort').order('name')),
      q(supabase.from('places').select('*').eq('household_id', h).order('name')),
      q(supabase.from('vehicles').select('*').eq('household_id', h).order('name')),
      q(supabase.from('drivers').select('*').eq('household_id', h).order('name')),
      q(supabase.from('resource_blocks').select('*').eq('household_id', h)),
      q(supabase.from('events').select('*').eq('household_id', h).order('start_at')),
      q(supabase.from('tasks').select('*').eq('household_id', h).or(`status.neq.done,completed_at.gte.${since}`)),
      q(supabase.from('reminders').select('*').eq('household_id', h).or(`status.eq.pending,fire_at.gte.${since}`).order('fire_at')),
      q(supabase.from('notes').select('*').eq('household_id', h).order('pinned', { ascending: false }).order('title')),
    ]);
    const err = res.find((r) => r.error)?.error;
    if (err) {
      setLoadError(online ? err.message : 'offline');
      const snap = localStorage.getItem(SNAP + h);
      if (snap && !data) setData(JSON.parse(snap));
      setLoading(false);
      return;
    }
    const [household, members, invites, people, places, vehicles, drivers, blocks, events, tasks, reminders, notes] = res.map((r) => r.data);
    const d = { household, members, invites, people, places, vehicles, drivers, blocks, events, tasks, reminders, notes } as unknown as Data;
    setData(d);
    setLoadError(null);
    setLoading(false);
    try { localStorage.setItem(SNAP + h, JSON.stringify(d)); } catch { /* storage full: fine */ }
  }, [householdId, session, online]); // eslint-disable-line

  useEffect(() => {
    if (!householdId || !session) return;
    setLoading(true);
    const snap = localStorage.getItem(SNAP + householdId);
    if (snap) { try { setData(JSON.parse(snap)); setLoading(false); } catch { /* ignore */ } }
    const t = localStorage.getItem(TRAVEL + householdId);
    if (t) { try { setTravel(new Map(JSON.parse(t))); } catch { /* ignore */ } }
    reload();
    // live updates from other devices / family members
    let timer: number | undefined;
    const ch = supabase.channel(`hh:${householdId}`);
    for (const table of ['events', 'tasks', 'reminders', 'people', 'vehicles', 'drivers', 'notes', 'places']) {
      ch.on('postgres_changes', { event: '*', schema: 'public', table, filter: `household_id=eq.${householdId}` }, () => {
        clearTimeout(timer);
        timer = window.setTimeout(reload, 400);
      });
    }
    ch.subscribe();
    const vis = () => { if (document.visibilityState === 'visible') reload(); };
    document.addEventListener('visibilitychange', vis);
    return () => { supabase.removeChannel(ch); document.removeEventListener('visibilitychange', vis); clearTimeout(timer); };
  }, [householdId, session]); // eslint-disable-line

  useEffect(() => { if (online) reload(); }, [online]); // eslint-disable-line

  const me = useMemo(() => data?.members.find((m) => m.user_id === session?.user.id) ?? null, [data, session]);
  const canEdit = me?.role === 'owner' || me?.role === 'editor';

  // ---------- writes
  const apply = (table: Table, rows: Record<string, unknown>[], del = false) => {
    const k = KEY[table];
    if (!k) return;
    setData((d) => {
      if (!d) return d;
      let list = [...(d[k] as unknown as { id: string }[])];
      for (const r of rows) {
        const i = list.findIndex((x) => x.id === r.id);
        if (del) list = list.filter((x) => x.id !== r.id);
        else if (i >= 0) list[i] = { ...list[i], ...r } as { id: string };
        else list.push(r as { id: string });
      }
      return { ...d, [k]: list };
    });
  };
  const failMsg = (e: { message: string }) => (online ? e.message : "You're offline — this wasn't saved. Try again when you're connected.");

  const save: Ctx['save'] = async (table, row, opts) => {
    const payload = { ...row } as Record<string, unknown>;
    if (table !== 'households' && table !== 'household_members' && !payload.household_id) payload.household_id = householdId;
    const q = payload.id && table !== 'household_members'
      ? supabase.from(table).update(payload).eq('id', payload.id as string).select().single()
      : table === 'household_members'
        ? supabase.from(table).update(payload).eq('household_id', payload.household_id as string).eq('user_id', payload.user_id as string).select().single()
        : supabase.from(table).insert(payload).select().single();
    const { data: saved, error } = await q;
    if (error) { toast(failMsg(error), 'error'); return null; }
    if (table === 'households') setData((d) => (d ? { ...d, household: saved as Household } : d));
    else if (table === 'household_members') setData((d) => (d ? { ...d, members: d.members.map((m) => (m.user_id === saved.user_id ? saved : m)) } : d));
    else apply(table, [saved]);
    if (!opts?.quiet) toast(opts?.message ?? 'Saved');
    setVersion((v) => v + 1);
    return saved;
  };
  const saveMany: Ctx['saveMany'] = async (table, rows, opts) => {
    if (!rows.length) return true;
    const payload = rows.map((r) => ({ household_id: householdId, ...r }));
    const { data: saved, error } = await supabase.from(table).upsert(payload).select();
    if (error) { toast(failMsg(error), 'error'); return false; }
    apply(table, saved ?? []);
    if (!opts?.quiet) toast(opts?.message ?? 'Saved');
    setVersion((v) => v + 1);
    return true;
  };
  const remove: Ctx['remove'] = async (table, id, opts) => {
    const { error } = await supabase.from(table).delete().eq('id', id);
    if (error) { toast(failMsg(error), 'error'); return false; }
    apply(table, [{ id }], true);
    if (!opts?.quiet) toast(opts?.message ?? 'Deleted');
    setVersion((v) => v + 1);
    return true;
  };

  // ---------- travel times + reminder sync (server), debounced after changes
  const wanted = useRef<{ from: string; to: string } | null>(null);
  const fetchTravel = useCallback(async (sync: boolean) => {
    if (!householdId || !data || !online) { setMaps((m) => ({ ...m, offline: !online })); return; }
    const today = localParts(new Date(), data.household.timezone).date;
    const range = wanted.current ?? { from: today, to: addDays(today, 14) };
    setMaps((m) => ({ ...m, checking: true }));
    try {
      const r = await callFn<{ travel: { from: string; to: string; at: string; minutes: number | null; source: TravelEstimate['source']; distance_km?: number | null }[]; maps: { status: MapsStatus['status']; error: string | null } }>(
        'plan', { household_id: householdId, from: range.from < today ? range.from : today, to: range.to > addDays(today, 14) ? range.to : addDays(today, 14), sync: sync && canEdit });
      setTravel((prev) => {
        const next = new Map(prev);
        for (const t of r.travel) next.set(`${norm(t.from)}|${norm(t.to)}|${t.at}`, { minutes: t.minutes, source: t.source, distance_km: t.distance_km });
        try { localStorage.setItem(TRAVEL + householdId, JSON.stringify([...next].slice(-400))); } catch { /* ignore */ }
        return next;
      });
      setMaps({ status: r.maps.status, error: r.maps.error, checking: false, offline: false });
    } catch (e) {
      setMaps((m) => ({ ...m, checking: false, status: m.status === 'unknown' ? 'error' : m.status, error: (e as Error).message }));
    }
  }, [householdId, data, online, canEdit]);

  const timer = useRef<number>();
  useEffect(() => {
    if (!data) return;
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => fetchTravel(version > 0), version > 0 ? 1200 : 300);
    return () => clearTimeout(timer.current);
  }, [version, householdId, !!data, online]); // eslint-disable-line

  // after edits, keep Google Calendar in step (if connected)
  const gTimer = useRef<number>();
  useEffect(() => {
    if (!version || !canEdit || !householdId) return;
    clearTimeout(gTimer.current);
    gTimer.current = window.setTimeout(async () => {
      const { data: st } = await supabase.rpc('gcal_status', { h: householdId });
      if (st?.connected) callFn('gcal', { action: 'sync', household_id: householdId }).catch(() => {});
    }, 4000);
  }, [version]); // eslint-disable-line

  const ensureTravel = useCallback((from: string, to: string) => {
    const w = wanted.current;
    if (w && w.from <= from && w.to >= to) return;
    wanted.current = { from: w && w.from < from ? w.from : from, to: w && w.to > to ? w.to : to };
    fetchTravel(false);
  }, [fetchTravel]);

  const ctx: Ctx = {
    session, authReady, householdId, households, setHouseholdId, data, loading, loadError, reload: async () => { await loadHouseholds(); await reload(); },
    me, canEdit, save, saveMany, remove, travel, maps, ensureTravel, online,
  };
  return <C.Provider value={ctx}>{children}</C.Provider>;
}

/** Plan for a date range, using the travel times the server has looked up. */
export function usePlan(from: string, to: string): PlanResult & { maps: MapsStatus } {
  const { data, travel, maps, ensureTravel } = useStore();
  const res = useMemo(() => {
    if (!data) return { days: [], occurrences: [], travelRequests: [] } as PlanResult;
    return planRange({ ...data, travel: (a, b, at) => travel.get(travelKey(a, b, at)) }, from, to);
  }, [data, travel, from, to]);
  useEffect(() => { if (res.travelRequests.length) ensureTravel(from, to); }, [res.travelRequests.length, from, to]); // eslint-disable-line
  return { ...res, maps };
}

export function useToday() {
  const { data } = useStore();
  const tz = data?.household.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(t); }, []);
  return { now, tz, today: localParts(now, tz).date };
}

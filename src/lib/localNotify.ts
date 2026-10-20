// Notifications for the browser-only version (no server). The same reminders the server would send are
// worked out here and shown while Daybook is open — in a browser tab (even in the background) or
// launched from the Home Screen. Notifications when the app is fully closed need the server (push).
import { useEffect } from 'react';
import { planRange } from '@engine/planner.ts';
import { desiredReminders } from '@engine/reminders.ts';
import { addDays, localParts } from '@engine/time.ts';
import type { ReminderRow } from '@engine/types.ts';
import type { Data } from './store';

const SENT = 'daybook:local-sent';
export type LocalNotifyState = 'unsupported' | 'denied' | 'off' | 'on';

export function localNotifyState(): LocalNotifyState {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return Notification.permission === 'granted' ? 'on' : 'off';
}

export async function enableLocalNotify(): Promise<void> {
  if (!('Notification' in window)) throw new Error("This browser can't show notifications. On iPhone, add Daybook to the Home Screen first (Share → Add to Home Screen) and open it from there.");
  const p = await Notification.requestPermission();
  if (p !== 'granted') throw new Error('Notifications were not allowed. You can allow them in the browser or phone settings.');
  await show('Notifications are on', 'Daybook will remind you here while it is open.', 'test');
}

async function show(title: string, body: string, tag: string) {
  const opts: NotificationOptions = { body, tag, icon: `${import.meta.env.BASE_URL}icon-192.png` };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) { await reg.showNotification(title, opts); return; }
  } catch { /* fall back */ }
  new Notification(title, opts);
}

/** reminders for the next two weeks, worked out on this device (ids are their dedupe keys) */
export function computeLocalReminders(data: Data, now: Date): ReminderRow[] {
  const tz = data.household.timezone;
  const today = localParts(now, tz).date;
  const plan = planRange({ ...data, now }, today, addDays(today, 14));
  const stored = new Map(data.reminders.map((r) => [r.id, r]));
  const auto = desiredReminders(data.household, plan.days, data.tasks, now).map((d) => {
    const own = stored.get(d.dedupe_key);
    return { id: d.dedupe_key, household_id: data.household.id, target_user_id: null, origin: 'auto', status: 'pending', user_modified: false, ...d, ...(own ?? {}) } as ReminderRow;
  });
  const manual = data.reminders.filter((r) => r.origin === 'manual');
  return [...auto, ...manual].sort((a, b) => a.fire_at.localeCompare(b.fire_at));
}

/** checks every 20 seconds and shows anything that has come due since the last check */
export function useLocalNotifier(getReminders: () => ReminderRow[], version: unknown) {
  useEffect(() => {
    const tick = () => {
      if (localNotifyState() !== 'on') return;
      let sent: Record<string, string> = {};
      try { sent = JSON.parse(localStorage.getItem(SENT) ?? '{}'); } catch { /* reset */ }
      const now = Date.now();
      const due = getReminders().filter((r) => r.status === 'pending' && Date.parse(r.fire_at) <= now && now - Date.parse(r.fire_at) < 30 * 60000 && sent[r.id] !== r.fire_at);
      if (!due.length) return;
      // group reminders that come due together into one notification
      const leave = due.find((r) => r.kind === 'leave');
      if (due.length === 1) show(due[0].title, due[0].body ?? '', due[0].id);
      else show(leave ? leave.title : `${due.length} reminders`, due.filter((r) => r !== leave).map((r) => `• ${r.title}`).join('\n'), 'group');
      for (const r of due) sent[r.id] = r.fire_at;
      // forget entries older than 3 days
      for (const k of Object.keys(sent)) if (now - Date.parse(sent[k]) > 3 * 86400_000) delete sent[k];
      localStorage.setItem(SENT, JSON.stringify(sent));
    };
    tick();
    const t = setInterval(tick, 20_000);
    const vis = () => document.visibilityState === 'visible' && tick();
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis); };
  }, [getReminders, version]);
}

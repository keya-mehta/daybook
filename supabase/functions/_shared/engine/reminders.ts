// Turns a plan into the reminders that should exist. The server upserts these by dedupe_key, so
// re-planning after an edit moves reminders instead of duplicating them.

import { addMin, fmtTime, localParts, zonedToUtc, addDays } from './time.ts';
import type { DayPlan } from './planner.ts';
import type { Household, ReminderRow, TaskRow } from './types.ts';

export type DesiredReminder = Pick<ReminderRow, 'ref_type' | 'ref_id' | 'occurrence_date' | 'kind' | 'title' | 'body' | 'dedupe_key'> & { fire_at: string };

function whenLabel(start: Date, now: Date, tz: string): string {
  const d = localParts(start, tz).date, today = localParts(now, tz).date;
  if (d === today) return `today at ${fmtTime(start, tz)}`;
  if (d === addDays(today, 1)) return `tomorrow at ${fmtTime(start, tz)}`;
  return `${new Intl.DateTimeFormat('en-IN', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).format(start)} at ${fmtTime(start, tz)}`;
}

export function desiredReminders(hh: Household, days: DayPlan[], tasks: TaskRow[], now: Date): DesiredReminder[] {
  const tz = hh.timezone;
  const out: DesiredReminder[] = [];
  const cutoff = addMin(now, -5);
  const push = (r: DesiredReminder) => { if (new Date(r.fire_at) >= cutoff) out.push(r); };

  for (const day of days) {
    for (const it of day.items) {
      const { occ } = it;
      if (occ.cancelled || occ.date !== day.date) continue;
      const ev = occ.event;
      const who = it.people.map((p) => p.name).join(', ');
      const carry = [...it.carry.map((c) => c.text), ...it.tasksBefore.filter((t) => t.kind === 'carry').map((t) => t.title)];
      const leaveFire = it.leaveAt && ev.remind_leave ? addMin(it.leaveAt, -(hh.leave_reminder_min ?? 15)) : null;

      if (leaveFire && it.leaveAt) {
        push({
          ref_type: 'event', ref_id: ev.id, occurrence_date: occ.date, kind: 'leave',
          fire_at: leaveFire.toISOString(),
          title: `Leave at ${fmtTime(it.leaveAt, tz)} · ${ev.title}`,
          body: [who, [it.vehicle?.name, it.selfDrive ? 'you drive' : it.driver?.name].filter(Boolean).join(' with '),
            carry.length ? `Carry: ${carry.join(', ')}` : ''].filter(Boolean).join(' · '),
          dedupe_key: `leave:${ev.id}:${occ.date}`,
        });
      }
      for (const off of ev.reminder_offsets ?? hh.default_reminders ?? []) {
        const fire = addMin(occ.start, -off);
        // skip if it would land within 20 minutes of the leave reminder: one nudge is enough
        if (leaveFire && Math.abs(fire.getTime() - leaveFire.getTime()) < 20 * 60000) continue;
        push({
          ref_type: 'event', ref_id: ev.id, occurrence_date: occ.date, kind: 'before',
          fire_at: fire.toISOString(),
          title: `${ev.title} ${whenLabel(occ.start, fire, tz)}`,
          body: [who, ev.location, it.leaveAt ? `leave ${fmtTime(it.leaveAt, tz)}` : '', carry.length ? `Carry: ${carry.join(', ')}` : ''].filter(Boolean).join(' · '),
          dedupe_key: `before:${ev.id}:${occ.date}:${off}`,
        });
      }
      if (it.needsTransport && !it.vehicle) {
        const fire = new Date(Math.max(addMin(occ.start, -24 * 60).getTime(), now.getTime()));
        push({
          ref_type: 'event', ref_id: ev.id, occurrence_date: occ.date, kind: 'arrange',
          fire_at: fire.toISOString(), title: `Arrange a car for ${ev.title}`,
          body: `${who} · ${whenLabel(occ.start, fire, tz)}`, dedupe_key: `arrange:${ev.id}:${occ.date}`,
        });
      }
      if (ev.needs_confirmation) {
        const dayBefore = zonedToUtc(addDays(occ.date, -1), '10:00', tz);
        const fire = dayBefore > now ? dayBefore : addMin(occ.start, -180);
        push({
          ref_type: 'event', ref_id: ev.id, occurrence_date: occ.date, kind: 'confirm',
          fire_at: fire.toISOString(), title: `Confirm ${ev.title}`,
          body: `${who} · ${whenLabel(occ.start, fire, tz)}`, dedupe_key: `confirm:${ev.id}:${occ.date}`,
        });
      }
    }
  }

  for (const t of tasks) {
    if (t.status === 'done' || !t.due_date) continue;
    const fire = zonedToUtc(t.due_date, t.due_time?.slice(0, 5) ?? '09:00', tz);
    push({
      ref_type: 'task', ref_id: t.id, occurrence_date: t.due_date, kind: 'task_due',
      fire_at: fire.toISOString(), title: t.title, body: t.description ?? null,
      dedupe_key: `task:${t.id}:${t.due_date}:${t.due_time ?? ''}`,
    });
  }
  return out;
}

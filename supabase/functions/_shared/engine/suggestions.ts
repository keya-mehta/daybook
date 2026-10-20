// Suggested preparation tasks for an appointment. Shown as "Suggested" until accepted.

import type { Category, TaskRow, TransportMode } from './types.ts';

export type SuggestedTask = { title: string; kind: TaskRow['kind']; daysBefore: number };

export function suggestTasks(ev: { title: string; category: Category; transport_mode: TransportMode; vehicle_id: string | null; needs_confirmation: boolean }): SuggestedTask[] {
  const t = ev.title.toLowerCase();
  const out: SuggestedTask[] = [];
  const medical = ev.category === 'medical' || /doctor|dr\.?\s|dentist|clinic|hospital|scan|test|check.?up|physio|eye/.test(t);
  if (medical) {
    out.push({ title: `Call to confirm ${ev.title}`, kind: 'confirm', daysBefore: 1 });
    out.push({ title: 'Collect medical reports', kind: 'carry', daysBefore: 1 });
    out.push({ title: 'Carry prescriptions & insurance card', kind: 'carry', daysBefore: 0 });
  } else if (ev.category === 'travel' || /flight|train|trip|airport|station/.test(t)) {
    out.push({ title: 'Check tickets', kind: 'prepare', daysBefore: 2 });
    out.push({ title: 'Carry ID / passport', kind: 'carry', daysBefore: 0 });
    out.push({ title: 'Pack bags', kind: 'prepare', daysBefore: 1 });
  } else if (ev.category === 'school' && /meeting|ptm|parent|event|function/.test(t)) {
    out.push({ title: 'Carry school diary / documents', kind: 'carry', daysBefore: 0 });
  } else if (ev.needs_confirmation) {
    out.push({ title: `Confirm ${ev.title}`, kind: 'confirm', daysBefore: 1 });
  }
  if (['drop', 'drop_pickup', 'wait'].includes(ev.transport_mode) && !ev.vehicle_id) {
    out.push({ title: `Arrange car for ${ev.title}`, kind: 'transport', daysBefore: 1 });
  }
  return out;
}

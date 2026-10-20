// Row shapes shared by the app and the server functions (mirror the SQL schema).

export type TransportMode = 'none' | 'drop' | 'drop_pickup' | 'wait' | 'self';
export type Category = 'appointment' | 'medical' | 'school' | 'class' | 'work' | 'social' | 'travel' | 'household' | 'other';
export type CheckItem = { id: string; text: string; done: boolean };

export interface Household {
  id: string; name: string; timezone: string; home_label: string; home_address: string | null;
  traffic_buffer_min: number; fallback_travel_min: number | null;
  default_reminders: number[]; leave_reminder_min: number;
}
export interface Person {
  id: string; household_id: string; name: string; relation: string | null; initials: string | null;
  color: string; photo_url: string | null; phone: string | null; email: string | null; notes: string | null;
  usual_pickup: string | null; sort: number; archived: boolean; is_sample: boolean;
}
export interface Place { id: string; household_id: string; name: string; address: string; phone: string | null; notes: string | null; is_sample: boolean }
export interface Driver {
  id: string; household_id: string; name: string; phone: string | null; notes: string | null;
  available_days: number[] | null; available_from: string | null; available_to: string | null; is_sample: boolean;
}
export interface Vehicle extends Omit<Driver, 'phone'> { seats: number | null; default_driver_id: string | null }
export interface ResourceBlock { id: string; household_id: string; vehicle_id: string | null; driver_id: string | null; starts_at: string; ends_at: string; reason: string | null }

export interface EventRow {
  id: string; household_id: string; title: string; category: Category; person_ids: string[];
  start_at: string; end_at: string; all_day: boolean; location: string | null; place_id: string | null;
  status: 'planned' | 'tentative' | 'cancelled'; needs_confirmation: boolean;
  transport_mode: TransportMode; pickup_from: string | null; return_to: string | null;
  vehicle_id: string | null; driver_id: string | null; self_drive: boolean;
  leave_lead_min: number | null; travel_min_override: number | null; prep_min: number;
  reminder_offsets: number[] | null; remind_leave: boolean;
  rrule: string | null; exdates: string[]; series_id: string | null;
  checklist: CheckItem[]; notes: string | null; gcal_event_id: string | null; is_sample: boolean;
  updated_at?: string;
}

export interface TaskRow {
  id: string; household_id: string; title: string; description: string | null;
  due_date: string | null; due_time: string | null; priority: 1 | 2 | 3;
  person_id: string | null; event_id: string | null; occurrence_date: string | null;
  estimate_min: number | null; rrule: string | null; checklist: CheckItem[];
  status: 'open' | 'waiting' | 'done'; waiting_on: string | null;
  source: 'user' | 'suggested' | 'sentence';
  kind: 'todo' | 'call' | 'carry' | 'buy' | 'pay' | 'confirm' | 'transport' | 'prepare';
  completed_at: string | null; is_sample: boolean;
}

export interface ReminderRow {
  id: string; household_id: string; target_user_id: string | null; ref_type: 'event' | 'task' | 'custom';
  ref_id: string | null; occurrence_date: string | null;
  kind: 'before' | 'leave' | 'task_due' | 'arrange' | 'confirm' | 'custom';
  fire_at: string; title: string; body: string | null; status: 'pending' | 'sent' | 'done' | 'dismissed';
  origin: 'auto' | 'manual'; user_modified: boolean; dedupe_key: string;
}

export type TravelSource = 'google_traffic' | 'google' | 'manual' | 'fallback' | 'unknown';
export interface TravelEstimate { minutes: number | null; source: TravelSource; distance_km?: number | null }
/** must be synchronous; the server pre-fetches what the planner asks for */
export type TravelLookup = (from: string, to: string, departAt: Date) => TravelEstimate | undefined;
export interface TravelRequest { from: string; to: string; departAt: string }

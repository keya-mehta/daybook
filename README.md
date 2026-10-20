# Daybook

A family planning assistant, built for one person (Mom) who organises everyone's day.
Open it and it answers: **what's happening, what do I need to do, which car, when to leave, what to carry.**

- **Tap-to-fill plans** — person, day, time, duration, place, car, driver, repeat and reminders are all one-tap choices. Typing is optional.
- **"Type it"** — write a sentence ("Tomorrow, take Dad to his dentist at 11 am in Bandra…"); Daybook fills in what it understood and asks tap-to-answer questions about anything unclear. It never guesses a day, time or place.
- **Daily planner** — leave times from Google Maps traffic + a buffer, drop/wait/pick-up legs, who drives, what to carry, what's next for the car.
- **Conflict checks** — same person double-booked, not enough time between places, one car needed in two places, driver off-duty, car or driver availability not entered, no car arranged. Each comes with suggestions (e.g. "Assign Innova — it looks free then").
- **Reminders** — push notifications to phones (even when the app is closed), "time to leave" alerts, task reminders, grouped so she isn't spammed; snooze / reschedule / done.
- **Tasks** — quick add, Today / Overdue / Coming up / Waiting / Done, one-tap complete, "move to today/tomorrow" for overdue, repeating tasks, suggested prep tasks from appointments.
- **Calendar** — day / week / month, filter by person, car-needed or tasks.
- **People, cars & drivers, places, notes & lists, "Coming up", search, sharing, Google Calendar copy, morning email, backup export.**
- Installable on iPhone / iPad / Android as a home-screen app.

## How it's built

| Part | What | Where |
|---|---|---|
| App | React + TypeScript PWA (Vite) | `src/` |
| Planning engine | Pure TypeScript, shared by app and server; 19 unit tests | `supabase/functions/_shared/engine/` |
| Database & login | Supabase Postgres with row-level security, email + password accounts | `supabase/migrations/` |
| Server jobs | Supabase Edge Functions (Deno): travel times, push sending, email, Google Calendar | `supabase/functions/` |
| Scheduling | `pg_cron` every minute (reminders), hourly (email, Google sync), nightly (re-plan) | `supabase/cron.sql` |

All API keys live on the server as Supabase secrets. The browser only ever sees public values (Supabase URL, anon key, VAPID public key).

**Sharing:** the owner can invite people by email as *editor* (sees and changes everything) or *limited* (sees only plans for their own person — or, for a driver, the trips they drive). This is enforced in the database, not just hidden in the app.

---

## Setup (about 45 minutes, once)

You'll need free accounts on **Supabase**, **Vercel** (or Netlify), **Google Cloud**, and **Resend** (for email). Install the [Supabase CLI](https://supabase.com/docs/guides/cli).

### 1. Database

1. Create a Supabase project (region: Mumbai `ap-south-1`).
2. In this folder:
   ```bash
   supabase link --project-ref <PROJECT_REF>
   supabase db push            # creates all tables, security rules and helper functions
   ```
3. **Authentication → URL configuration**: set *Site URL* to your app's address (e.g. `https://daybook-mehta.vercel.app`) and add the same address to *Redirect URLs*.

### 2. Keys (server secrets)

```bash
# push notifications: generate once
npx web-push generate-vapid-keys

supabase secrets set \
  APP_URL=https://daybook-mehta.vercel.app \
  CRON_SECRET=$(openssl rand -hex 24) \
  VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com \
  GOOGLE_MAPS_API_KEY=... \
  GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... \
  RESEND_API_KEY=... EMAIL_FROM="Daybook <plans@yourdomain.com>"
```
Keep a note of `CRON_SECRET` — step 4 needs it.

**Google Maps** — in Google Cloud Console, enable the **Routes API**, create an API key and restrict it to *Routes API*. Light family use normally stays within Google's free monthly allowance; set a budget alert anyway.

**Google Calendar** — enable the **Google Calendar API**, configure the OAuth consent screen (External; while in *Testing*, add your mom's Google address as a test user), then create an *OAuth client ID → Web application* with this redirect URI:
`https://<PROJECT_REF>.supabase.co/functions/v1/gcal`.
Daybook asks only for permission to manage calendars *it creates* — it makes a separate "Family · Daybook" calendar and never touches her other calendars.

**Resend** — verify a sending domain and create an API key. (Optional: without it, the morning email and email invites are switched off and the app says so.)

Each integration is optional. If one isn't configured, the app shows that plainly and keeps working: no Maps → leave times need a usual travel time typed on the plan; no VAPID keys → reminders show in the app only.

### 3. Server functions

```bash
supabase functions deploy plan
supabase functions deploy dispatch-reminders --no-verify-jwt
supabase functions deploy email --no-verify-jwt
supabase functions deploy gcal --no-verify-jwt
```
(Those three check the caller themselves — Google's redirect and the scheduler don't carry a Supabase login.)

### 4. Scheduled jobs

Open `supabase/cron.sql`, replace `<PROJECT_REF>` and `<CRON_SECRET>`, and run it in the Supabase SQL editor. This sends due reminders every minute, morning emails, hourly Google Calendar sync, and a nightly re-plan that rolls repeating plans forward.

### 5. The website

**Option A — GitHub Pages (already set up in this repo).**
1. Repo → **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Repo → **Settings → Secrets and variables → Actions → Variables** tab → add `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_VAPID_PUBLIC_KEY` (all public values).
3. Repo → **Actions → Publish site → Run workflow** (it also runs on every push).
The site appears at `https://<github-user>.github.io/daybook/`. Use that address (with `/daybook/`) for `APP_URL` and in Supabase's URL configuration.

**Option B — Vercel.** Import the repo in Vercel and add these environment variables:

```
VITE_SUPABASE_URL=https://<PROJECT_REF>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key from Supabase → Settings → API>
VITE_VAPID_PUBLIC_KEY=<the VAPID public key>
```
Build command `npm run build`, output folder `dist`. `vercel.json` already handles page routing.

### 6. On Mom's phone

1. Open the site in **Safari** (iPhone/iPad) → Share → **Add to Home Screen**.
2. Open Daybook **from the Home Screen icon**, create her account, fill in the welcome screen.
3. More → Settings → **Turn on notifications** → **Send a test**.
   iPhone/iPad need iOS 16.4 or later, and Apple only allows notifications for web apps opened from the Home Screen.
4. Optional: Settings → Connect Google Calendar, Morning email, Invite family.

To try it before entering real data, choose "Yes, show examples" at the welcome screen; remove them later with Settings → Remove sample data.

---

## Development

```bash
cp .env.example .env.local     # fill in
npm install
npm run dev                    # app at http://localhost:5173
npm test                       # planner unit tests
npm run check:functions        # type-check the server functions
```

## What was verified, and what wasn't

Verified while building:
- 19 unit tests of the planning engine: time zones (incl. DST), repeating plans, leave-time maths, car chaining, double-booked car/person/driver, availability, unknown travel (never invented), reminder de-duplication, and the example sentence.
- The database schema applied to real Postgres 16, with tests for sharing rules (limited member sees only her own plans and can't edit; outsiders see nothing), sample data add/remove, search, and task-done → reminder cleanup.
- App and server code type-check; production build succeeds; screens checked at iPhone size.

Not verified here (needs your accounts): live Google Maps responses, actual push delivery to a phone, Resend email, the Google sign-in round trip, and the cron jobs firing. Each has a test button or visible status in Settings so you can confirm them after setup.

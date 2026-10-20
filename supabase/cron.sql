-- Run once in the Supabase SQL editor AFTER deploying the functions.
-- Replace the two values first:
--   <PROJECT_REF>   your project's ref (from the project URL)
--   <CRON_SECRET>   the same random string you set with `supabase secrets set CRON_SECRET=...`
create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret('https://<PROJECT_REF>.supabase.co/functions/v1', 'daybook_fn_url');
select vault.create_secret('<CRON_SECRET>', 'daybook_cron_secret');

create or replace function public.daybook_call(fn text, payload jsonb) returns void
language sql security definer as $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'daybook_fn_url') || '/' || fn,
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'daybook_cron_secret')),
    body := payload, timeout_milliseconds := 60000);
$$;
revoke execute on function public.daybook_call from public, anon, authenticated;

-- send due reminders every minute
select cron.schedule('daybook-reminders', '* * * * *', $$ select public.daybook_call('dispatch-reminders', '{}') $$);
-- refresh every household's plan & reminders nightly (rolls recurring events forward, refreshes traffic)
select cron.schedule('daybook-replan', '30 20 * * *', $$ select public.daybook_call('plan', '{"all":true}') $$);  -- 02:00 IST
-- morning email summaries (each person's chosen hour, checked hourly)
select cron.schedule('daybook-email', '1 * * * *', $$ select public.daybook_call('email', '{"action":"summary"}') $$);
-- keep Google Calendar in step
select cron.schedule('daybook-gcal', '17 * * * *', $$ select public.daybook_call('gcal', '{"action":"sync_all"}') $$);
-- tidy old data
select cron.schedule('daybook-tidy', '0 21 * * *', $$
  delete from public.reminders where status <> 'pending' and fire_at < now() - interval '60 days';
  delete from public.travel_cache where fetched_at < now() - interval '30 days';
  delete from public.oauth_states where created_at < now() - interval '1 day';
$$);

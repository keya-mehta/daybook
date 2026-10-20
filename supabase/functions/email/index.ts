// Email via Resend.
//  cron  POST { action: "summary" }            hourly; sends each opted-in member their morning plan once a day
//  user  POST { action: "summary_test", household_id }  sends the caller today's plan now
//  user  POST { action: "invite", invite_id }   emails an invitation (owner only)
import { admin, APP_URL, env, handler, HttpError, isCron, json, memberRole, requireUser } from '../_shared/server.ts';
import { planWithTravel } from '../_shared/planning.ts';
import { fmtTime, localParts } from '../_shared/engine/time.ts';
import type { DayPlan } from '../_shared/engine/planner.ts';

async function send(to: string, subject: string, html: string) {
  const key = env('RESEND_API_KEY'), from = env('EMAIL_FROM');
  if (!key || !from) throw new HttpError(503, 'Email is not configured on the server (RESEND_API_KEY / EMAIL_FROM missing)');
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (!r.ok) throw new Error(`Email failed: ${await r.text()}`);
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

function summaryHtml(day: DayPlan, tz: string, name: string, maps: string, tasksToday: { title: string }[]) {
  const rows = day.items.filter((i) => !i.occ.cancelled).map((i) => {
    const bits = [i.people.map((p) => p.name).join(', '), i.occ.event.location].filter(Boolean).map(esc).join(' · ');
    const leave = i.leaveAt ? `<div style="color:#5f7359">Leave ${fmtTime(i.leaveAt, tz)}${i.vehicle ? ' · ' + esc(i.vehicle.name) : ''}${i.driver ? ' · ' + esc(i.driver.name) : ''}${i.travelSource === 'fallback' ? ' (rough estimate)' : ''}</div>` : '';
    const carry = i.carry.length ? `<div style="color:#7a6a58">Carry: ${i.carry.map((c) => esc(c.text)).join(', ')}</div>` : '';
    return `<tr><td style="padding:10px 12px 10px 0;vertical-align:top;white-space:nowrap;font-weight:600">${i.occ.event.all_day ? 'All day' : fmtTime(i.occ.start, tz)}</td>
      <td style="padding:10px 0;border-bottom:1px solid #e8e4dc"><div style="font-weight:600">${esc(i.occ.event.title)}</div><div style="color:#6b6b66">${bits}</div>${leave}${carry}</td></tr>`;
  }).join('');
  const issues = day.issues.filter((x) => x.severity !== 'info').map((x) => `<li>${esc(x.message)}</li>`).join('');
  const tasks = tasksToday.map((t) => `<li>${esc(t.title)}</li>`).join('');
  return `<div style="font-family:-apple-system,Segoe UI,sans-serif;color:#2b2b28;max-width:560px">
    <p>Good morning ${esc(name)},</p>
    ${rows ? `<table style="border-collapse:collapse;width:100%">${rows}</table>` : '<p>Nothing scheduled today.</p>'}
    ${issues ? `<h3 style="font-size:15px;margin-top:20px">Needs attention</h3><ul>${issues}</ul>` : ''}
    ${tasks ? `<h3 style="font-size:15px;margin-top:20px">To do today</h3><ul>${tasks}</ul>` : ''}
    ${maps !== 'ok' ? '<p style="color:#8a8a84;font-size:13px">Travel times are not from live maps today.</p>' : ''}
    <p><a href="${APP_URL()}" style="color:#5f7359">Open Daybook</a></p></div>`;
}

Deno.serve(handler(async (req) => {
  const body = await req.json().catch(() => ({}));
  const db = admin();
  const now = new Date();

  if (body.action === 'summary' && isCron(req)) {
    const { data: members } = await db.from('household_members').select('*, households(timezone,name)').eq('email_summary', true);
    let sent = 0;
    const errors: string[] = [];
    for (const m of members ?? []) {
      const tz = m.households.timezone;
      const lp = localParts(now, tz);
      if (lp.hh !== m.summary_hour || m.last_summary_on === lp.date || !m.email) continue;
      try {
        await sendSummary(db, m.household_id, m.email, m.display_name ?? '', lp.date, tz, now);
        await db.from('household_members').update({ last_summary_on: lp.date }).eq('household_id', m.household_id).eq('user_id', m.user_id);
        sent++;
      } catch (e) { errors.push(String(e)); }
    }
    return json({ sent, errors });
  }

  const { client, user } = await requireUser(req);
  if (body.action === 'summary_test') {
    const role = await memberRole(client, body.household_id, user.id);
    if (!role || role === 'limited') throw new HttpError(403, 'Not allowed');
    const { data: hh } = await db.from('households').select('timezone').eq('id', body.household_id).single();
    await sendSummary(db, body.household_id, user.email!, '', localParts(now, hh!.timezone).date, hh!.timezone, now);
    return json({ ok: true, to: user.email });
  }
  if (body.action === 'invite') {
    const { data: inv } = await client.from('invites').select('*, households(name)').eq('id', body.invite_id).single();
    if (!inv || (await memberRole(client, inv.household_id, user.id)) !== 'owner') throw new HttpError(403, 'Not allowed');
    await send(inv.email, `You're invited to ${inv.households.name} on Daybook`,
      `<p>You've been invited to see plans for <b>${esc(inv.households.name)}</b>.</p>
       <p><a href="${APP_URL()}/login?email=${encodeURIComponent(inv.email)}">Create your account</a> using this email address (${esc(inv.email)}) and you'll be added automatically.</p>`);
    return json({ ok: true });
  }
  throw new HttpError(400, 'Unknown action');
}));

async function sendSummary(db: ReturnType<typeof admin>, householdId: string, to: string, name: string, date: string, tz: string, now: Date) {
  const { res, data, maps } = await planWithTravel(db, db, householdId, date, date, now);
  const day = res.days[0];
  const tasksToday = data.tasks.filter((t) => t.due_date && t.due_date <= date);
  const label = new Intl.DateTimeFormat('en-IN', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(now);
  await send(to, `Today · ${label}`, summaryHtml(day, tz, name, maps.status, tasksToday));
}

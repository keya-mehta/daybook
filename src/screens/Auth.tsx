import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useStore } from '../lib/store';
import { Banner, Chips, Q } from '../ui/kit';
import { toast } from '../lib/toast';

export function Login() {
  const params = new URLSearchParams(location.search);
  const [mode, setMode] = useState<'in' | 'up' | 'reset'>(params.get('email') ? 'up' : 'in');
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      if (mode === 'in') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pw });
        if (error) throw error;
      } else if (mode === 'up') {
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password: pw, options: { emailRedirectTo: location.origin } });
        if (error) throw error;
        if (!data.session) setMsg({ kind: 'ok', text: `Check ${email} for a link to confirm your account, then come back and sign in.` });
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${location.origin}/reset` });
        if (error) throw error;
        setMsg({ kind: 'ok', text: 'If that email has an account, a reset link is on its way.' });
      }
    } catch (err) {
      const m = (err as Error).message;
      setMsg({ kind: 'bad', text: /Invalid login/i.test(m) ? 'Email or password is not right.' : /fetch/i.test(m) ? "Couldn't reach the server — check your internet." : m });
    } finally { setBusy(false); }
  };
  return (
    <div className="center-page">
      <form className="auth-box" onSubmit={submit}>
        <div className="logo">Day<i>book</i></div>
        <p className="ink2" style={{ marginTop: 4 }}>Everyone's plans, one clear day.</p>
        <div className="seg" style={{ marginTop: 20 }}>
          <button type="button" className={mode === 'in' ? 'on' : ''} onClick={() => setMode('in')}>Sign in</button>
          <button type="button" className={mode === 'up' ? 'on' : ''} onClick={() => setMode('up')}>Create account</button>
        </div>
        <Q label="Email"><input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Q>
        {mode !== 'reset' && <Q label="Password" hint={mode === 'up' ? 'at least 8 characters' : ''}><input className="input" type="password" autoComplete={mode === 'up' ? 'new-password' : 'current-password'} required minLength={mode === 'up' ? 8 : 1} value={pw} onChange={(e) => setPw(e.target.value)} /></Q>}
        <button className="btn primary block" style={{ marginTop: 18 }} disabled={busy}>{busy ? 'Please wait…' : mode === 'in' ? 'Sign in' : mode === 'up' ? 'Create account' : 'Send reset link'}</button>
        {mode === 'in' && <button type="button" className="btn ghost block" style={{ marginTop: 6 }} onClick={() => setMode('reset')}>Forgot password?</button>}
        {mode === 'reset' && <button type="button" className="btn ghost block" style={{ marginTop: 6 }} onClick={() => setMode('in')}>Back to sign in</button>}
        {msg && <Banner kind={msg.kind === 'ok' ? 'ok' : 'bad'}>{msg.text}</Banner>}
      </form>
    </div>
  );
}

export function ResetPassword() {
  const [pw, setPw] = useState('');
  return (
    <div className="center-page"><div className="auth-box">
      <div className="logo">Day<i>book</i></div>
      <Q label="New password"><input className="input" type="password" minLength={8} value={pw} onChange={(e) => setPw(e.target.value)} /></Q>
      <button className="btn primary block" style={{ marginTop: 14 }} disabled={pw.length < 8} onClick={async () => {
        const { error } = await supabase.auth.updateUser({ password: pw });
        if (error) toast(error.message, 'error'); else { toast('Password changed'); location.href = '/'; }
      }}>Save password</button>
    </div></div>
  );
}

export function Onboarding() {
  const { reload, session } = useStore();
  const deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [name, setName] = useState('');
  const [family, setFamily] = useState('');
  const [home, setHome] = useState('');
  const [sample, setSample] = useState<'yes' | 'no'>('yes');
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    const { data: h, error } = await supabase.rpc('create_household', { p_name: family || `${name}'s family`, p_timezone: deviceTz, p_display_name: name || null });
    if (error) { toast(error.message, 'error'); setBusy(false); return; }
    if (home.trim()) await supabase.from('households').update({ home_address: home.trim() }).eq('id', h);
    if (sample === 'yes') await supabase.rpc('seed_sample', { h });
    localStorage.setItem('daybook:hh', h as string);
    await reload();
    setBusy(false);
  };
  return (
    <div className="center-page"><div className="auth-box">
      <div className="logo">Welcome</div>
      <p className="ink2">A few details to get started. You can change all of this later.</p>
      <Q label="Your name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Meera" /></Q>
      <Q label="What should we call the family?"><input className="input" value={family} onChange={(e) => setFamily(e.target.value)} placeholder="e.g. Mehta family" /></Q>
      <Q label="Home address" hint="for travel times"><textarea className="input" value={home} onChange={(e) => setHome(e.target.value)} placeholder="Building, street, area, city" /></Q>
      <Q label="Show some sample plans to try it out?"><Chips options={[{ label: 'Yes, show examples', value: 'yes' }, { label: 'No, start empty', value: 'no' }]} value={sample} onChange={(v) => setSample(v as 'yes' | 'no')} /></Q>
      <p className="tiny muted">Time zone: {deviceTz}</p>
      <button className="btn primary block" style={{ marginTop: 14 }} disabled={busy} onClick={start}>{busy ? 'Setting up…' : 'Start'}</button>
      <button className="btn ghost block" onClick={() => supabase.auth.signOut()}>Sign out ({session?.user.email})</button>
      <p className="tiny muted">Expecting to join someone else's family? Ask them to invite {session?.user.email}, then reopen Daybook.</p>
    </div></div>
  );
}

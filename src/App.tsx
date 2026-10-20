import { NavLink, Navigate, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useStore } from './lib/store';
import { configured } from './lib/supabase';
import { Toasts } from './lib/toast';
import { IHome, ICal, ITasks, IPeople, IMore, IPlus } from './ui/icons';
import { Home } from './screens/Home';
import { Calendar } from './screens/Calendar';
import { Tasks } from './screens/Tasks';
import { People, PersonPage } from './screens/People';
import { More, ComingUp, Search } from './screens/More';
import { Transport } from './screens/Transport';
import { Reminders } from './screens/Reminders';
import { Notes, Places } from './screens/Notes';
import { Settings } from './screens/Settings';
import { Login, Onboarding, ResetPassword } from './screens/Auth';
import { AddPlan } from './screens/AddPlan';
import { EventSheet } from './screens/EventSheet';
import { Banner } from './ui/kit';
import { startDemo, endDemo } from './lib/demo';

export function App() {
  const { session, authReady, data, loading, loadError, householdId, canEdit, demo } = useStore();
  const loc = useLocation();
  if (!configured && !demo) return (
    <div className="center-page"><div className="auth-box">
      <div className="logo">Day<i>book</i></div>
      <p className="ink2" style={{ marginTop: 4 }}>Everyone's plans, one clear day.</p>
      <button className="btn primary block" style={{ marginTop: 22 }} onClick={startDemo}>Try it now with a sample family</button>
      <p className="small muted" style={{ marginTop: 8 }}>The demo runs on this device only. You can add and change plans; nothing is sent anywhere.</p>
      <Banner kind="info">Accounts, syncing between phones, reminders and Google Maps switch on once the database is connected (setup steps 1–5 in the README).</Banner>
    </div></div>
  );
  if (loc.pathname === '/reset') return <ResetPassword />;
  if (!authReady) return <Splash />;
  if (!session) return <><Login /><Toasts /></>;
  if (loading && !data) return <Splash />;
  if (!householdId || !data) return loadError && loadError !== 'offline'
    ? <div className="center-page"><div className="auth-box"><Banner kind="bad">Couldn't load your plans: {loadError}</Banner><button className="btn block" style={{ marginTop: 12 }} onClick={() => location.reload()}>Try again</button></div></div>
    : <><Onboarding /><Toasts /></>;
  return (
    <div className="app">
      {demo && <div className="demo-bar"><span>Demo — saved on this device only</span><button onClick={() => confirm('Leave the demo and clear its data?') && endDemo()}>Leave demo</button></div>}
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/calendar" element={<Calendar />} />
        <Route path="/tasks" element={<Tasks />} />
        <Route path="/people" element={<People />} />
        <Route path="/people/:id" element={<PersonPage />} />
        <Route path="/more" element={<More />} />
        <Route path="/more/coming-up" element={<ComingUp />} />
        <Route path="/more/transport" element={<Transport />} />
        <Route path="/more/reminders" element={<Reminders />} />
        <Route path="/reminders" element={<Navigate to="/more/reminders" replace />} />
        <Route path="/more/notes" element={<Notes />} />
        <Route path="/more/places" element={<Places />} />
        <Route path="/more/search" element={<Search />} />
        <Route path="/more/settings" element={<Settings />} />
        <Route path="/event/:id" element={<EventRedirect />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Overlays />
      {canEdit && <AddButton />}
      <nav className="nav" aria-label="Main">
        <div className="nav-inner">
          <NavLink to="/" end><IHome />Home</NavLink>
          <NavLink to="/calendar"><ICal />Calendar</NavLink>
          <NavLink to="/tasks"><ITasks />Tasks</NavLink>
          <NavLink to="/people"><IPeople />People</NavLink>
          <NavLink to="/more"><IMore />More</NavLink>
        </div>
      </nav>
      <Toasts />
    </div>
  );
}

function AddButton() {
  const nav = useNavigate(), loc = useLocation();
  const [p] = useSearchParams();
  if (p.get('add') || p.get('event')) return null;
  return <button className="fab" onClick={() => { const q = new URLSearchParams(loc.search); q.set('add', '1'); nav({ pathname: loc.pathname, search: q.toString() }); }}><IPlus />Add</button>;
}

// sheets open on top of whatever page you're on, via ?add=1 or ?event=<id>&date=<date>
function Overlays() {
  const [p, setP] = useSearchParams();
  const close = (...keys: string[]) => { keys.forEach((k) => p.delete(k)); setP(p, { replace: false }); };
  if (p.get('add')) return <AddPlan date={p.get('date') ?? undefined} personId={p.get('person') ?? undefined} onClose={() => close('add', 'person', 'date')} />;
  if (p.get('event')) return <EventSheet id={p.get('event')!} date={p.get('date') ?? new Date().toISOString().slice(0, 10)} onClose={() => close('event', 'date')} />;
  return null;
}

function EventRedirect() {
  const { id } = useParams();
  const [p] = useSearchParams();
  return <Navigate to={`/?event=${id}${p.get('date') ? `&date=${p.get('date')}` : ''}`} replace />;
}

function Splash() {
  return <div className="center-page"><div className="logo" style={{ opacity: .6 }}>Day<i>book</i></div></div>;
}

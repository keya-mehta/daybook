import { useEffect, useState } from 'react';

type T = { id: number; text: string; kind: 'ok' | 'error'; action?: { label: string; run: () => void } };
let listeners: ((t: T[]) => void)[] = [];
let items: T[] = [];
let n = 0;

export function toast(text: string, kind: 'ok' | 'error' = 'ok', action?: T['action']) {
  const t = { id: ++n, text, kind, action };
  items = [...items.slice(-2), t];
  listeners.forEach((l) => l(items));
  setTimeout(() => { items = items.filter((x) => x.id !== t.id); listeners.forEach((l) => l(items)); }, kind === 'error' ? 6000 : action ? 5000 : 2200);
}

export function Toasts() {
  const [list, setList] = useState<T[]>([]);
  useEffect(() => { listeners.push(setList); return () => { listeners = listeners.filter((l) => l !== setList); }; }, []);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast ${t.kind === 'error' ? 'error' : ''}`}>
          <span>{t.text}</span>
          {t.action && <button onClick={() => { t.action!.run(); items = items.filter((x) => x.id !== t.id); listeners.forEach((l) => l(items)); }}>{t.action.label}</button>}
        </div>
      ))}
    </div>
  );
}

import { useEffect, type ReactNode } from 'react';
import { IClose, IBack, IAlert, IInfo, ICheck } from './icons';
import type { Person } from '@engine/types.ts';

export function Chips<T extends string>({ options, value, onChange, scroll }: {
  options: { label: ReactNode; value: T; dot?: string }[]; value: T | null | undefined; onChange: (v: T) => void; scroll?: boolean;
}) {
  return (
    <div className={`chips ${scroll ? 'scroll' : ''}`} role="radiogroup">
      {options.map((o) => (
        <button type="button" key={o.value} role="radio" aria-checked={value === o.value} className={`chip ${value === o.value ? 'on' : ''}`} onClick={() => onChange(o.value)}>
          {o.dot && <span className="dot" style={{ background: o.dot }} />}{o.label}
        </button>
      ))}
    </div>
  );
}

export function MultiChips<T extends string>({ options, value, onChange, scroll }: {
  options: { label: ReactNode; value: T; dot?: string }[]; value: T[]; onChange: (v: T[]) => void; scroll?: boolean;
}) {
  return (
    <div className={`chips ${scroll ? 'scroll' : ''}`}>
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <button type="button" key={o.value} aria-pressed={on} className={`chip ${on ? 'on' : ''}`} onClick={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])}>
            {o.dot && <span className="dot" style={{ background: o.dot }} />}{on && <ICheck />}{o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Q({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return <div className="q"><div className="q-label"><span>{label}</span>{hint && <small>{hint}</small>}</div>{children}</div>;
}

export function Sheet({ title, onClose, children, footer, back }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; back?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { removeEventListener('keydown', k); document.body.style.overflow = prev; };
  }, [onClose]);
  return (
    <div className="sheet-back" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal aria-label={typeof title === 'string' ? title : undefined}>
        <div className="sheet-head">
          {back && <button className="iconbtn" onClick={onClose} aria-label="Back"><IBack /></button>}
          <h2>{title}</h2>
          {!back && <button className="iconbtn" onClick={onClose} aria-label="Close"><IClose /></button>}
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Avatar({ p, size }: { p: Pick<Person, 'name' | 'initials' | 'color' | 'photo_url'>; size?: 'sm' | 'lg' }) {
  const ini = p.initials || p.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <span className={`avatar ${size ?? ''}`} style={{ background: p.photo_url ? `url(${p.photo_url}) center/cover` : p.color }} title={p.name}>
      {!p.photo_url && ini}
    </span>
  );
}

export function Banner({ kind = 'warn', children }: { kind?: 'warn' | 'info' | 'ok' | 'bad'; children: ReactNode }) {
  return <div className={`banner ${kind === 'warn' ? '' : kind}`}>{kind === 'info' || kind === 'ok' ? <IInfo /> : <IAlert />}<div>{children}</div></div>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty"><div className="serif">{title}</div>{children}</div>;
}

export const PERSON_COLORS = ['#6c8768', '#a7835f', '#7f7499', '#5f8590', '#a76a6a', '#8d8a52', '#6b7a8f', '#9a7086'];
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));

// iPhone-alarm style time picker: three scrolling wheels (hour, minute, AM/PM).
// Works with a finger swipe, a mouse wheel, a trackpad, or by tapping a number.
import { useEffect, useRef } from 'react';

const ROW = 44; // px per row
const VISIBLE = 5; // rows shown

function Column({ items, index, onPick, label }: { items: string[]; index: number; onPick: (i: number) => void; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const settling = useRef<number>();
  const userScrolling = useRef(false);

  // keep the wheel in sync when the value changes from outside
  useEffect(() => {
    const el = ref.current;
    if (!el || userScrolling.current) return;
    const target = index * ROW;
    if (Math.abs(el.scrollTop - target) > 2) el.scrollTo({ top: target });
  }, [index]);

  const onScroll = () => {
    userScrolling.current = true;
    clearTimeout(settling.current);
    settling.current = window.setTimeout(() => {
      userScrolling.current = false;
      const el = ref.current;
      if (!el) return;
      const i = Math.max(0, Math.min(items.length - 1, Math.round(el.scrollTop / ROW)));
      if (Math.abs(el.scrollTop - i * ROW) > 1) el.scrollTo({ top: i * ROW, behavior: 'smooth' });
      if (i !== index) onPick(i);
    }, 110);
  };

  return (
    <div className="wheel-col" ref={ref} onScroll={onScroll} role="listbox" aria-label={label} tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); onPick(Math.min(items.length - 1, index + 1)); }
        if (e.key === 'ArrowUp') { e.preventDefault(); onPick(Math.max(0, index - 1)); }
      }}>
      <div style={{ height: ROW * Math.floor(VISIBLE / 2) }} />
      {items.map((t, i) => (
        <div key={t + i} role="option" aria-selected={i === index} className={`wheel-item ${i === index ? 'on' : ''}`}
          onClick={() => { ref.current?.scrollTo({ top: i * ROW, behavior: 'smooth' }); onPick(i); }}>{t}</div>
      ))}
      <div style={{ height: ROW * Math.floor(VISIBLE / 2) }} />
    </div>
  );
}

const HOURS = ['12', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'];
const MINS = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'));

/** value and onChange use 24-hour "HH:MM" */
export function TimeWheel({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  // always build on the newest value, so two wheels settling together can't undo each other
  const cur = useRef(value);
  cur.current = value;
  const parts = (v: string) => { const [h, m] = v.split(':').map(Number); return { h12: h % 12, mi: Math.round(m / 5) % 12, pm: h >= 12 }; };
  const { h12, mi, pm } = parts(value);
  const change = (patch: Partial<{ h12: number; mi: number; pm: boolean }>) => {
    const p = { ...parts(cur.current), ...patch };
    const next = `${String(p.h12 + (p.pm ? 12 : 0)).padStart(2, '0')}:${String(p.mi * 5).padStart(2, '0')}`;
    cur.current = next;
    onChange(next);
  };
  return (
    <div className="wheel" style={{ height: ROW * VISIBLE }}>
      <div className="wheel-band" style={{ top: ROW * Math.floor(VISIBLE / 2), height: ROW }} />
      <Column label="Hour" items={HOURS} index={h12} onPick={(i) => change({ h12: i })} />
      <div className="wheel-colon">:</div>
      <Column label="Minutes" items={MINS} index={mi} onPick={(i) => change({ mi: i })} />
      <Column label="AM or PM" items={['AM', 'PM']} index={pm ? 1 : 0} onPick={(i) => change({ pm: i === 1 })} />
    </div>
  );
}

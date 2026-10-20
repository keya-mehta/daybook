// Thin-stroke icons, drawn for this app.
const P = (d: string | JSX.Element) => (props: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={props.className}>
    {typeof d === 'string' ? <path d={d} /> : d}
  </svg>
);
export const IHome = P(<><path d="M4 10.5 12 4l8 6.5" /><path d="M6 9.5V20h12V9.5" /><path d="M10 20v-5h4v5" /></>);
export const ICal = P(<><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 9.5h17M8 3v4M16 3v4" /></>);
export const ITasks = P(<><path d="m4 7 2 2 3.5-3.5M4 16l2 2 3.5-3.5" /><path d="M13 8h7M13 17h7" /></>);
export const IPeople = P(<><circle cx="9" cy="8.5" r="3.2" /><path d="M3.5 19c.6-3 2.8-4.6 5.5-4.6s4.9 1.6 5.5 4.6" /><circle cx="17" cy="9.5" r="2.4" /><path d="M16 14.6c2.3 0 4 1.3 4.5 3.9" /></>);
export const IMore = P(<><circle cx="5.5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="18.5" cy="12" r="1.2" /></>);
export const IPlus = P('M12 5v14M5 12h14');
export const IClose = P('M6 6l12 12M18 6 6 18');
export const IBack = P('M15 5l-7 7 7 7');
export const IChev = P('M9 6l6 6-6 6');
export const ICheck = P('M5 12.5 10 17l9-10');
export const ICar = P(<><path d="M5 16.5V12l1.8-4.6c.3-.8 1-1.4 1.9-1.4h6.6c.9 0 1.6.6 1.9 1.4L19 12v4.5" /><path d="M4 12h16v4.5H4z" /><circle cx="7.5" cy="16.5" r="1.6" /><circle cx="16.5" cy="16.5" r="1.6" /></>);
export const IPin = P(<><path d="M12 21s-6-5.4-6-10.5A6 6 0 0 1 18 10.5C18 15.6 12 21 12 21z" /><circle cx="12" cy="10.5" r="2.2" /></>);
export const IClock = P(<><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>);
export const IBag = P(<><path d="M5.5 8h13l-1 12h-11z" /><path d="M9 8V6.5a3 3 0 0 1 6 0V8" /></>);
export const IBell = P(<><path d="M6.5 16V11a5.5 5.5 0 0 1 11 0v5l1.5 2h-14z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></>);
export const IAlert = P(<><path d="M12 4 2.8 19.5h18.4z" /><path d="M12 10v4.5M12 17.3v.1" /></>);
export const IInfo = P(<><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 8v.1" /></>);
export const ISearch = P(<><circle cx="11" cy="11" r="6" /><path d="m20 20-4.5-4.5" /></>);
export const IPhone = P('M6.5 4h3l1.5 4-2 1.2a10 10 0 0 0 5.8 5.8l1.2-2 4 1.5v3c0 .8-.7 1.5-1.5 1.5C10.9 19 5 13.1 5 5.5 5 4.7 5.7 4 6.5 4z');
export const IEdit = P(<><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="m13.5 6.5 4 4" /></>);
export const ICopy = P(<><rect x="8" y="8" width="11.5" height="11.5" rx="1.5" /><path d="M5 15.5V5.5c0-.6.4-1 1-1h10" /></>);
export const ITrash = P(<><path d="M5 7h14M9.5 7V4.5h5V7M7 7l1 13h8l1-13" /></>);
export const IRepeat = P(<><path d="M5 11V9.5A3.5 3.5 0 0 1 8.5 6H19l-3-3M19 13v1.5a3.5 3.5 0 0 1-3.5 3.5H5l3 3" /></>);
export const ISpark = P('M12 3.5 13.6 9 19 10.5 13.6 12 12 17.5 10.4 12 5 10.5 10.4 9z');
export const ITalk = P(<><path d="M4.5 6.5h15v9.5h-8l-4.5 3.5V16h-2.5z" /><path d="M8.5 10.5h7M8.5 13h4.5" /></>);
export const INote = P(<><path d="M6 3.5h9l3.5 3.5v13.5H6z" /><path d="M9 11h6.5M9 14.5h6.5M14.5 3.5V7.5h4" /></>);
export const ISettings = P(<><circle cx="12" cy="12" r="2.8" /><path d="M12 3.5v2.2M12 18.3v2.2M20.5 12h-2.2M5.7 12H3.5M18 6l-1.6 1.6M7.6 16.4 6 18M18 18l-1.6-1.6M7.6 7.6 6 6" /></>);
export const IExport = P(<><path d="M12 4v11M7.5 8.5 12 4l4.5 4.5" /><path d="M5 14v5.5h14V14" /></>);
export const IUser = P(<><circle cx="12" cy="8.5" r="3.5" /><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" /></>);
export const ISun = P(<><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" /></>);
export const IList = P('M8 6.5h12M8 12h12M8 17.5h12M4 6.5h.1M4 12h.1M4 17.5h.1');
export const ISteering = P(<><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="2" /><path d="M3.8 10.5c2.6-.8 5.3-1.2 8.2-1.2s5.6.4 8.2 1.2M10.5 13.8 8 20M13.5 13.8 16 20" /></>);

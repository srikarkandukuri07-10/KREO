// Minimal monochrome SVG icon set (own design, 24x24, stroke-based).
import React from 'react';

type P = { size?: number };
const S = ({ size = 19, children }: P & { children: React.ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

export const I = {
  select: (p: P) => <S {...p}><path d="M6 3l14 7-6.5 1.5L10 18 6 3z" /></S>,
  hand: (p: P) => <S {...p}><path d="M8 12V5.5a1.5 1.5 0 013 0V11m0-5.5v-1a1.5 1.5 0 013 0V11m0-4.5a1.5 1.5 0 013 0V12m0-2.5a1.5 1.5 0 013 0V15a6 6 0 01-6 6h-1.8a6 6 0 01-4.7-2.3L4 14.5a1.6 1.6 0 012.5-2L8 14" /></S>,
  rect: (p: P) => <S {...p}><rect x="4" y="6" width="16" height="12" rx="2" /></S>,
  diamond: (p: P) => <S {...p}><path d="M12 3l7 9-7 9-7-9 7-9z" /></S>,
  ellipse: (p: P) => <S {...p}><ellipse cx="12" cy="12" rx="8" ry="6" /></S>,
  arrow: (p: P) => <S {...p}><path d="M4 12h15m-6-6l6 6-6 6" /></S>,
  line: (p: P) => <S {...p}><path d="M5 19L19 5" /></S>,
  pen: (p: P) => <S {...p}><path d="M12 19l7-7 3 3-7 7-3-3z" /><path d="M18 13l-1.5-7.5L2 12l7.5 1.5L18 13z" /><path d="M2 12l7.5 1.5" /><circle cx="11" cy="11" r="2" /></S>,
  text: (p: P) => <S {...p}><path d="M5 6V4h14v2M12 4v16m-3 0h6" /></S>,
  image: (p: P) => <S {...p}><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="M4 17l5-5 4 4 3-3 4 4" /></S>,
  eraser: (p: P) => <S {...p}><path d="M7 21l-4-4L13 7l5 5-7 7H7z" /><path d="M13 7l4-4 4 4-5 5" /><path d="M7 21h14" /></S>,
  more: (p: P) => <S {...p}><circle cx="5" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="19" cy="12" r="1.4" /></S>,
  menu: (p: P) => <S {...p}><path d="M4 7h16M4 12h16M4 17h16" /></S>,
  share: (p: P) => <S {...p}><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="M8.2 10.8l7.6-3.6M8.2 13.2l7.6 3.6" /></S>,
  plus: (p: P) => <S {...p}><path d="M12 5v14M5 12h14" /></S>,
  minus: (p: P) => <S {...p}><path d="M5 12h14" /></S>,
  fit: (p: P) => <S {...p}><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></S>,
  help: (p: P) => <S {...p}><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 115 0c0 1.5-2.5 2-2.5 3.5" /><circle cx="12" cy="17" r="0.6" /></S>,
  gear: (p: P) => <S {...p}><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 00-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 00-2-1.2L14.2 3h-4l-.4 2.7a7 7 0 00-2 1.2l-2.3-1-2 3.4 2 1.5a7 7 0 000 2.4l-2 1.5 2 3.4 2.3-1a7 7 0 002 1.2l.4 2.7h4l.4-2.7a7 7 0 002-1.2l2.3 1 2-3.4-2-1.5c.06-.4.1-.8.1-1.2z" /></S>,
  undo: (p: P) => <S {...p}><path d="M8 5L3 10l5 5" /><path d="M3 10h11a6 6 0 016 6v1" /></S>,
  redo: (p: P) => <S {...p}><path d="M16 5l5 5-5 5" /><path d="M21 10H10a6 6 0 00-6 6v1" /></S>,
  lock: (p: P) => <S {...p}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 018 0v3" /></S>,
  unlock: (p: P) => <S {...p}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 017.5-2" /></S>,
  trash: (p: P) => <S {...p}><path d="M4 7h16M9 7V5h6v2m-8 0l1 13h8l1-13" /></S>,
  copy: (p: P) => <S {...p}><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 012-2h10" /></S>,
  group: (p: P) => <S {...p}><rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="13" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="8" rx="1.5" /><rect x="3" y="13" width="8" height="8" rx="1.5" /></S>,
  download: (p: P) => <S {...p}><path d="M12 4v11m-5-5l5 5 5-5" /><path d="M4 20h16" /></S>,
  upload: (p: P) => <S {...p}><path d="M12 15V4m-5 5l5-5 5 5" /><path d="M4 20h16" /></S>,
  check: (p: P) => <S {...p}><path d="M4 12.5l5 5L20 6.5" /></S>,
  x: (p: P) => <S {...p}><path d="M6 6l12 12M18 6L6 18" /></S>,
  search: (p: P) => <S {...p}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></S>,
  users: (p: P) => <S {...p}><circle cx="9" cy="8" r="3.5" /><path d="M3 20a6 6 0 0112 0" /><path d="M16 4.5a3.5 3.5 0 010 7M21 20a6 6 0 00-4-5.6" /></S>,
};

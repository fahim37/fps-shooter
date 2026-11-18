import type { ReactNode } from "react";

const lean = <>
  <path d="M18 3h3v18h-3z" fill="currentColor" opacity=".45" />
  <circle cx="9" cy="7.5" r="3" fill="currentColor" />
  <path d="m7 20 1.4-5.7c.5-2 2.4-3.1 4.4-2.3l3.2 1.4V20Z" fill="currentColor" />
  <path d="M5.5 13.5H2m2-2-2 2 2 2" />
</>;

const glyphs = {
  fire: <>
    <path d="M9 8c0-2.2 1.2-4.6 3-6.6 1.8 2 3 4.4 3 6.6Z" fill="currentColor" stroke="none" />
    <path d="M8.2 10h7.6v9H8.2z" fill="currentColor" stroke="none" />
    <path d="M8 21.5h8M5.2 10.3l-2 3.4M5.3 15.7 4 18" />
  </>,
  ads: <>
    <circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none" />
    <path d="M12 1.5v5M12 17.5v5M1.5 12h5M17.5 12h5" />
  </>,
  jump: <>
    <circle cx="14.7" cy="4.7" r="2.5" fill="currentColor" stroke="none" />
    <path d="m6 9 4.2 1.6 3-2.6 4.1 1.4 3.2-4M13 9l-3 5 5.2 1.1-2.2 5.4M10 14l-3.8 3.2L2.8 16" strokeWidth="2.8" />
    <path d="M2 21h5" opacity=".5" />
  </>,
  crouch: <>
    <circle cx="15.5" cy="6" r="2.6" fill="currentColor" stroke="none" />
    <path d="m14 10-3.7 4.1 6.4 1.6-1.5 4.5h4M12.5 11l3.4 1.7 4.4-1.1M10.3 14.1 7 18.8H3" strokeWidth="2.8" />
    <path d="M2 22h8" opacity=".5" />
  </>,
  sprint: <>
    <circle cx="16.5" cy="4.4" r="2.4" fill="currentColor" stroke="none" />
    <path d="m6.2 10 3.5-3 4.7 1.2-3.8 5.4 5 2.2-1.8 5.5M14 8.7l3.4 3.2 3.2-.8M10.5 14.2l-3 4.5H3" strokeWidth="2.6" />
    <path d="M2.5 5.5h4M1.5 8.5H4" opacity=".55" />
  </>,
  reload: <>
    <path d="m9.2 9.1 5.1-1.2 2 8.8-5.1 1.2z" fill="currentColor" stroke="none" />
    <path d="m10 19.7 7.8-1.8M4.8 16a8.2 8.2 0 0 1 13-9.6M18.5 2.6v4.7h-4.7" />
  </>,
  switch: <><path d="M3 8h17l-4-4M21 16H4l4 4" /><path d="m16 12 4-4M8 12l-4 4" opacity=".6" /></>,
  peekLeft: lean,
  peekRight: <g transform="translate(24 0) scale(-1 1)">{lean}</g>,
  grenade: <>
    <path fill="currentColor" stroke="none" d="M7.7 9h4.1v3.2H5.5A8 8 0 0 1 7.7 9Zm5.8 0H16a8.6 8.6 0 0 1 2.4 3.2h-4.9ZM5 14h6.8v3H5a9 9 0 0 1 0-3Zm8.5 0H19c.2 1 .2 2 0 3h-5.5ZM5.6 18.7h6.2v3.5a7.1 7.1 0 0 1-6.2-3.5Zm7.9 0h4.8a7.4 7.4 0 0 1-4.8 3.3Z" />
    <path d="M9 7V4.7h5V7M11 3h5.4l4 5.2" />
  </>,
  camera: <>
    <path d="M3 7.5h4l2-3h6l2 3h4v12H3z" fill="currentColor" opacity=".22" />
    <path d="M3 7.5h4l2-3h6l2 3h4v12H3z" /><circle cx="12" cy="13" r="3.2" />
  </>,
  emote: <><circle cx="12" cy="12" r="8.8" /><path d="M7.8 14a4.7 4.7 0 0 0 8.4 0" /><path d="M8.7 9h.1m6.4 0h.1" strokeWidth="2.9" /></>,
  scores: <><path d="M3 12h5v9H3zM10 4h5v17h-5z" fill="currentColor" stroke="none" /><path d="M17 8h4v13h-4z" fill="currentColor" opacity=".55" stroke="none" /></>,
  menu: <g fill="currentColor" stroke="none"><rect x="5" y="4" width="5" height="16" rx="1.3" /><rect x="14" y="4" width="5" height="16" rx="1.3" /></g>,
  more: <g fill="currentColor" stroke="none"><circle cx="4.5" cy="12" r="2.2" /><circle cx="12" cy="12" r="2.2" /><circle cx="19.5" cy="12" r="2.2" /></g>,
  layout: <><rect x="2.5" y="5" width="19" height="14" rx="3" /><circle cx="8" cy="13" r="2.5" fill="currentColor" stroke="none" /><path d="M15 9h3m-1 5h1" /></>,
} satisfies Record<string, ReactNode>;

export type TouchIconName = keyof typeof glyphs;

export function TouchIcon({ name }: { name: TouchIconName }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{glyphs[name]}</svg>;
}

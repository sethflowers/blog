// Line icons for the interface (drawn here as SVG: no icon fonts or emoji).
const s = (d, extra = '') => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;
export const ICON = {
  select: s('<path d="M5 3l13 8-6 1.5L9 19z"/>'),
  paths: s('<path d="M7 21L10 3M17 21L14 3M12 6v2M12 11v2M12 16v2"/>'),
  plants: s('<path d="M12 21v-6"/><path d="M12 15c-4.5 0-6.5-2.6-6.5-5.4C5.5 6.4 8.4 3 12 3s6.5 3.4 6.5 6.6c0 2.8-2 5.4-6.5 5.4z"/>'),
  decor: s('<path d="M12 21V9M9 21h6M9.5 9h5l-1-4h-3z"/><path d="M12 2.5v2.5"/>'),
  terrain: s('<path d="M2.5 19l6-9 4 5.5 3-4 6 7.5z"/><path d="M14 6.5l1.5-2 1.5 2"/>'),
  lands: s('<path d="M5 21V4M5 4h11l-2 3.5 2 3.5H5"/>'),
  park: s('<path d="M3 21V10l3-3 3 3v11M15 21V10l3-3 3 3v11M9 13h6M9 21v-4a3 3 0 0 1 6 0v4"/>'),
  bulldoze: s('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>'),
  undo: s('<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>'),
  redo: s('<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>'),
  walk: s('<circle cx="13" cy="4" r="1.8"/><path d="M10 21l2-6 3 3v3M8 12l3-4 3 1 2 3M12 15l-1-4"/>'),
  build: s('<path d="M3 21h18M5 21V8l7-5 7 5v13M9 21v-6h6v6"/>'),
  vr: s('<path d="M3 8h18v9h-6l-2-3h-2l-2 3H3z"/><circle cx="7.5" cy="12" r="1.5"/><circle cx="16.5" cy="12" r="1.5"/>'),
  menu: s('<path d="M4 6h16M4 12h16M4 18h16"/>'),
  close: s('<path d="M6 6l12 12M18 6L6 18"/>'),
  pause: s('<path d="M8 5v14M16 5v14"/>'),
  play: s('<path d="M7 4l12 8-12 8z"/>'),
  fast: s('<path d="M3 5l9 7-9 7zM12 5l9 7-9 7z"/>'),
  faster: s('<path d="M2 6l7 6-7 6zM9 6l7 6-7 6zM16 6l6 6-6 6"/>'),
};

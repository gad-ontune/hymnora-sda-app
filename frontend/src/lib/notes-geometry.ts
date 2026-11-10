/**
 * Where the notepad sits, as arithmetic.
 *
 * The pad's placement is the reader's to choose, which means the numbers have to
 * survive the reader's own choices: dragged off the edge, left at the far corner
 * of a desktop, then read on a phone. So this is kept apart from the store and
 * from React, and it takes the viewport as an argument rather than reaching for
 * `window` — which is the only way to test a placement saved on one screen being
 * found on another.
 *
 * The rule is that whatever is on screen is always fully on screen. A pad that
 * can be pushed half out of the window is a pad with a title bar the reader
 * cannot grab, and there is no way back from there except clearing storage. The
 * catch is the word "whatever": a pad cropped to a book icon is forty pixels
 * tall, not three hundred and eighty — so the position is clamped against the
 * *visible* size, which is what lets that icon sit at the very bottom of the
 * screen next to a thumb. When it is opened again the clamp, told the expanded
 * size, brings it back to where the whole pad fits. `clampNotesGeometry` takes
 * that visible size as an argument rather than assuming.
 *
 * A pad has two sizes. `w`/`h` are the working pad, the size the reader writes
 * in and stretches with the corner grip; `mw`/`mh` are the size it shrinks to
 * when cropped, which the crop control also lets the reader choose. Neither is
 * shrunk to make the icon fit the screen: the placement maths keeps them in
 * sync so a crop that is fine now is still fine after the window changes.
 */

export type NotesGeometry = {
  /** False until the client has measured the viewport. The server never can. */
  placed: boolean;
  x: number;
  y: number;
  /** The working (open) size: what the reader writes in. */
  w: number;
  h: number;
  /** Half-cropped: the working pad, or just the book icon, or being cropped. */
  minimised: boolean;
  /** The size the cropped icon is. Chosen with the crop control. */
  mw: number;
  mh: number;
};

export type Viewport = { width: number; height: number };

export const NOTES_MARGIN = 12;
export const NOTES_MIN_WIDTH = 280;
export const NOTES_MIN_HEIGHT = 200;
export const NOTES_MAX_WIDTH = 520;
export const NOTES_MAX_HEIGHT = 640;
/** The smallest a cropped icon may be, and the one it starts at. */
export const NOTES_CROPPED_MIN = 40;

/** A size to clamp a position against: usually the pad's, sometimes its icon's. */
export type NotesSize = { w: number; h: number };

/**
 * Give a placement saved before crop sizes existed its crop size.
 *
 * Returns the *same object* when there is nothing to fill in. That is not a
 * micro-optimisation: the store hands this straight to `useSyncExternalStore`,
 * which compares snapshots with `Object.is`, so an object built on every read
 * is a change on every render — an infinite loop that shows up as a page that
 * will not render at all.
 */
export function normaliseNotesGeometry<T extends { mw?: number; mh?: number }>(stored: T): T & { mw: number; mh: number } {
  if (typeof stored.mw === "number" && typeof stored.mh === "number") return stored as T & { mw: number; mh: number };
  return { ...stored, mw: stored.mw ?? NOTES_CROPPED_MIN, mh: stored.mh ?? NOTES_CROPPED_MIN };
}

/** The server's answer, and the first client render's: not placed yet. */
export const UNPLACED_GEOMETRY: NotesGeometry = {
  placed: false,
  x: 0,
  y: 0,
  w: 360,
  h: 380,
  minimised: false,
  mw: NOTES_CROPPED_MIN,
  mh: NOTES_CROPPED_MIN,
};

/**
 * Fits the pad inside the window, and the window around the pad.
 *
 * `size` is the size the position is clamped against — the working pad while
 * open, the icon while cropped. A pad that was never told its crop size (an
 * older placement in storage) gets one here, rather than being refused.
 */
export function clampNotesGeometry(geometry: NotesGeometry, viewport: Viewport, size: NotesSize = geometry): NotesGeometry {
  const room = Math.max(0, viewport.width - NOTES_MARGIN * 2);
  const w = Math.round(Math.min(Math.max(geometry.w ?? 360, Math.min(NOTES_MIN_WIDTH, room)), Math.min(NOTES_MAX_WIDTH, room)));
  const h = Math.round(
    Math.min(
      Math.max(geometry.h ?? 380, Math.min(NOTES_MIN_HEIGHT, Math.max(0, viewport.height - NOTES_MARGIN * 2))),
      Math.min(NOTES_MAX_HEIGHT, Math.max(0, viewport.height - NOTES_MARGIN * 2)),
    ),
  );
  const mw = Math.round(Math.min(Math.max(geometry.mw ?? NOTES_CROPPED_MIN, NOTES_CROPPED_MIN), Math.max(NOTES_CROPPED_MIN, Math.min(w, room))));
  const mh = Math.round(Math.min(Math.max(geometry.mh ?? NOTES_CROPPED_MIN, NOTES_CROPPED_MIN), Math.max(NOTES_CROPPED_MIN, Math.min(h, Math.max(0, viewport.height - NOTES_MARGIN * 2)))));
  return {
    ...geometry,
    placed: true,
    w,
    h,
    mw,
    mh,
    x: Math.round(Math.min(Math.max(geometry.x ?? NOTES_MARGIN, NOTES_MARGIN), Math.max(NOTES_MARGIN, viewport.width - size.w - NOTES_MARGIN))),
    y: Math.round(Math.min(Math.max(geometry.y ?? NOTES_MARGIN, NOTES_MARGIN), Math.max(NOTES_MARGIN, viewport.height - size.h - NOTES_MARGIN))),
  };
}

/** Bottom right, out of the way of the page's own furniture. */
export function defaultNotesGeometry(viewport: Viewport): NotesGeometry {
  const narrow = viewport.width < 640;
  const w = narrow ? Math.min(NOTES_MAX_WIDTH, viewport.width - NOTES_MARGIN * 2) : 360;
  const h = narrow ? Math.min(Math.round(viewport.height * 0.4), 320) : 380;
  return clampNotesGeometry(
    {
      placed: true,
      w,
      h,
      // On a phone the pad would sit on top of the words being read, so it
      // starts cropped to its icon.
      minimised: narrow,
      mw: NOTES_CROPPED_MIN,
      mh: NOTES_CROPPED_MIN,
      x: viewport.width - w - NOTES_MARGIN,
      y: narrow ? viewport.height - h - 96 : viewport.height - h - 24,
    },
    viewport,
  );
}
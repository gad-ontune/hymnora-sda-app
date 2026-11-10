/**
 * Where the notepad is allowed to be.
 *
 * The pad is the reader's to place, and every failure mode here is a placement
 * that was fine when it was chosen and is not fine now: dragged to the far edge
 * of a desktop, left in a corner that a phone does not have, or restored on a
 * screen too small to hold it at all. The arithmetic is separated from the store
 * and from React precisely so these can be asserted — a pad that can end up
 * unreachable is the one bug in this feature that silently costs somebody their
 * notes.
 */

import { describe, it, test } from "node:test";
import assert from "node:assert/strict";
import {
  clampNotesGeometry,
  defaultNotesGeometry,
  normaliseNotesGeometry,
  NOTES_CROPPED_MIN,
  NOTES_MARGIN,
  NOTES_MAX_HEIGHT,
  NOTES_MAX_WIDTH,
  NOTES_MIN_HEIGHT,
  NOTES_MIN_WIDTH,
  UNPLACED_GEOMETRY,
  type NotesGeometry,
} from "../src/lib/notes-geometry.ts";

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

const placed = (patch: Partial<NotesGeometry> = {}): NotesGeometry =>
  clampNotesGeometry(
    { placed: true, x: 100, y: 100, w: 360, h: 380, minimised: false, mw: NOTES_CROPPED_MIN, mh: NOTES_CROPPED_MIN, ...patch },
    DESKTOP,
  );

describe("a placement the reader chose is kept", () => {
  it("leaves a placement that already fits alone", () => {
    const chosen = placed({ x: 700, y: 120, w: 400, h: 300 });
    assert.deepEqual(chosen, {
      placed: true,
      x: 700,
      y: 120,
      w: 400,
      h: 300,
      minimised: false,
      mw: NOTES_CROPPED_MIN,
      mh: NOTES_CROPPED_MIN,
    });
  });

  it("keeps the cropped state, which is a choice like any other", () => {
    assert.equal(placed({ minimised: true }).minimised, true);
  });

  it("rounds to whole pixels, so a drag does not leave a half pixel of drift", () => {
    const dragged = placed({ x: 700.4, y: 120.6, w: 400.5, h: 300.5 });
    assert.deepEqual([dragged.x, dragged.y, dragged.w, dragged.h], [700, 121, 401, 301]);
  });
});

describe("a placement made on another screen is still reachable", () => {
  it("pulls back a pad parked off the right and bottom of a smaller window", () => {
    const onPhone = clampNotesGeometry(placed({ x: 1100, y: 600 }), PHONE);
    assert.ok(onPhone.x + onPhone.w <= PHONE.width - NOTES_MARGIN, "pad is off the right of the phone");
    assert.ok(onPhone.y + onPhone.h <= PHONE.height - NOTES_MARGIN, "pad is off the bottom of the phone");
  });

  it("pulls back a pad dragged past the top and left edges", () => {
    const pulled = clampNotesGeometry(placed({ x: -900, y: -400 }), DESKTOP);
    assert.equal(pulled.x, NOTES_MARGIN);
    assert.equal(pulled.y, NOTES_MARGIN);
  });

  it("shrinks a pad that is bigger than the screen it is being opened on", () => {
    const shrunk = clampNotesGeometry(placed({ w: 520, h: 640 }), PHONE);
    assert.ok(shrunk.w <= PHONE.width - NOTES_MARGIN * 2);
    assert.ok(shrunk.h <= PHONE.height - NOTES_MARGIN * 2);
  });

  it("never returns a size below the minimum on a screen that has room", () => {
    const small = clampNotesGeometry(placed({ w: 40, h: 40 }), DESKTOP);
    assert.equal(small.w, NOTES_MIN_WIDTH);
    assert.equal(small.h, NOTES_MIN_HEIGHT);
  });

  it("stays inside a window too small for the minimum, rather than overflowing it", () => {
    // A very short window: the height minimum cannot be honoured, and a pad
    // taller than the screen is a pad whose Save button is off the bottom.
    const tiny = { width: 320, height: 180 };
    const squeezed = clampNotesGeometry(placed(), tiny);
    assert.ok(squeezed.h <= tiny.height - NOTES_MARGIN * 2, "pad is taller than the window");
    assert.ok(squeezed.w <= tiny.width - NOTES_MARGIN * 2, "pad is wider than the window");
  });

  it("caps growth, so a drag cannot make the pad bigger than it is useful", () => {
    const huge = clampNotesGeometry(placed({ w: 4000, h: 4000 }), { width: 8000, height: 6000 });
    assert.equal(huge.w, NOTES_MAX_WIDTH);
    assert.equal(huge.h, NOTES_MAX_HEIGHT);
  });
});

describe("the first time, the pad gets out of the way", () => {
  it("sits in the bottom right of a desktop, open, with a margin from the edge", () => {
    const geometry = defaultNotesGeometry(DESKTOP);
    assert.equal(geometry.minimised, false);
    assert.ok(geometry.x + geometry.w <= DESKTOP.width - NOTES_MARGIN);
    assert.ok(geometry.y + geometry.h <= DESKTOP.height - NOTES_MARGIN);
    assert.ok(geometry.x > 0 && geometry.y > 0);
  });

  it("starts cropped on a phone, because an open pad would cover the reading", () => {
    const geometry = defaultNotesGeometry(PHONE);
    assert.equal(geometry.minimised, true);
    assert.ok(geometry.w <= PHONE.width - NOTES_MARGIN * 2);
  });

  it("clears the bottom bar on a phone, where a pad would sit under the navigation", () => {
    const geometry = defaultNotesGeometry(PHONE);
    assert.ok(geometry.y + geometry.h < PHONE.height - 80, "pad is sitting on the bottom bar");
  });

  it("is marked unplaced before a viewport is known, so the server claims nothing", () => {
    assert.equal(UNPLACED_GEOMETRY.placed, false);
  });
});

test("the cropped icon stays on screen where the pad was left", () => {
  // The stored size is the expanded one, and the position is clamped against
  // *that*, so the far corner is the worst case for a 40px square.
  const placed = clampNotesGeometry({ ...UNPLACED_GEOMETRY, placed: true, w: 520, h: 640, minimised: true }, {
    width: 1280,
    height: 900,
  }, { w: NOTES_CROPPED_MIN, h: NOTES_CROPPED_MIN });
  const right = placed.x + NOTES_CROPPED_MIN;
  const bottom = placed.y + NOTES_CROPPED_MIN;
  assert.ok(right <= 1280 - NOTES_MARGIN, `${right} should clear the right edge`);
  assert.ok(bottom <= 900 - NOTES_MARGIN, `${bottom} should clear the bottom edge`);
  assert.ok(NOTES_CROPPED_MIN < NOTES_MIN_WIDTH, "the icon is narrower than the pad it came from");
});

describe("cropped icons move the whole way down the screen", () => {
  // Built raw, not via `placed()`: that helper clamps to the desktop with the
  // *expanded* size first, which would flatten a deep position before this clamp
  // gets a chance to hold the icon's own forty pixels.
  const iconSize = { w: NOTES_CROPPED_MIN, h: NOTES_CROPPED_MIN };
  const raw = (patch: Partial<NotesGeometry>): NotesGeometry => ({
    placed: true,
    x: 100,
    y: 100,
    w: 360,
    h: 380,
    minimised: true,
    mw: NOTES_CROPPED_MIN,
    mh: NOTES_CROPPED_MIN,
    ...patch,
  });

  it("clamps the cropped icon against its own forty pixels, not the pad it came from", () => {
    // The icon is forty pixels tall; the clamp for the open pad is its 380 and
    // would stop this drag three hundred pixels above the bottom bar.
    const icon = clampNotesGeometry(raw({ y: 6000 }), { width: 390, height: 844 }, iconSize);
    assert.equal(icon.y, 844 - NOTES_MARGIN - icon.mh, "the icon should sit at the very bottom");
  });

  it("clamps the icon against its own forty pixels on the right too", () => {
    const icon = clampNotesGeometry(raw({ x: 4000 }), { width: 1280, height: 900 }, iconSize);
    assert.equal(icon.x, 1280 - NOTES_MARGIN - icon.mw);
  });

  it("brings an icon parked at the bottom back fully on screen with the whole pad", () => {
    // The icon was left at the bottom edge; opening it must pop it up to where
    // the full working pad, all 380px of it, fits.
    const open = clampNotesGeometry(
      placed({ minimised: false, w: 360, h: 380, y: 844 - NOTES_MARGIN - NOTES_CROPPED_MIN }),
      { width: 390, height: 844 },
    );
    assert.equal(open.y + open.h, 844 - NOTES_MARGIN, "the opened pad should sit on the bottom margin");
  });
});

test("the crop control sizes the icon between the smallest useful book and the pad itself", () => {
  const crop = clampNotesGeometry(placed({ w: 360, h: 380, mw: 420, mh: 500, minimised: true }), { width: 1280, height: 900 });
  assert.equal(crop.mw, 360, "a crop wider than the pad is not possible");
  assert.equal(crop.mh, 380);
  const tiny = clampNotesGeometry(placed({ mw: 4, mh: 9, minimised: true }), DESKTOP);
  assert.equal(tiny.mw, NOTES_CROPPED_MIN);
  assert.equal(tiny.mh, NOTES_CROPPED_MIN);
});

test("a placement saved before crop sizes existed is still a placement", () => {
  const legacy = btoa_or_object({ placed: true, x: 40, y: 60, w: 360, h: 380, minimised: true });
  const clamped = clampNotesGeometry(legacy as unknown as NotesGeometry, DESKTOP);
  assert.equal(clamped.mw, NOTES_CROPPED_MIN, "the icon is given its smallest size rather than a hole");
  assert.equal(clamped.mh, NOTES_CROPPED_MIN);
});

function btoa_or_object<T>(value: T): T {
  return value;
}

test("normalising a stored placement is stable, so the store does not render forever", () => {
  // The bug this guards: the store hands the placement to `useSyncExternalStore`,
  // which compares with `Object.is`. A normaliser that returned a fresh object
  // every read was an infinite render loop — a page that would not render at all.
  const alreadyNormal = { ...UNPLACED_GEOMETRY, placed: true, x: 10, y: 10 };
  assert.equal(normaliseNotesGeometry(alreadyNormal), alreadyNormal, "an up-to-date placement is returned as-is");

  const legacy = { placed: true, x: 10, y: 10, w: 360, h: 380, minimised: true } as unknown as Parameters<typeof normaliseNotesGeometry>[0];
  const once = normaliseNotesGeometry(legacy);
  assert.equal(once.mw, NOTES_CROPPED_MIN);
  assert.equal(once.mh, NOTES_CROPPED_MIN);
  assert.equal(normaliseNotesGeometry(once), once, "a normalised placement is now stable too");
});

"use client";

import { Check, Crop, GripHorizontal, NotebookPen, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { NOTES_CROPPED_MIN } from "@/lib/notes-geometry";
import { createPortal } from "react-dom";
import {
  clearNoteDraft,
  createNote,
  deleteNote,
  getNotes,
  hasNoteAccount,
  readNoteDraft,
  resetNotesGeometry,
  setNotesGeometry,
  updateNote,
  useNoteDraft,
  useNotesGeometry,
  writeNoteDraft,
  type Note,
  type NoteItemType,
} from "@/lib/notes";

/**
 * The notepad.
 *
 * A reader taking notes is doing two things at once — reading something and
 * writing about it — and a pad that lives in a sidebar asks them to give up one
 * of the two. So this one floats over the page, and it belongs to the reader:
 * they drag it to wherever their hand already is, crop it to its title bar when
 * the words are not what they are reading, stretch it if they want more room,
 * and it is exactly there next time. The placement is remembered per surface,
 * because a sermon and a Bible chapter want it in different places and neither
 * wants to have to move it again.
 *
 * The other half of "floating" is that it must not be a picture of a pad. The
 * text lands on the device on every keystroke, so nothing is lost to a reload, a
 * closed tab, or a reader who never signs in; it goes to the server when there
 * is a session to save it to, stamped with the player's position in a sermon or
 * the chapter in Scripture. The notes already saved for whatever is on screen
 * are listed underneath, so the pad is also the way back to them.
 */

const DRAFT_DEBOUNCE_MS = 350;
/** A pointer that travels this far is a drag, not a click on the icon. */
const DRAG_SLOP_PX = 4;

type Props = {
  /** Where the placement is remembered: `"sermons"`, `"bible"`. */
  surface: string;
  itemType: NoteItemType;
  itemId: string;
  /** What the pad is taking notes about, shown in the title bar. */
  subject: string;
  /** "John 3" or "12:14" — the place inside the subject. */
  reference?: string | null;
  label?: string;
  /** A sermon can be stamped with the player's position. */
  timestampSeconds?: number | null;
};

type Status = "idle" | "dirty" | "saving" | "saved" | "local" | "error";

type Draft = { body: string; reference: string | null; timestampSeconds: number | null; savedAt: number };

type Drag =
  | { kind: "move"; pointerId: number; offsetX: number; offsetY: number; startX: number; startY: number }
  | { kind: "pad-resize"; pointerId: number; originW: number; originH: number }
  | { kind: "crop-resize"; pointerId: number; originW: number; originH: number }
  | null;

/** `12:14`, or nothing if there is no position worth stamping. */
function clockOf(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return null;
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function ago(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  return new Date(then).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** The saved note this pad should reopen with: the most recently touched one. */
function newestNote(notes: Note[]): Note | null {
  return [...notes].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0] ?? null;
}

export function FloatingNotes({
  surface,
  itemType,
  itemId,
  subject,
  reference = null,
  label = "Notes",
  timestampSeconds = null,
}: Props) {
  const geometry = useNotesGeometry(surface);
  const draft = useNoteDraft(itemType, itemId);
  const [body, setBody] = useState("");
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [editing, setEditing] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  /** Crop mode: the ✂ control is out, and the reader sizes the icon-to-be. */
  const [cropping, setCropping] = useState(false);
  const [cropBox, setCropBox] = useState({ w: NOTES_CROPPED_MIN, h: NOTES_CROPPED_MIN });
  const drag = useRef<Drag>(null);
  /**
   * Set once a pointer has travelled far enough to count as a drag, and read by
   * the cropped icon's click handler — a `click` still arrives after the drag it
   * ended, and without this the pad would spring open the moment it was dropped.
   */
  const dragged = useRef(false);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);

  const signedIn = hasNoteAccount();
  const clock = clockOf(timestampSeconds);

  const cropped = geometry.minimised;
  /**
   * What is on screen right now is what the placement is clamped against — a
   * 380px pad teaches a 40px icon different lessons about the edge of the
   * screen. Numbers, so the pointer handlers re-bind only when they change.
   */
  const shownW = cropping ? cropBox.w : cropped ? geometry.mw : geometry.w;
  const shownH = cropping ? cropBox.h : cropped ? geometry.mh : geometry.h;

  // ── The text, and the device copy behind it ────────────────────────────────
  const commit = useCallback(
    (value: string) => {
      setBody(value);
      setStatus(value.trim() ? (hasNoteAccount() ? "dirty" : "local") : "idle");
      if (draftTimer.current) clearTimeout(draftTimer.current);
      const stored = readNoteDraft(itemType, itemId);
      const next: Draft = { ...stored, body: value, savedAt: Date.now() };
      draftTimer.current = setTimeout(() => writeNoteDraft(itemType, itemId, next), DRAFT_DEBOUNCE_MS);
    },
    [itemId, itemType],
  );

  /**
   * Whatever is on screen decides what the pad is about, so switching chapter or
   * sermon swaps the pad to that one's note and leaves the other alone. Without
   * this the pad would keep writing into whatever the reader opened first, which
   * is how a note ends up filed against the wrong passage.
   */
  // ── The notes already saved for this ───────────────────────────────────────
  /**
   * Loading does two things at once, and both of them are state changes that
   * belong to an answer arriving rather than to a render: the notes for whatever
   * is now on screen, and the pad's opening text — this thing's draft if there
   * is one, otherwise the last note saved for it, because a pad that greets a
   * returning reader with a blank box while their own note sits in the list below
   * reads as an empty account.
   */
  const loadNotes = useCallback(async () => {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    const stored = readNoteDraft(itemType, itemId);
    setBody(stored.body);
    setEditing(null);
    setStatus(stored.body.trim() ? "dirty" : "idle");
    setMessage(null);

    if (!hasNoteAccount()) {
      setNotes(null);
      return;
    }
    try {
      const found = await getNotes(itemType, itemId);
      setNotes(found);
      if (!stored.body.trim()) {
        const open = newestNote(found);
        if (open) {
          setBody(open.body);
          setEditing(open.id);
        }
      }
    } catch {
      setNotes([]);
    }
  }, [itemId, itemType]);

  useEffect(() => {
    // Deferred by a tick: the answers that come back belong to the state, not to
    // the render that asked for them.
    const handle = window.setTimeout(() => void loadNotes(), 0);
    return () => window.clearTimeout(handle);
  }, [loadNotes]);

  // ── Saving ─────────────────────────────────────────────────────────────────
  const save = useCallback(async () => {
    const text = body.trim();
    if (!text) return;
    const stored = readNoteDraft(itemType, itemId);
    if (!hasNoteAccount()) {
      setStatus("local");
      setMessage("Kept on this device. Sign in to keep it with your account.");
      writeNoteDraft(itemType, itemId, {
        body: text,
        reference: reference ?? stored.reference,
        timestampSeconds: timestampSeconds ?? stored.timestampSeconds,
        savedAt: Date.now(),
      });
      return;
    }
    setStatus("saving");
    try {
      if (editing) {
        const updated = await updateNote(editing, {
          body: text,
          reference: reference ?? null,
          timestampSeconds: timestampSeconds ?? null,
        });
        setNotes((current) => (current ?? []).map((note) => (note.id === updated.id ? updated : note)));
      } else {
        const created = await createNote({ itemType, itemId, body: text, reference, timestampSeconds });
        setNotes((current) => [created, ...(current ?? [])]);
        setEditing(created.id);
      }
      clearNoteDraft(itemType, itemId);
      setStatus("saved");
      setMessage(null);
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Could not save that note");
    }
  }, [body, editing, itemId, itemType, reference, timestampSeconds]);

  const remove = useCallback(
    async (id: string) => {
      try {
        await deleteNote(id);
        setNotes((current) => (current ?? []).filter((note) => note.id !== id));
        if (editing === id) {
          setEditing(null);
          setBody("");
          setStatus("idle");
        }
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not delete that note");
      }
    },
    [editing],
  );

  const reopen = useCallback((note: Note) => {
    setEditing(note.id);
    setBody(note.body);
    setStatus("dirty");
    textarea.current?.focus();
  }, []);

  const startFresh = useCallback(() => {
    setEditing(null);
    setBody("");
    setStatus("idle");
    setMessage(null);
    textarea.current?.focus();
  }, []);

  // ── Dragging, cropping, stretching ─────────────────────────────────────────
  const move = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const active = drag.current;
      if (!active || active.kind !== "move" || active.pointerId !== event.pointerId) return;
      if (Math.hypot(event.clientX - active.startX, event.clientY - active.startY) > DRAG_SLOP_PX) dragged.current = true;
      setNotesGeometry(
        surface,
        { x: event.clientX - active.offsetX, y: event.clientY - active.offsetY },
        false,
        { w: shownW, h: shownH },
      );
    },
    [shownH, shownW, surface],
  );

  const stretch = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const active = drag.current;
      if (!active || (active.kind !== "pad-resize" && active.kind !== "crop-resize") || active.pointerId !== event.pointerId) return;
      // The grip is in the corner, so the pad's own box is the origin.
      const box = event.currentTarget.closest("section")?.getBoundingClientRect();
      if (!box) return;
      const w = active.originW + (event.clientX - box.left);
      const h = active.originH + (event.clientY - box.top);
      if (active.kind === "crop-resize") {
        // Sizing the icon-to-be: between the smallest useful book and the pad itself.
        setCropBox({
          w: Math.round(Math.max(NOTES_CROPPED_MIN, Math.min(geometry.w, w))),
          h: Math.round(Math.max(NOTES_CROPPED_MIN, Math.min(geometry.h, h))),
        });
        return;
      }
      setNotesGeometry(surface, { w, h }, false);
    },
    [geometry.h, geometry.w, surface],
  );

  const stop = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (!drag.current || drag.current.pointerId !== event.pointerId) return;
      drag.current = null;
      // Written once, on release: a hundred `localStorage` writes a second for a
      // movement the eye cannot see is a cost with nothing bought. Clamped
      // against the visible size, so an icon dropped at the bottom of the
      // screen stays at the bottom of the screen.
      setNotesGeometry(surface, {}, true, { w: shownW, h: shownH });
    },
    [shownH, shownW, surface],
  );

  const beginMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      dragged.current = false;
      drag.current = {
        kind: "move",
        pointerId: event.pointerId,
        offsetX: event.clientX - geometry.x,
        offsetY: event.clientY - geometry.y,
        startX: event.clientX,
        startY: event.clientY,
      };
    },
    [geometry.x, geometry.y],
  );

  const startCrop = useCallback(() => {
    setCropBox({ w: geometry.mw, h: geometry.mh });
    setCropping(true);
  }, [geometry.mh, geometry.mw]);

  const commitCrop = useCallback(() => {
    setNotesGeometry(surface, { minimised: true, mw: cropBox.w, mh: cropBox.h });
    setCropping(false);
  }, [cropBox.h, cropBox.w, surface]);

  const beginCropResize = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { kind: "crop-resize", pointerId: event.pointerId, originW: cropBox.w, originH: cropBox.h };
    },
    [cropBox.h, cropBox.w],
  );

  /**
   * Open the pad from its icon. Wired to both `click` and `doubleClick` so a
   * double-tap opens it on the first tap and lands harmlessly on the second,
   * and a drag is ignored rather than read as a tap.
   */
  const openFromIcon = useCallback(() => {
    if (dragged.current) {
      dragged.current = false;
      return;
    }
    setNotesGeometry(surface, { minimised: false });
  }, [surface]);

  const beginResize = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { kind: "pad-resize", pointerId: event.pointerId, originW: geometry.w, originH: geometry.h };
    },
    [geometry.h, geometry.w],
  );

  // A pad placed against the edge of a desktop must still be reachable on a phone.
  useEffect(() => {
    const onResize = () => setNotesGeometry(surface, {}, false);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [surface]);

  if (typeof document === "undefined" || !geometry.placed) return null;

  const hasSomething = body.trim().length > 0 || (notes?.length ?? 0) > 0;
  const style: React.CSSProperties = {
    left: geometry.x,
    top: geometry.y,
    width: cropping ? cropBox.w : cropped ? geometry.mw : geometry.w,
    height: cropping ? cropBox.h : cropped ? geometry.mh : geometry.h,
  };

  return createPortal(
    // ── Choosing the cropped size ────────────────────────────────────────────
    cropping ? (
      <section
        aria-label="Crop your notes to a size you choose"
        className="fixed z-[45] flex flex-col overflow-hidden rounded-xl border-2 border-dashed border-gold bg-paper shadow-lift"
        style={style}
      >
        <header
          onPointerDown={beginMove}
          onPointerMove={move}
          onPointerUp={stop}
          onPointerCancel={stop}
          title="Drag to move"
          className="flex shrink-0 touch-none items-center gap-2 border-b border-gold/40 bg-paper-deep px-2 py-1.5 select-none"
        >
          <GripHorizontal size={14} className="shrink-0 cursor-grab text-gold" aria-hidden />
          <span className="grid size-6 shrink-0 place-items-center rounded-md bg-gold text-surface">
            <Crop size={13} />
          </span>
          <span className="min-w-0 flex-1 truncate text-[11.5px] font-bold text-ink">Crop to the size you want</span>
          <button
            type="button"
            onClick={commitCrop}
            className="grid size-7 shrink-0 place-items-center rounded-md bg-gold text-surface transition hover:brightness-105"
            aria-label="Crop to this size"
            title="Crop the pad down to this size"
          >
            <Check size={14} />
          </button>
          <button
            type="button"
            onClick={() => setCropping(false)}
            className="grid size-7 shrink-0 place-items-center rounded-md border border-gold/40 text-ink-muted transition hover:text-ink"
            aria-label="Cancel cropping"
            title="Cancel"
          >
            <X size={14} />
          </button>
        </header>
        <div className="flex min-h-0 flex-1 place-items-center justify-center gap-2 p-3 text-center">
          <NotebookPen size={15} className="shrink-0 text-gold" aria-hidden />
          <span className="text-[10.5px] leading-4 text-ink-soft">Drag the corner to choose its size — then ✓.</span>
        </div>
        <span
          onPointerDown={beginCropResize}
          onPointerMove={stretch}
          onPointerUp={stop}
          onPointerCancel={stop}
          className="absolute -bottom-px -right-px size-8 cursor-nwse-resize touch-none"
          aria-hidden
        >
          <span className="absolute bottom-1 right-1 size-2 rounded-full bg-gold ring-2 ring-paper" />
        </span>
      </section>
    ) : cropped ? (
      // ── The cropped icon ────────────────────────────────────────────────────
      /**
       * The book, and only the book. It is solid gold because it is not a
       * button on the page — it is the pad's own door, folded up to the size of
       * a thumbnail for the parts of the page a reader is actually reading. A
       * dot in the corner says there is something in it (unsaved text, or a
       * saved note for what is on screen).
       *
       * It is also the handle, because a square that can only be dragged by its
       * own icon is a square nobody can move. Click or double-click opens it —
       * the first click of a pair has already done the work — and a drag is not
       * a click, which is what keeps a dropped pad from springing open.
       */
      <button
        type="button"
        style={style}
        onPointerDown={beginMove}
        onPointerMove={move}
        onPointerUp={stop}
        onPointerCancel={stop}
        onClick={openFromIcon}
        onDoubleClick={openFromIcon}
        className="fixed z-[45] cursor-grab touch-none overflow-hidden rounded-[14px] bg-gold text-surface shadow-lift transition hover:brightness-105 active:cursor-grabbing"
        aria-label={`Open your notes on ${subject}`}
        title={`${label} · ${subject}\nClick or double-click to open · drag to move`}
      >
        <span className="grid size-full place-items-center">
          <NotebookPen size={20} aria-hidden />
        </span>
        {hasSomething ? (
          <span className="absolute right-1 top-1 size-1.5 rounded-full bg-terracotta ring-2 ring-gold" aria-hidden />
        ) : null}
      </button>
    ) : (
      // ── The working pad ─────────────────────────────────────────────────────
      <section
        aria-label={`${label} on ${subject}`}
        className="fixed z-[45] flex flex-col overflow-hidden rounded-2xl border border-gold/50 bg-paper shadow-lift"
        style={style}
      >
        {/* The title bar is the handle, and only the title bar. Everything below
            stays selectable: a pad you cannot select text in is worse than no pad. */}
        <header
          onPointerDown={beginMove}
          onPointerMove={move}
          onPointerUp={stop}
          onPointerCancel={stop}
          onDoubleClick={() => setNotesGeometry(surface, { minimised: true })}
          title="Drag to move · double-click to shrink to the book · ✂ to choose its size"
          className="flex shrink-0 touch-none items-center gap-2 border-b border-gold/30 bg-paper-deep px-2.5 py-2 select-none"
        >
          <GripHorizontal size={15} className="shrink-0 cursor-grab text-gold/70" aria-hidden />
          <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-gold text-surface">
            <NotebookPen size={14} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px] font-bold leading-tight text-ink">{label}</span>
            <span className="block truncate text-[10.5px] leading-tight text-ink-muted">{subject}</span>
          </span>
          {status === "saving" ? <span className="shrink-0 text-[10px] text-ink-muted">Saving…</span> : null}
          {status === "saved" ? <Check size={14} className="shrink-0 text-sage" aria-label="Saved" /> : null}
          <button
            type="button"
            onClick={startCrop}
            className="grid size-7 shrink-0 place-items-center rounded-lg text-gold transition hover:bg-gold/15"
            aria-label="Crop the pad to a size you choose"
            title="Crop: choose the size of the book icon"
          >
            <Crop size={14} />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-2 p-2.5">
          <textarea
            ref={textarea}
            value={body}
            onChange={(event) => commit(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                void save();
              }
            }}
            placeholder={clock ? `What was said around ${clock}?` : "Write while you read…"}
            aria-label={`Note on ${subject}`}
            className="min-h-0 w-full flex-1 resize-none rounded-xl border border-gold/35 bg-canvas/60 p-3 text-[13.5px] leading-6 text-ink outline-none placeholder:text-ink-muted/70 focus:border-gold/70 focus:ring-4 focus:ring-gold/10"
          />

          {message ? (
            <p className="rounded-lg bg-terracotta-soft px-2.5 py-1.5 text-[11px] leading-4 text-terracotta">{message}</p>
          ) : null}

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={!body.trim() || status === "saving"}
              className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl bg-gold text-[12.5px] font-bold text-surface transition hover:brightness-105 disabled:opacity-40"
            >
              <Check size={14} /> {editing ? "Update note" : "Save note"}
            </button>
            <button
              type="button"
              onClick={startFresh}
              className="grid size-9 shrink-0 place-items-center rounded-xl border border-gold/35 text-ink-muted transition hover:text-ink"
              aria-label="Start a new note"
              title="Start a new note"
            >
              <Plus size={15} />
            </button>
            <button
              type="button"
              onClick={() => resetNotesGeometry(surface)}
              className="grid size-9 shrink-0 place-items-center rounded-xl border border-gold/35 text-ink-muted transition hover:text-ink"
              aria-label="Put the pad back in the corner"
              title="Put it back in the corner"
            >
              <RotateCcw size={15} />
            </button>
          </div>

          <p className="shrink-0 text-[10.5px] leading-4 text-ink-muted">
            {signedIn
              ? "Kept in your account. ⌘/Ctrl + Enter saves."
              : "Signed out, so it is kept on this device."}
            {draft.savedAt > 0 && status !== "saved" ? " Unsaved words were recovered." : ""}
          </p>
        </div>

        {notes && notes.length > 0 ? (
          <div className="max-h-[36%] shrink-0 overflow-y-auto border-t border-gold/25">
            <p className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.16em] text-ink-muted">
              Saved here ({notes.length})
            </p>
            <ul>
              {notes.map((note) => (
                <li key={note.id} className="group flex gap-2 px-3 py-2 hover:bg-gold-soft/50">
                  <button type="button" onClick={() => reopen(note)} className="min-w-0 flex-1 text-left">
                    <span className="line-clamp-2 block text-[12px] leading-5 text-ink-soft">{note.body}</span>
                    <span className="mt-0.5 block text-[10px] text-ink-muted">
                      {[note.reference, clockOf(note.timestampSeconds), ago(note.updatedAt)].filter(Boolean).join(" · ")}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(note.id)}
                    className="grid size-7 shrink-0 place-items-center self-start rounded-lg text-ink-muted/60 opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100 hover:bg-terracotta-soft hover:text-terracotta"
                    aria-label="Delete this note"
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <span
          onPointerDown={beginResize}
          onPointerMove={stretch}
          onPointerUp={stop}
          onPointerCancel={stop}
          className="absolute -bottom-px -right-px size-5 cursor-nwse-resize touch-none"
          aria-hidden
        >
          <span className="absolute bottom-1 right-1 size-1.5 rounded-full bg-gold/60" />
        </span>
      </section>
    ),
    document.body,
  );
}

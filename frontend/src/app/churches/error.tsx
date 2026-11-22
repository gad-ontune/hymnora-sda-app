"use client";

import Link from "next/link";
import { MapPin, RotateCcw } from "lucide-react";

/**
 * A route-level boundary, so a failure on /churches stays on /churches: the
 * player, navigation and the rest of the app keep working. Deliberately
 * self-contained — a fallback that imports app providers can fail for the same
 * reason the page did.
 */
export default function ChurchesError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto grid min-h-[60vh] max-w-xl place-items-center p-6">
      <div className="w-full rounded-[26px] border border-line bg-surface p-8 text-center shadow-soft sm:p-12">
        <span className="mx-auto grid size-16 place-items-center rounded-2xl bg-sage-soft text-sage">
          <MapPin size={26} />
        </span>
        <p className="mt-5 text-[10px] font-bold uppercase tracking-[0.18em] text-gold">Church directory</p>
        <h1 className="mt-2 font-display text-[30px] font-semibold leading-tight text-ink">
          We lost our bearings for a moment.
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-ink-muted">
          The directory could not be drawn just now. Nothing else has changed — try again, or head back home and come
          back later.
        </p>
        {error.digest ? <p className="mt-3 text-[11px] tabular-nums text-ink-muted/70">reference {error.digest}</p> : null}
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-ink-fill px-5 text-sm font-bold text-white transition hover:bg-sage"
          >
            <RotateCcw size={15} /> Try again
          </button>
          <Link
            href="/"
            className="inline-flex h-11 items-center gap-2 rounded-xl border border-line bg-canvas px-5 text-sm font-semibold text-ink transition hover:border-gold/50"
          >
            Go home
          </Link>
        </div>
      </div>
    </main>
  );
}

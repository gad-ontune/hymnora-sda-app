"use client";

import Link from "next/link";
import { RotateCcw, TriangleAlert } from "lucide-react";

/**
 * The nearest error boundary. Without this file Next swallows a navigation that
 * fails mid-render and falls back to a legacy `pages/500.html`, which this App
 * Router app does not ship — leaving "can't load the page" with nothing behind
 * it but a missing static file. A real boundary means a failed transition shows
 * a usable card and a way back, and the layout (player, nav) stays alive.
 *
 * Deliberately hardcoded English and self-contained: if the failure came from
 * the app's own providers, depending on them in the fallback can fail again.
 */
export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto grid min-h-[60vh] max-w-xl place-items-center p-6">
      <div className="w-full rounded-[26px] border border-line bg-surface p-8 text-center shadow-soft sm:p-12">
        <span className="mx-auto grid size-16 place-items-center rounded-2xl bg-terracotta-soft text-terracotta">
          <TriangleAlert size={26} />
        </span>
        <h1 className="mt-5 font-display text-[30px] font-semibold text-ink">This page could not be loaded.</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-ink-muted">
          Something interrupted it at the last moment. Your music and the rest of the app are untouched — try once more.
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
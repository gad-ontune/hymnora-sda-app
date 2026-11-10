"use client";

import { useEffect, useState } from "react";
import { ENCOURAGEMENTS, ROTATE_MS } from "@/lib/hymn-encouragements";

/**
 * The card at the top of the hymns page. The words and the colour both come
 * from `lib/hymn-encouragements`, which rotates every few minutes, so the page
 * never sits on one static message.
 */
export function RotatingQuote() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setIndex((current) => (current + 1) % ENCOURAGEMENTS.length), ROTATE_MS);
    return () => clearTimeout(timer);
  }, [index]);

  const message = ENCOURAGEMENTS[index];
  const { card, eyebrow, body, deco: decoColour } = message.tone;

  return (
    <div className={`relative min-h-[212px] overflow-hidden rounded-[26px] p-6 text-white shadow-soft transition-colors duration-700 sm:p-7 ${card}`}>
      <div className={`absolute -bottom-24 -right-16 size-72 rounded-full border transition-colors duration-700 ${decoColour}`} />
      <div className={`absolute -bottom-12 -right-4 size-48 rounded-full border transition-colors duration-700 ${decoColour}`} />
      <div className="relative flex h-full flex-col">
        <p className={`text-[10px] font-bold uppercase tracking-[0.2em] transition-colors duration-700 ${eyebrow}`}>
          {message.eyebrow}
        </p>
        <h2 className="mt-7 max-w-sm font-display text-[27px] font-semibold leading-[1.15] tracking-[-0.03em] sm:text-[30px]">
          {message.title}
        </h2>
        <p className={`mt-2.5 max-w-sm text-[13px] leading-6 transition-colors duration-700 ${body}`}>{message.body}</p>
      </div>
    </div>
  );
}

"use client";

import { Heart } from "lucide-react";
import { useHymnora } from "./hymnora-provider";

export function FavoriteButton({ id, className = "" }: { id: string; className?: string }) {
  const { isFavorite, toggleFavorite } = useHymnora();
  const favorite = isFavorite(id);

  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleFavorite(id);
      }}
      className={`grid place-items-center rounded-full transition ${favorite ? "bg-terracotta-soft text-terracotta" : "bg-ink-fill/55 text-white hover:bg-ink-fill/80"} ${className}`}
      aria-label={favorite ? "Remove from favorites" : "Save to favorites"}
    >
      <Heart size={16} fill={favorite ? "currentColor" : "none"} />
    </button>
  );
}

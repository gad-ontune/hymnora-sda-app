/**
 * Image fallback helper.
 *
 * Media art arrives from the API and older seed rows can carry an empty
 * `image` string. `next/image` throws on an empty `src`, which blanks out the
 * whole card, so every render funnels through here and lands on a bundled
 * placeholder when the API has no artwork.
 */
export function imgSrc(value: string | null | undefined, fallback: string): string {
  return value && value.trim().length > 0 ? value : fallback;
}

export const FALLBACK_IMAGE = "/images/music-studio.jpg";

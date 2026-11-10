import { getHymnEditions, getHymnThemes } from "@/lib/api";
import { HymnExperience } from "@/components/hymn-experience";
import type { HymnEdition, HymnTheme } from "@/lib/types";

export const metadata = {
  title: "Hymns",
  description: "Explore authorized SDA hymn collections in a calm digital reader.",
};

export default async function HymnsPage() {
  // Fetched on the server so the language picker is populated on first paint.
  // A failure here must not break the build, so the page falls back to the
  // client-side fetch inside the component.
  let editions: HymnEdition[] = [];
  let themes: HymnTheme[] = [];
  try {
    editions = await getHymnEditions();
  } catch {
    editions = [];
  }
  // Fetched here too, not just in the browser: client-fetching left the
  // Browse by theme cards out of the server-rendered HTML, so they only
  // appeared after hydration and vanished entirely if it failed.
  try {
    themes = await getHymnThemes();
  } catch {
    themes = [];
  }
  return <HymnExperience initialEditions={editions} initialThemes={themes} />;
}

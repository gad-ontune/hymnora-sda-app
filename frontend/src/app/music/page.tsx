import { getMusicHomeData } from "@/lib/data";
import { MusicExperience } from "@/components/music-experience";

export const metadata = {
  title: "Music",
  description: "Listen to SDA worship music, hymns, choirs and instrumentals.",
};

/**
 * Time of day, resolved on the server.
 *
 * It has to be here rather than in the client component: a client-side clock
 * would be a different hour than the one that rendered the HTML, and React
 * would rightly complain that the two disagree. The page revalidates every
 * minute, so the greeting cannot go stale for long.
 */
function greeting(now = new Date()): string {
  const hour = now.getHours();
  if (hour < 5) return "Good evening";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default async function MusicPage() {
  // Fetched here rather than in an effect, so the rows are in the first paint
  // and the client has nothing to fetch before the page is usable.
  const home = await getMusicHomeData();
  return <MusicExperience home={home} greeting={greeting()} />;
}

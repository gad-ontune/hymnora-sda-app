import { Suspense } from "react";
import { SearchExperience } from "@/components/search-experience";

export const metadata = {
  title: "Search",
  description: "Search across Hymnora SDA music, hymns, Bible, sermons, churches and events.",
};

export default function SearchPage() {
  return <Suspense fallback={<div className="mx-auto max-w-[1440px] py-20 text-center text-sm text-ink-muted">Opening search…</div>}><SearchExperience /></Suspense>;
}

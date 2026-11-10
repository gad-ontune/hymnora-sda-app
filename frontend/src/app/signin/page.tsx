import type { Metadata } from "next";
import { AuthExperience } from "@/components/auth-experience";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your Hymnora SDA account to pick up your library, notes and reminders.",
};

/**
 * The shell is skipped for these routes by `AppShell`, which is why the page
 * brings its own two-column frame: a sign-in form behind a sidebar and a music
 * player is two things asking for attention at the moment someone is trying to
 * type their password.
 */
export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string; reset?: string }> }) {
  const { next, reset } = await searchParams;
  // Only ever redirect within the app. A `next` of `//evil.example` is a
  // perfectly valid absolute URL and would turn this page into an open redirect.
  const nextPath = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  return <AuthExperience mode="signin" nextPath={nextPath} notice={reset ? "Your password is changed. Sign in with the new one." : undefined} />;
}

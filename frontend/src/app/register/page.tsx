import type { Metadata } from "next";
import { AuthExperience } from "@/components/auth-experience";

export const metadata: Metadata = {
  title: "Create your account",
  description: "Create a Hymnora SDA account for your library, notes, reminders and community.",
};

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const nextPath = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  return <AuthExperience mode="register" nextPath={nextPath} />;
}

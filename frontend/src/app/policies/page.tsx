import type { Metadata } from "next";
import { PoliciesExperience } from "@/components/policies-experience";

export const metadata: Metadata = {
  title: "Policies",
  description: "Terms of use, privacy, cookies and community standards for Hymnora SDA.",
};

export default function PoliciesPage() {
  return <PoliciesExperience />;
}

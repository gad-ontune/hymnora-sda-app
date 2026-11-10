import type { Metadata } from "next";
import { PasswordFrame, ResetPasswordForm } from "@/components/password-reset-experience";

export const metadata: Metadata = {
  title: "Set a new password",
  description: "Choose a new password for your Hymnora SDA account.",
  robots: { index: false },
};

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <PasswordFrame>
      <ResetPasswordForm token={token ?? ""} />
    </PasswordFrame>
  );
}

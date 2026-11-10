import type { Metadata } from "next";
import { ForgotPasswordForm, PasswordFrame } from "@/components/password-reset-experience";

export const metadata: Metadata = {
  title: "Forgot your password",
  description: "Request a link to set a new Hymnora SDA password.",
  robots: { index: false },
};

export default function ForgotPasswordPage() {
  return (
    <PasswordFrame>
      <ForgotPasswordForm />
    </PasswordFrame>
  );
}

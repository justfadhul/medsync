import type { Metadata } from "next";

import { ResetRequestForm } from "./form";

export const metadata: Metadata = { title: "Reset your password" };

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ link?: string }>;
}) {
  const { link } = await searchParams;
  return <ResetRequestForm expired={link === "expired"} />;
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { EXPIRED_PATH, linkProof } from "../flow";
import { ConfirmLinkForm } from "./form";

export const metadata: Metadata = { title: "Reset your password" };

/**
 * The reset email's link lands here. Opening it changes nothing: the link is used only when the
 * person presses Continue (confirmLinkAction), so a mail scanner that opens it first can't spend it.
 */
export default async function ConfirmLinkPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const proof = linkProof((name) => params[name]);
  if (!proof) redirect(EXPIRED_PATH);
  return <ConfirmLinkForm proof={proof} />;
}

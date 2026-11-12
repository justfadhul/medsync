"use client";

import type { LinkProof } from "../flow";
import { useActionState } from "react";

import { AuthCard } from "@/components/medsync/auth-card";
import { Button } from "@/components/ui/button";
import { RESET } from "@/content/auth";
import { ButtonSpinner } from "../../_components/auth-notice";
import { confirmLinkAction } from "../actions";

export function ConfirmLinkForm({ proof }: { proof: NonNullable<LinkProof> }) {
  // Disabled while pending: a second press would spend the used link and land on "expired".
  const [, formAction, pending] = useActionState(confirmLinkAction, null);
  return (
    <AuthCard title={RESET.title} subtitle={RESET.confirm.subtitle}>
      <form action={formAction} aria-busy={pending}>
        {"tokenHash" in proof ? (
          <>
            <input type="hidden" name="token_hash" value={proof.tokenHash} />
            <input type="hidden" name="type" value="recovery" />
          </>
        ) : (
          <input type="hidden" name="code" value={proof.code} />
        )}
        <Button
          type="submit"
          variant="primary"
          size="lg"
          disabled={pending}
          aria-busy={pending}
          className="h-12 w-full"
        >
          {pending ? (
            <>
              <ButtonSpinner />
              {RESET.confirm.submitting}
            </>
          ) : (
            RESET.confirm.submit
          )}
        </Button>
      </form>
    </AuthCard>
  );
}

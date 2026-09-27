"use client";

import type { PendingProposalRow } from "@/lib/catalog/governance";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { reviewCatalogProposalAction } from "../actions";

/** A single pending proposal with approve / reject (superadmin). */
export function ProposalReview({ proposal }: { proposal: PendingProposalRow }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function review(decision: "approved" | "rejected") {
    setError(null);
    startTransition(async () => {
      const res = await reviewCatalogProposalAction(proposal.id, decision);
      if (!res.ok) setError(res.error);
    });
  }

  const payload = proposal.payload as Record<string, unknown>;

  return (
    <li className="border-border bg-card flex flex-col gap-2 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-foreground text-body-s font-medium">
          <span className="text-muted-foreground font-mono text-[10px] tracking-[0.12em] uppercase">
            {proposal.kind}
          </span>{" "}
          {String(payload.display ?? payload.code ?? "—")}
        </span>
        <span className="text-muted-foreground font-mono text-[10.5px] tabular-nums">
          {proposal.createdAtIso.slice(0, 10)}
        </span>
      </div>
      {Array.isArray(payload.mapping) && payload.mapping.length ? (
        <p className="text-muted-foreground text-[11.5px]">
          Maps {payload.mapping.length} propert
          {payload.mapping.length === 1 ? "y" : "ies"}:{" "}
          <span className="text-foreground">
            {(payload.mapping as { propertyCode?: string }[])
              .map((m) => m.propertyCode)
              .filter(Boolean)
              .join(", ")}
          </span>
        </p>
      ) : null}
      <pre className="bg-muted/40 text-muted-foreground text-caption overflow-x-auto rounded-md p-2">
        {JSON.stringify(payload, null, 2)}
      </pre>
      {proposal.note ? (
        <p className="text-muted-foreground text-[12px]">Note: {proposal.note}</p>
      ) : null}
      <div className="flex items-center gap-1.5">
        <Button type="button" onClick={() => review("approved")} disabled={pending}>
          Approve
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => review("rejected")}
          disabled={pending}
        >
          Reject
        </Button>
      </div>
      {error ? (
        <p className="text-destructive text-[12px]" role="alert">
          {error}
        </p>
      ) : null}
    </li>
  );
}

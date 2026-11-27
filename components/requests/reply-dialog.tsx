"use client";

import { useId, useRef, useState, useTransition } from "react";

import { DraftLabel, inputClass, Row, Toggle } from "@/components/clerking/plan/parts";
import { EmrDialog } from "@/components/emr/emr-dialog";
import { Button } from "@/components/ui/button";
import { CARE_REQUEST_COPY } from "@/content/care-requests";
import { replyToRequestAction } from "@/lib/emr/actions/requests";

/**
 * The reply (ADR 0533): a clinician's signed note on the request's visit, composed and signed in one
 * step. Findings are optional; assessment, recommendations and the follow-up choice are required.
 * "No follow-up needed" also closes the request. The requesting team stays responsible.
 */

const R = CARE_REQUEST_COPY.replyDialog;

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-caption text-muted-foreground">
        {label}
      </label>
      <textarea
        id={id}
        rows={4}
        maxLength={4_000}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${inputClass} py-2`}
      />
    </div>
  );
}

export function ReplyDialog({
  open,
  onOpenChange,
  surface,
  requestId,
  patientUserId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  surface: "doctor" | "clinician";
  requestId: string;
  patientUserId: string;
}) {
  const [findings, setFindings] = useState("");
  const [assessment, setAssessment] = useState("");
  const [recommendations, setRecommendations] = useState("");
  const [followUp, setFollowUp] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  // One key while this reply is being written: a retry replays the same signature, never a second note.
  const key = useRef<string | null>(null);

  const why = !assessment.trim()
    ? R.why.assessment
    : !recommendations.trim()
      ? R.why.recommendations
      : followUp === null
        ? R.why.followUp
        : null;

  const sign = () =>
    followUp !== null &&
    start(async () => {
      setError(null);
      const result = await replyToRequestAction({
        surface,
        patientUserId,
        requestId,
        clientKey: (key.current ??= crypto.randomUUID()),
        findings: findings.trim() || undefined,
        assessment: assessment.trim(),
        recommendations: recommendations.trim(),
        followUp,
      });
      if (result.ok) {
        key.current = null;
        onOpenChange(false);
      } else setError(result.error);
    });

  return (
    <EmrDialog
      open={open}
      onOpenChange={onOpenChange}
      width="medium"
      title={R.title}
      description={CARE_REQUEST_COPY.responsible}
      footer={
        <div className="flex w-full flex-wrap items-center justify-end gap-3">
          {why ? (
            <span className="text-body-s text-muted-foreground mr-auto" aria-live="polite">
              {why}
            </span>
          ) : null}
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {R.cancel}
          </Button>
          <Button disabled={!!why || busy} onClick={sign}>
            {R.sign}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <DraftLabel>{R.draft}</DraftLabel>
        <Field label={R.findings} value={findings} onChange={setFindings} />
        <Field label={R.assessment} value={assessment} onChange={setAssessment} />
        <Field label={R.recommendations} value={recommendations} onChange={setRecommendations} />
        <Row label={R.followUp}>
          <div role="group" aria-label={R.followUp} className="flex flex-wrap gap-1.5">
            <Toggle on={followUp === true} onPress={() => setFollowUp(true)}>
              {R.followUpChips.again}
            </Toggle>
            <Toggle on={followUp === false} onPress={() => setFollowUp(false)}>
              {R.followUpChips.none}
            </Toggle>
          </div>
          {followUp === false ? (
            <p className="text-caption text-muted-foreground">{R.noFollowUpCloses}</p>
          ) : null}
        </Row>
        {error ? (
          <p role="alert" className="text-body-s text-foreground">
            {error}
          </p>
        ) : null}
      </div>
    </EmrDialog>
  );
}

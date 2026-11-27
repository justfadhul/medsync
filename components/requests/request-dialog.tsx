"use client";

import type { RequestDetail, RequestRow } from "@/lib/emr/read/requests";
import type { ActionResult } from "@/lib/emr/write/context";
import type { CancelReason, DeclineReason, RedirectReason } from "@/lib/requests/engine";
import type { ReactNode } from "react";
import Link from "next/link";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { ClockIcon } from "lucide-react";

import { inputClass, Row, Toggle } from "@/components/clerking/plan/parts";
import { EmrDialog } from "@/components/emr/emr-dialog";
import { Tag } from "@/components/medsync/tag";
import { Button } from "@/components/ui/button";
import { CARE_REQUEST_COPY } from "@/content/care-requests";
import {
  acceptRequestAction,
  cancelRequestAction,
  closeRequestAction,
  declineRequestAction,
  markRequestSeen,
  redirectRequestAction,
} from "@/lib/emr/actions/requests";
import { ago } from "@/lib/workspace/words";
import { ReplyDialog } from "./reply-dialog";

/**
 * One care request (ADR 0537): who is responsible first, then the question, urgency, help wanted,
 * problems and history in words. Only the actions the engine allows this viewer are shown, so no
 * button is there that cannot succeed; nothing happens by itself. Opening it records Seen once.
 */

const C = CARE_REQUEST_COPY;
const D = C.dialog;
type Surface = "doctor" | "clinician";

/** The state as a neutral square tag with its word; Overdue adds a clock and its word (never colour alone). */
export function StateTags({ row }: { row: Pick<RequestRow, "stateWord" | "overdue"> }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <Tag hue="slate">{row.stateWord}</Tag>
      {row.overdue ? (
        <Tag hue="slate">
          <ClockIcon aria-hidden className="size-3" />
          {C.page.overdue}
        </Tag>
      ) : null}
    </span>
  );
}

export const kindWords = (r: Pick<RequestRow, "kind" | "departmentName">) =>
  r.kind === "review" ? C.read.review : C.read.consult(r.departmentName);

function Reasons<K extends string>({
  label,
  table,
  value,
  onPick,
}: {
  label: string;
  table: Record<K, string>;
  value: K | null;
  onPick: (k: K) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {(Object.keys(table) as K[]).map((k) => (
        <Toggle key={k} on={value === k} onPress={() => onPick(k)}>
          {table[k]}
        </Toggle>
      ))}
    </div>
  );
}

/** One action: its fields, then its button, and the reason in words while it is disabled. */
function Block({
  title,
  children,
  button,
  why,
  busy,
  primary,
  onGo,
}: {
  title: string;
  children?: ReactNode;
  button: string;
  why: string | null;
  busy: boolean;
  primary?: boolean;
  onGo: () => void;
}) {
  return (
    <section className="border-border flex flex-col gap-3 rounded-lg border p-4">
      <h3 className="text-label text-foreground">{title}</h3>
      {children}
      <div className="flex flex-wrap items-center justify-end gap-3">
        {why ? (
          <span className="text-body-s text-muted-foreground mr-auto" aria-live="polite">
            {why}
          </span>
        ) : null}
        <Button variant={primary ? "primary" : "secondary"} disabled={!!why || busy} onClick={onGo}>
          {button}
        </Button>
      </div>
    </section>
  );
}

function Note({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-caption text-muted-foreground">
        {D.note}
      </label>
      <textarea
        id={id}
        rows={2}
        maxLength={2_000}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${inputClass} py-2`}
      />
    </div>
  );
}

export function RequestDialog({
  detail,
  surface,
  now,
  departments = [],
  onClose,
}: {
  detail: RequestDetail;
  surface: Surface;
  now: number;
  /** The hospital's clinical teams, for Redirect (loaded only when Redirect is allowed). */
  departments?: { id: string; name: string }[];
  onClose: () => void;
}) {
  const can = detail.canAct;
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [replying, setReplying] = useState(false);
  const [expect, setExpect] = useState<15 | 30 | 60 | null>(null);
  const [decline, setDecline] = useState<DeclineReason | null>(null);
  const [redirectTo, setRedirectTo] = useState<string>("");
  const [redirect, setRedirect] = useState<RedirectReason | null>(null);
  const [cancel, setCancel] = useState<CancelReason | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  // One key per act while the dialog is open: a retry after a lost answer replays, never doubles.
  const keys = useRef<Record<string, string>>({});
  const seenFor = useRef<string | null>(null);

  useEffect(() => {
    if (can.seen !== true || seenFor.current === detail.id) return;
    seenFor.current = detail.id;
    // Best effort: a failed Seen never blocks reading the request.
    void markRequestSeen({ surface, requestId: detail.id }).catch(() => undefined);
  }, [can.seen, detail.id, surface]);

  const base = { surface, requestId: detail.id };
  const run = (act: string, call: (clientKey: string) => Promise<ActionResult>) =>
    start(async () => {
      setError(null);
      const result = await call((keys.current[act] ??= crypto.randomUUID()));
      if (result.ok) {
        delete keys.current[act];
        setNotes((n) => ({ ...n, [act]: "" }));
      } else setError(result.error);
    });
  const noteOf = (act: string) => notes[act]?.trim() || undefined;
  const noteField = (act: string) => (
    <Note value={notes[act] ?? ""} onChange={(v) => setNotes((n) => ({ ...n, [act]: v }))} />
  );
  const teams = departments.filter((d) => d.id !== detail.departmentId);
  const where = [detail.patientName ?? C.page.hiddenPatient, detail.mrn, detail.wardName].filter(
    Boolean,
  );

  return (
    <EmrDialog
      open
      onOpenChange={(o) => (o ? undefined : onClose())}
      width="wide"
      kicker={where.join(" · ")}
      title={kindWords(detail)}
      description={C.responsible}
    >
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <StateTags row={detail} />
            <span className="text-caption text-muted-foreground">
              {C.page.from(detail.requesterName ?? C.read.someone, detail.requesterCadre)} ·{" "}
              {C.page.asked(ago(now - detail.askedAtMs))}
            </span>
          </div>
          <Row label={D.question}>
            <p className="text-body-s whitespace-pre-line">{detail.question ?? D.hiddenQuestion}</p>
          </Row>
          <Row label={D.urgency}>
            <p className="text-body-s">
              {C.urgency[detail.urgency as keyof typeof C.urgency] ?? detail.urgency}
            </p>
          </Row>
          {detail.helpWanted ? (
            <Row label={D.help}>
              <p className="text-body-s">{C.help[detail.helpWanted]}</p>
            </Row>
          ) : null}
          {detail.problems.length ? (
            <Row label={D.problems}>
              <ul className="text-body-s flex flex-col gap-0.5">
                {detail.problems.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </Row>
          ) : null}
          <Row label={D.history}>
            <ol className="text-body-s flex flex-col gap-1">
              {detail.history.map((e, i) => (
                <li key={i} className="flex flex-wrap gap-x-2">
                  <span>{e.words}</span>
                  <span className="text-muted-foreground">{D.ago(ago(now - e.atMs))}</span>
                </li>
              ))}
            </ol>
          </Row>
          {detail.canOpenChart && surface === "doctor" ? (
            <Link
              href={`/doctor/patients/${detail.patientUserId}`}
              className="text-body-s text-accent-text self-start underline-offset-4 hover:underline"
            >
              {D.openChart}
            </Link>
          ) : null}
        </div>

        <div className="flex flex-col gap-3">
          {can.accept === true ? (
            <Block
              title={D.accept.title}
              button={D.accept.button}
              why={null}
              busy={busy}
              primary
              onGo={() =>
                run("accept", (clientKey) =>
                  acceptRequestAction({ ...base, clientKey, expectInMin: expect }),
                )
              }
            >
              <Row label={D.accept.expect}>
                <div role="group" aria-label={D.accept.expect} className="flex flex-wrap gap-1.5">
                  {([15, 30, 60, null] as const).map((m) => (
                    <Toggle key={m ?? "none"} on={expect === m} onPress={() => setExpect(m)}>
                      {D.accept.chips[m ?? "none"]}
                    </Toggle>
                  ))}
                </div>
              </Row>
            </Block>
          ) : null}
          {can.reply === true ? (
            <Block
              title={D.reply.title}
              button={D.reply.button}
              why={null}
              busy={busy}
              primary
              onGo={() => setReplying(true)}
            >
              <p className="text-body-s text-muted-foreground">{D.reply.hint}</p>
            </Block>
          ) : null}
          {can.decline === true ? (
            <Block
              title={D.decline.title}
              button={D.decline.button}
              why={decline ? null : D.decline.why}
              busy={busy}
              onGo={() =>
                decline &&
                run("decline", (clientKey) =>
                  declineRequestAction({
                    ...base,
                    clientKey,
                    reasonCode: decline,
                    note: noteOf("decline"),
                  }),
                )
              }
            >
              <Reasons
                label={D.decline.reason}
                table={C.DECLINE_REASONS}
                value={decline}
                onPick={setDecline}
              />
              {noteField("decline")}
            </Block>
          ) : null}
          {can.redirect === true ? (
            <Block
              title={D.redirect.title}
              button={D.redirect.button}
              why={!redirectTo ? D.redirect.whyTeam : !redirect ? D.redirect.whyReason : null}
              busy={busy}
              primary
              onGo={() =>
                redirect &&
                run("redirect", (clientKey) =>
                  redirectRequestAction({
                    ...base,
                    clientKey,
                    departmentId: redirectTo,
                    reasonCode: redirect,
                    note: noteOf("redirect"),
                  }),
                )
              }
            >
              <Row label={D.redirect.team}>
                <select
                  aria-label={D.redirect.team}
                  value={redirectTo}
                  onChange={(e) => setRedirectTo(e.target.value)}
                  className={inputClass}
                >
                  <option value="" disabled>
                    {D.redirect.whyTeam}
                  </option>
                  {teams.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </Row>
              <Reasons
                label={D.redirect.reason}
                table={C.REDIRECT_REASONS}
                value={redirect}
                onPick={setRedirect}
              />
              {noteField("redirect")}
            </Block>
          ) : null}
          {can.close === true ? (
            <Block
              title={D.close.title}
              button={D.close.button}
              why={null}
              busy={busy}
              primary
              onGo={() => run("close", (clientKey) => closeRequestAction({ ...base, clientKey }))}
            >
              <p className="text-body-s text-muted-foreground">{D.close.hint}</p>
            </Block>
          ) : null}
          {can.cancel === true ? (
            <Block
              title={D.cancel.title}
              button={D.cancel.button}
              why={cancel ? null : D.cancel.why}
              busy={busy}
              onGo={() =>
                cancel &&
                run("cancel", (clientKey) =>
                  cancelRequestAction({
                    ...base,
                    clientKey,
                    reasonCode: cancel,
                    note: noteOf("cancel"),
                  }),
                )
              }
            >
              <Reasons
                label={D.cancel.reason}
                table={C.CANCEL_REASONS}
                value={cancel}
                onPick={setCancel}
              />
              {noteField("cancel")}
            </Block>
          ) : null}
          {busy ? <p className="text-caption text-muted-foreground">{D.working}</p> : null}
          {error ? (
            <p role="alert" className="text-body-s text-foreground">
              {error}
            </p>
          ) : null}
        </div>
      </div>
      {can.reply === true ? (
        <ReplyDialog
          open={replying}
          onOpenChange={setReplying}
          surface={surface}
          requestId={detail.id}
          patientUserId={detail.patientUserId}
        />
      ) : null}
    </EmrDialog>
  );
}

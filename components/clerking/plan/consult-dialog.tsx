"use client";

import type { PlanView } from "./model";
import type { PlanRequestLine } from "@/lib/clerking/plan/draft";
import type { ConsultUrgency, HelpWanted } from "@/lib/requests/engine";
import type { ReactNode } from "react";
import { useId, useState } from "react";

import { EmrDialog } from "@/components/emr/emr-dialog";
import { Button } from "@/components/ui/button";
import { CARE_REQUEST_COPY } from "@/content/care-requests";
import { DraftLabel, inputClass, Row, Toggle } from "./parts";

/**
 * "Ask another team" (ADR 0537): one consult line for the basket. Nothing is sent until the basket
 * is placed; the server checks the line again. The requesting team stays responsible.
 */

const C = CARE_REQUEST_COPY.consultDialog;
const MAX_NAMED = 5;

function Chips({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {children}
    </div>
  );
}

export function ConsultDialog({
  open,
  onOpenChange,
  v,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  v: PlanView;
  onAdd: (line: PlanRequestLine) => void;
}) {
  const departments = v.payload.requests?.departments ?? [];
  const [deptId, setDeptId] = useState<string | null>(null);
  const [named, setNamed] = useState<string[]>([]);
  const [urgency, setUrgency] = useState<ConsultUrgency | null>(null);
  const [help, setHelp] = useState<HelpWanted | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [question, setQuestion] = useState("");
  const [phoned, setPhoned] = useState<string | null>(null);
  const questionId = useId();
  const dept = departments.find((d) => d.id === deptId) ?? null;

  const reason = !dept
    ? C.why.team
    : !urgency
      ? C.why.urgency
      : !help
        ? C.why.help
        : !problems.length
          ? C.why.problems
          : !question.trim()
            ? C.why.question
            : null;

  const pickDept = (id: string) => {
    setDeptId(id);
    setNamed([]);
    setPhoned(null);
  };
  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  const add = () => {
    if (reason || !dept || !urgency || !help) return;
    onAdd({
      clientKey: crypto.randomUUID(),
      kind: "consult",
      targetDepartmentId: dept.id,
      wardId: v.draft.disposition?.wardId ?? null,
      namedUserIds: named,
      urgency,
      helpWanted: help,
      reasonConditionIds: problems,
      question: question.trim(),
      phoned: phoned ? { userId: phoned, at: new Date().toISOString() } : null,
      display: CARE_REQUEST_COPY.plan.consultDisplay(dept.name),
    });
  };

  return (
    <EmrDialog
      open={open}
      onOpenChange={onOpenChange}
      width="medium"
      title={C.title}
      description={CARE_REQUEST_COPY.responsible}
      footer={
        <div className="flex w-full flex-wrap items-center justify-end gap-3">
          {reason ? (
            <span className="text-body-s text-muted-foreground mr-auto" aria-live="polite">
              {reason}
            </span>
          ) : null}
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {C.cancel}
          </Button>
          <Button disabled={!!reason} onClick={add}>
            {C.add}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <DraftLabel>{C.draft}</DraftLabel>
        <Row label={C.team}>
          {departments.length <= 4 ? (
            <Chips label={C.team}>
              {departments.map((d) => (
                <Toggle key={d.id} on={d.id === deptId} onPress={() => pickDept(d.id)}>
                  {d.name}
                </Toggle>
              ))}
            </Chips>
          ) : (
            <select
              aria-label={C.team}
              value={deptId ?? ""}
              onChange={(e) => pickDept(e.target.value)}
              className={inputClass}
            >
              <option value="" disabled>
                {C.why.team}
              </option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          )}
        </Row>
        {dept ? (
          <Row label={C.people}>
            {dept.staff.length ? (
              <Chips label={C.people}>
                {dept.staff.map((s) => (
                  <Toggle
                    key={s.userId}
                    on={named.includes(s.userId)}
                    disabled={!named.includes(s.userId) && named.length >= MAX_NAMED}
                    onPress={() => setNamed((x) => toggle(x, s.userId))}
                  >
                    {`${s.name} · ${s.cadre}`}
                  </Toggle>
                ))}
              </Chips>
            ) : (
              <p className="text-caption text-muted-foreground">{C.noStaff}</p>
            )}
          </Row>
        ) : null}
        <Row label={C.urgency}>
          <Chips label={C.urgency}>
            {(Object.keys(C.urgencyChips) as ConsultUrgency[]).map((u) => (
              <Toggle key={u} on={urgency === u} onPress={() => setUrgency(u)}>
                {C.urgencyChips[u]}
              </Toggle>
            ))}
          </Chips>
        </Row>
        <Row label={C.help}>
          <Chips label={C.help}>
            {(Object.keys(C.helpChips) as HelpWanted[]).map((h) => (
              <Toggle key={h} on={help === h} onPress={() => setHelp(h)}>
                {C.helpChips[h]}
              </Toggle>
            ))}
          </Chips>
        </Row>
        <Row label={C.problems}>
          <Chips label={C.problems}>
            {v.cards.map((c) => (
              <Toggle
                key={c.versionId}
                on={problems.includes(c.versionId)}
                onPress={() => setProblems((x) => toggle(x, c.versionId))}
              >
                {c.display}
              </Toggle>
            ))}
          </Chips>
        </Row>
        <div className="flex flex-col gap-1">
          <label htmlFor={questionId} className="text-caption text-muted-foreground">
            {C.question}
          </label>
          <textarea
            id={questionId}
            value={question}
            maxLength={2_000}
            rows={4}
            onChange={(e) => setQuestion(e.target.value)}
            className={`${inputClass} py-2`}
          />
        </div>
        {dept?.staff.length ? (
          <Row label={C.phoned}>
            <Chips label={C.phoned}>
              {dept.staff.map((s) => (
                <Toggle
                  key={s.userId}
                  on={phoned === s.userId}
                  onPress={() => setPhoned((x) => (x === s.userId ? null : s.userId))}
                >
                  {s.name}
                </Toggle>
              ))}
            </Chips>
          </Row>
        ) : null}
      </div>
    </EmrDialog>
  );
}

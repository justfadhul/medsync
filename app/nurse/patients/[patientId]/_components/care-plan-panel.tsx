"use client";

import type { CareLibraryEntry } from "@/content/nursing-care-library";
import type { PlanProblem } from "@/lib/nursing-care/fold";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { createIntentKeys, UNKNOWN_OUTCOME } from "@/components/emr/desk/flows";
import { EmrDialog } from "@/components/emr/emr-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addCareProblem, endCareProblem, recordCareEvent } from "@/lib/emr/actions/nursing-care";
import { formatClock } from "@/lib/emr/charts/scale";

const EVAL_WORD: Record<string, string> = {
  met: "Met",
  progressing: "Progressing",
  not_met: "Not met",
};

/** Problems with their care items to tick, the shift evaluation, and adding a problem from the library. */
export function CarePlanPanel({
  patientUserId,
  encounterId,
  plan,
  library,
  actionsAllowed,
}: {
  patientUserId: string;
  encounterId: string;
  plan: PlanProblem[];
  library: CareLibraryEntry[];
  actionsAllowed: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const keys = useMemo(() => createIntentKeys(() => crypto.randomUUID()), []);
  const [message, setMessage] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const run = (
    intent: string,
    call: (clientKey: string) => Promise<{ ok: boolean; error?: string }>,
    done?: () => void,
  ) =>
    start(async () => {
      let r: { ok: boolean; error?: string };
      try {
        r = await keys.run(intent, call);
      } catch {
        return setMessage(UNKNOWN_OUTCOME);
      }
      if (!r.ok) return setMessage(r.error ?? "Not saved.");
      setMessage(null);
      done?.();
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-3">
      {plan.length === 0 ? (
        <p className="text-muted-foreground text-body-s">No nursing problems yet for this visit.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {plan.map((p) => (
            <article
              key={p.id}
              className="border-border bg-card flex flex-col gap-3 rounded-lg border p-4"
            >
              <header className="flex flex-col gap-0.5">
                <span className="text-heading-s text-foreground">{p.problem}</span>
                <span className="text-muted-foreground text-caption">
                  {[
                    p.label,
                    p.relatedTo ? `related to ${p.relatedTo}` : null,
                    p.asShownBy ? `as shown by ${p.asShownBy}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                <span className="text-foreground text-body-s">
                  Goal: {p.goal}
                  {p.goalBy ? ` · ${p.goalBy}` : ""}
                </span>
              </header>
              <ul className="flex flex-col gap-1.5">
                {p.items.map((i) => (
                  <li key={i.index}>
                    <label className="flex cursor-pointer items-start gap-2 text-[13.5px]">
                      <input
                        type="checkbox"
                        className="accent-primary mt-0.5 size-4"
                        checked={!!i.done}
                        disabled={!actionsAllowed || pending}
                        onChange={(e) =>
                          run(
                            `${p.id}:${i.index}:${e.target.checked}:${i.done?.at ?? ""}`,
                            (clientKey) =>
                              recordCareEvent({
                                surface: "nurse",
                                patientUserId,
                                clientKey,
                                problemId: p.id,
                                kind: e.target.checked ? "tick" : "untick",
                                itemIndex: i.index,
                              }),
                          )
                        }
                      />
                      <span className="flex flex-col">
                        <span className={i.done ? "text-muted-foreground" : "text-foreground"}>
                          {i.text}
                        </span>
                        {i.done ? (
                          <span className="text-muted-foreground text-caption">
                            Done {formatClock(new Date(i.done.at))}
                          </span>
                        ) : null}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <footer className="border-border flex flex-wrap items-center gap-2 border-t pt-3">
                <span className="text-muted-foreground text-caption">
                  {p.evaluation
                    ? `This shift: ${EVAL_WORD[p.evaluation.value] ?? p.evaluation.value}, ${formatClock(new Date(p.evaluation.at))}`
                    : "Not evaluated yet"}
                </span>
                {actionsAllowed ? (
                  <span className="ml-auto flex flex-wrap gap-1.5">
                    {Object.entries(EVAL_WORD).map(([v, w]) => (
                      <Button
                        key={v}
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={pending}
                        onClick={() =>
                          run(`${p.id}:eval:${v}:${p.evaluation?.at ?? ""}`, (clientKey) =>
                            recordCareEvent({
                              surface: "nurse",
                              patientUserId,
                              clientKey,
                              problemId: p.id,
                              kind: "evaluation",
                              evaluation: v as "met",
                            }),
                          )
                        }
                      >
                        {w}
                      </Button>
                    ))}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() =>
                        run(`${p.id}:resolve`, (clientKey) =>
                          endCareProblem({
                            surface: "nurse",
                            patientUserId,
                            clientKey,
                            problemId: p.id,
                            how: "resolved",
                          }),
                        )
                      }
                    >
                      Resolve
                    </Button>
                  </span>
                ) : null}
              </footer>
            </article>
          ))}
        </div>
      )}
      {message ? (
        <p role="alert" className="text-body-s text-foreground">
          {message}
        </p>
      ) : null}
      {actionsAllowed ? (
        <div>
          <Button type="button" variant="secondary" onClick={() => setAdding(true)}>
            Add a nursing problem
          </Button>
        </div>
      ) : null}
      <AddProblemDialog
        open={adding}
        onOpenChange={setAdding}
        library={library}
        pending={pending}
        onSave={(draft) =>
          run(
            `add:${JSON.stringify(draft)}`,
            (clientKey) =>
              addCareProblem({ surface: "nurse", patientUserId, encounterId, clientKey, ...draft }),
            () => setAdding(false),
          )
        }
      />
    </div>
  );
}

interface Draft {
  problem: string;
  label: string | null;
  relatedTo: string | null;
  asShownBy: string | null;
  goal: string;
  goalBy: string | null;
  careItems: string[];
  libraryKey: string | null;
}

function AddProblemDialog({
  open,
  onOpenChange,
  library,
  pending,
  onSave,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  library: CareLibraryEntry[];
  pending: boolean;
  onSave: (d: Draft) => void;
}) {
  const [key, setKey] = useState<string | null>(null);
  const [problem, setProblem] = useState("");
  const [related, setRelated] = useState("");
  const [signs, setSigns] = useState("");
  const [goal, setGoal] = useState("");
  const [goalBy, setGoalBy] = useState("");
  const [items, setItems] = useState("");
  const entry = library.find((l) => l.key === key) ?? null;
  const pick = (l: CareLibraryEntry) => {
    setKey(l.key);
    setProblem(l.problem);
    setRelated(l.relatedTo);
    setSigns(l.asShownBy[0] ?? "");
    setGoal(l.goals[0] ?? "");
    setItems(l.care.join("\n"));
  };
  return (
    <EmrDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add a nursing problem"
      description="Start from the ward's library or write your own. The library is a draft until the CSO signs it."
      width="wide"
      footer={
        <Button
          type="button"
          disabled={pending || !problem.trim() || !goal.trim() || !items.trim()}
          onClick={() =>
            onSave({
              problem,
              label: entry?.label ?? null,
              relatedTo: related || null,
              asShownBy: signs || null,
              goal,
              goalBy: goalBy || null,
              careItems: items
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean),
              libraryKey: key,
            })
          }
        >
          Add to the care plan
        </Button>
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <span className="text-muted-foreground font-mono text-[10.5px] tracking-[0.12em] uppercase">
            From the library
          </span>
          <div className="flex flex-wrap gap-1.5">
            {library.map((l) => (
              <Button
                key={l.key}
                type="button"
                size="sm"
                variant={key === l.key ? "primary" : "secondary"}
                onClick={() => pick(l)}
              >
                {l.problem}
              </Button>
            ))}
          </div>
          {entry ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-muted-foreground text-caption">Goals to choose from</span>
              <div className="flex flex-wrap gap-1.5">
                {entry.goals.map((g) => (
                  <Button
                    key={g}
                    type="button"
                    size="sm"
                    variant={goal === g ? "primary" : "secondary"}
                    onClick={() => setGoal(g)}
                  >
                    {g}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
        <div className="flex flex-col gap-2">
          {(
            [
              ["Problem", problem, setProblem],
              ["Related to", related, setRelated],
              ["As shown by", signs, setSigns],
              ["Goal", goal, setGoal],
              ["Goal by when", goalBy, setGoalBy],
            ] as const
          ).map(([label, value, set]) => (
            <label key={label} className="flex flex-col gap-1 text-[12.5px] font-medium">
              {label}
              <Input value={value} onChange={(e) => set(e.target.value)} maxLength={300} />
            </label>
          ))}
          <label className="flex flex-col gap-1 text-[12.5px] font-medium">
            Care, one per line
            <textarea
              value={items}
              onChange={(e) => setItems(e.target.value)}
              rows={4}
              className="border-input bg-background rounded-md border px-3 py-2 text-[13.5px]"
            />
          </label>
        </div>
      </div>
    </EmrDialog>
  );
}

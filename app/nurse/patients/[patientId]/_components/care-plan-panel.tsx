"use client";

import type { CareLibraryEntry } from "@/content/nursing-care-library";
import type { PlanProblem } from "@/lib/nursing-care/fold";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { createIntentKeys, UNKNOWN_OUTCOME } from "@/components/emr/desk/flows";
import { k, WIcon } from "@/components/nurse-ward/ui";
import { Chips, DeskDialog } from "@/components/reception/ui";
import { addCareProblem, endCareProblem, recordCareEvent } from "@/lib/emr/actions/nursing-care";
import { formatClock } from "@/lib/emr/charts/scale";

const EVAL_WORD: Record<string, string> = {
  met: "Met",
  progressing: "Progressing",
  not_met: "Not met",
};
const EVAL_CLASS: Record<string, string> = { met: "met", not_met: "not" };

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

  const [sel, setSel] = useState<string | null>(null);
  const on = plan.find((p) => p.id === sel) ?? plan[0] ?? null;
  const idx = on ? plan.indexOf(on) : -1;
  const ticks = plan.reduce((a, p) => a + p.items.length, 0);
  const done = plan.reduce((a, p) => a + p.items.filter((i) => i.done).length, 0);
  const lastEval = plan
    .flatMap((p) => (p.evaluation ? [p.evaluation] : []))
    .sort((a, b) => b.at.localeCompare(a.at))[0];
  const add = actionsAllowed ? (
    <button type="button" className={k("btn", "k", "sm")} onClick={() => setAdding(true)}>
      Add problems
    </button>
  ) : null;

  return (
    <>
      <div className={k("cpx-bar")}>
        <span className={k("cf-stat")}>
          <b>{plan.length}</b> active
        </span>
        <span className={k("cf-stat")}>
          <b>
            {done}/{ticks}
          </b>{" "}
          nursing tasks done
        </span>
        <span className={k("cf-stat")}>
          {lastEval ? (
            <>
              evaluated <b>{formatClock(new Date(lastEval.at))}</b>
            </>
          ) : (
            "not evaluated yet"
          )}
        </span>
        <span className={k("grow")} />
        {add}
      </div>
      {!on ? (
        <div className={k("cpx-empty")}>
          <b>No nursing care plan yet</b>
          <span>
            Start from the ward&rsquo;s library: each problem fills its cause, signs, goal and care
            to tick.
          </span>
          {add}
        </div>
      ) : (
        <div className={k("cpx")}>
          <div className={k("cpx-list")}>
            <div className={k("cpx-g")}>Active · {plan.length}</div>
            {plan.map((p, i) => {
              const n = p.items.length;
              const d = p.items.filter((x) => x.done).length;
              return (
                <button
                  key={p.id}
                  type="button"
                  className={k("cpx-row", p.id === on.id && "on")}
                  aria-pressed={p.id === on.id}
                  onClick={() => setSel(p.id)}
                >
                  <span className={k("cp-n")}>{i + 1}</span>
                  <span className={k("cpx-rt")}>
                    <b>{p.problem}</b>
                    {p.label ? <small>{p.label}</small> : null}
                    <span className={k("cpx-prog")} aria-label={`${d} of ${n} done`}>
                      <i style={{ width: `${n ? Math.round((d / n) * 100) : 0}%` }} />
                    </span>
                  </span>
                  <span className={k("cpx-rs")}>
                    <span className={k("cp-ev", p.evaluation && EVAL_CLASS[p.evaluation.value])}>
                      {p.evaluation
                        ? (EVAL_WORD[p.evaluation.value] ?? p.evaluation.value)
                        : "Not evaluated"}
                    </span>
                    <small>
                      {d}/{n} done
                    </small>
                  </span>
                </button>
              );
            })}
          </div>
          <div className={k("cpx-detail")}>
            <div className={k("cpx-h")}>
              <span className={k("cp-n")}>{idx + 1}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h3>{on.problem}</h3>
                <p>{on.label ?? "Nursing problem"}</p>
              </div>
              {actionsAllowed ? (
                <button
                  type="button"
                  className={k("btn", "sm")}
                  disabled={pending}
                  onClick={() =>
                    run(`${on.id}:resolve`, (clientKey) =>
                      endCareProblem({
                        surface: "nurse",
                        patientUserId,
                        clientKey,
                        problemId: on.id,
                        how: "resolved",
                      }),
                    )
                  }
                >
                  Mark resolved
                </button>
              ) : null}
            </div>
            <div className={k("cpx-pes")}>
              <span>
                <small>Related to</small>
                {on.relatedTo ?? "not written"}
              </span>
              <span>
                <small>As shown by</small>
                {on.asShownBy ?? "risk only"}
              </span>
              <span className={k("cp-goal")}>
                <small>Goal{on.goalBy ? ` · ${on.goalBy}` : ""}</small>
                <b>{on.goal}</b>
              </span>
            </div>
            <div className={k("cpx-cols")}>
              <div className={k("cpx-col")}>
                <div className={k("cpx-ch")}>
                  <span className={k("vcap")}>Nursing care · this shift</span>
                  <span className={k("cf-mt")}>
                    {on.items.filter((i) => i.done).length} of {on.items.length} done
                  </span>
                </div>
                {on.items.map((i) => (
                  <label key={i.index} className={k("cp-i", "cp-tick", i.done && "on")}>
                    <input
                      type="checkbox"
                      checked={!!i.done}
                      disabled={!actionsAllowed || pending}
                      onChange={(e) =>
                        run(
                          `${on.id}:${i.index}:${e.target.checked}:${i.done?.at ?? ""}`,
                          (clientKey) =>
                            recordCareEvent({
                              surface: "nurse",
                              patientUserId,
                              clientKey,
                              problemId: on.id,
                              kind: e.target.checked ? "tick" : "untick",
                              itemIndex: i.index,
                            }),
                        )
                      }
                    />
                    <span className={k("cp-box")} aria-hidden="true">
                      <WIcon n="tick" size={12} />
                    </span>
                    <span className={k("cp-t")}>
                      <b>{i.text}</b>
                      {i.done ? <small>Done {formatClock(new Date(i.done.at))}</small> : null}
                    </span>
                  </label>
                ))}
              </div>
              <div className={k("cpx-col")}>
                <div className={k("cpx-ch")}>
                  <span className={k("vcap")}>Evaluate this shift</span>
                  <span className={k("cf-mt")}>
                    {on.evaluation
                      ? `${EVAL_WORD[on.evaluation.value] ?? on.evaluation.value}, ${formatClock(new Date(on.evaluation.at))}`
                      : "not yet"}
                  </span>
                </div>
                {actionsAllowed ? (
                  <div className={k("seg")} role="group" aria-label="Is the goal met?">
                    {Object.entries(EVAL_WORD).map(([v, w]) => (
                      <button
                        key={v}
                        type="button"
                        className={k(on.evaluation?.value === v && "on")}
                        aria-pressed={on.evaluation?.value === v}
                        disabled={pending}
                        onClick={() =>
                          run(`${on.id}:eval:${v}:${on.evaluation?.at ?? ""}`, (clientKey) =>
                            recordCareEvent({
                              surface: "nurse",
                              patientUserId,
                              clientKey,
                              problemId: on.id,
                              kind: "evaluation",
                              evaluation: v as "met",
                            }),
                          )
                        }
                      >
                        {w}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      )}
      {message ? (
        <p role="alert" className={k("cf-note")}>
          {message}
        </p>
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
    </>
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
    <DeskDialog
      open={open}
      onClose={() => onOpenChange(false)}
      label="Add a nursing problem"
      size="xw"
      tile="tick"
      title="Add a nursing problem"
      lead="Start from the ward's signed library or write your own. Edit any line for this patient."
      cls={k("wd")}
    >
      <div className={k("frow")} style={{ alignItems: "start", gap: 20 }}>
        <div style={{ display: "grid", gap: 10, flex: 1, minWidth: 0 }}>
          <span className={k("sublbl")}>From the library</span>
          <Chips
            label="From the library"
            items={library.map((l) => [l.key, l.problem] as const)}
            value={key ?? ""}
            onPick={(v) => pick(library.find((l) => l.key === v)!)}
          />
          {entry ? (
            <>
              <span className={k("sublbl")}>Goals to choose from</span>
              <Chips label="Goal" items={entry.goals} value={goal} onPick={setGoal} />
            </>
          ) : null}
        </div>
        <div style={{ display: "grid", gap: 10, flex: 1, minWidth: 0 }}>
          {(
            [
              ["Problem", problem, setProblem],
              ["Related to", related, setRelated],
              ["As shown by", signs, setSigns],
              ["Goal", goal, setGoal],
              ["Goal by when", goalBy, setGoalBy],
            ] as const
          ).map(([label, value, set]) => (
            <label key={label} style={{ display: "grid", gap: 4 }}>
              <span className={k("sublbl")}>{label}</span>
              <input
                className={k("fin")}
                value={value}
                onChange={(e) => set(e.target.value)}
                maxLength={300}
              />
            </label>
          ))}
          <label style={{ display: "grid", gap: 4 }}>
            <span className={k("sublbl")}>Care, one per line</span>
            <textarea
              className={k("fin")}
              value={items}
              onChange={(e) => setItems(e.target.value)}
              rows={4}
            />
          </label>
        </div>
      </div>
      <div className={k("acts")}>
        <button type="button" className={k("btn")} onClick={() => onOpenChange(false)}>
          Cancel
        </button>
        <button
          type="button"
          className={k("btn", "k")}
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
        </button>
      </div>
    </DeskDialog>
  );
}

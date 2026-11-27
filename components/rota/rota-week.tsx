"use client";

import type { RotaAction } from "./assign-dialog";
import type { ActionResult } from "@/lib/emr/write/context";
import type { Post } from "@/lib/rota/cover";
import type { loadRotaWeek } from "@/lib/rota/read";
import type { FillSkip } from "@/lib/rota/write";
import { useState, useTransition } from "react";

import { EditorDialog } from "@/components/medsync/editor-dialog";
import { Panel } from "@/components/medsync/panel";
import { Tag } from "@/components/medsync/tag";
import { LabButton } from "@/components/tide/work/button";
import { DialogTitle } from "@/components/ui/dialog";
import { DUTY_ROTA_COPY } from "@/content/duty-rota";
import { addDays, shiftOf } from "@/lib/rota/cover";
import { AssignDialog } from "./assign-dialog";
import { DelegateDialog } from "./delegate-dialog";
import { dayLabel, GapReport, when } from "./gap-report";
import { PostDialog } from "./post-dialog";
import { SwapDialog } from "./swap-dialog";
import { TemplateDialog } from "./template-dialog";

const G = DUTY_ROTA_COPY.grid;
const U = DUTY_ROTA_COPY.upkeep;
type Swap = Week["swapsToDecide"][number];
type Filled = { written: number; skipped: FillSkip[] };
const HOUR = 3_600_000;
type Week = Awaited<ReturnType<typeof loadRotaWeek>>;
type Held = Week["assignments"][number];
const shiftWord = (a: Held) => {
  const s = shiftOf(a.startsAt, a.endsAt);
  return s ? DUTY_ROTA_COPY.shift[s].label : DUTY_ROTA_COPY.otherHours;
};
const OPEN = new Set(["planned", "in_post", "needs_cover"]);

type Dialog =
  | { k: "assign"; post: Post; day: string; holders: Held[] }
  | { k: "post" }
  | { k: "end"; a: Held }
  | { k: "archive"; post: Post }
  | { k: "unlock" }
  | { k: "template" }
  | { k: "delegate" }
  | { k: "ask"; a: Held; post: Post; day: string }
  | { k: "refuse"; s: Swap };

/**
 * One department's rota week (ADR 0534): rows are posts (the department's, then each ward's), columns Mon–Sun.
 * A cell is the duty day from 08:00 to 08:00 and lists its holders with the shift and a neutral state tag.
 * The rota is what was planned, never proof of presence. Every write goes back through the 0307 guard.
 */
export function RotaWeek({
  week,
  departmentId,
  departmentName,
  weekStart,
  wards,
  cadres,
  canEdit,
  canPublish = false,
  canDelegate = false,
  viewerId = null,
  actions,
}: {
  week: Week;
  departmentId: string;
  departmentName: string;
  /** The Monday (YYYY-MM-DD) the week starts on. */
  weekStart: string;
  wards: { id: string; name: string }[];
  cadres: { code: string; name: string }[];
  canEdit: boolean;
  /** Publish and unlock: the owner (admin or head), or a delegate handed publishing. */
  canPublish?: boolean;
  /** Handing the rota on: the owner only. */
  canDelegate?: boolean;
  /** The signed-in person: the holder of a duty may ask for cover on it once the week is published. */
  viewerId?: string | null;
  actions: {
    createPost: RotaAction;
    archivePost: RotaAction;
    assignDuty: RotaAction;
    endDuty: RotaAction;
    saveTemplate: RotaAction;
    endTemplate: RotaAction;
    fillWeek: (raw: unknown) => Promise<ActionResult<Filled>>;
    publishWeek: RotaAction;
    unlockWeek: RotaAction;
    askSwap?: RotaAction;
    decideSwap: RotaAction;
    addDelegate: RotaAction;
    revokeDelegate: RotaAction;
  };
}) {
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [filled, setFilled] = useState<Filled | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const published = week.published;
  const act = (go: () => Promise<ActionResult<unknown>>) =>
    start(async () => {
      setNote(null);
      const r = await go();
      if (!r.ok) setNote(r.error);
    });
  const close = () => setDialog(null);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const cadreNames = Object.fromEntries(cadres.map((c) => [c.code, c.name]));
  const shown = week.posts.filter(
    (p) => !p.archived || week.assignments.some((a) => a.postId === p.id),
  );
  const groups = [
    { key: "dept", name: G.departmentPosts, posts: shown.filter((p) => !p.wardId) },
    ...wards.map((w) => ({
      key: w.id,
      name: w.name,
      posts: shown.filter((p) => p.wardId === w.id),
    })),
  ].filter((g) => g.posts.length);
  const holdersOn = (post: Post, day: string) => {
    const from = Date.parse(`${day}T08:00:00+03:00`);
    return week.assignments.filter(
      (a) =>
        a.postId === post.id &&
        a.startsAt.getTime() < from + 24 * HOUR &&
        a.endsAt.getTime() > from,
    );
  };
  const postName = new Map(week.posts.map((p) => [p.id, p.name]));
  const personName = (id: string) =>
    week.eligible.find((e) => e.userId === id)?.name ?? DUTY_ROTA_COPY.unnamed;

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title={departmentName}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Tag>{published ? U.published : U.draft}</Tag>
            {canPublish ? (
              published ? (
                <LabButton size="sm" onClick={() => setDialog({ k: "unlock" })}>
                  {U.unlock}
                </LabButton>
              ) : (
                <LabButton
                  size="sm"
                  variant="primary"
                  busy={busy}
                  onClick={() => act(() => actions.publishWeek({ departmentId, weekStart }))}
                >
                  {U.publish}
                </LabButton>
              )
            ) : null}
            {canEdit ? (
              <>
                <LabButton size="sm" onClick={() => setDialog({ k: "template" })}>
                  {DUTY_ROTA_COPY.template.open}
                </LabButton>
                {!published && week.templates.length ? (
                  <LabButton
                    size="sm"
                    busy={busy}
                    onClick={() =>
                      start(async () => {
                        setNote(null);
                        const r = await actions.fillWeek({ departmentId, weekStart });
                        if (!r.ok) return setNote(r.error);
                        setFilled(r.data ?? { written: 0, skipped: [] });
                      })
                    }
                  >
                    {U.fill}
                  </LabButton>
                ) : null}
                <LabButton size="sm" onClick={() => setDialog({ k: "post" })}>
                  {G.newPost}
                </LabButton>
              </>
            ) : null}
          </div>
        }
      >
        <p className="text-muted-foreground text-caption px-4 pt-3">
          {DUTY_ROTA_COPY.plannedNotPresent}
          {published ? ` ${U.lockedNote}` : ""}
        </p>
        {note ? (
          <p role="alert" className="text-body-s text-foreground px-4 pt-2">
            {note}
          </p>
        ) : null}
        {filled ? (
          <div role="status" className="text-body-s flex flex-col gap-1 px-4 pt-3">
            <p>{U.filled(filled.written)}</p>
            {filled.skipped.length ? (
              <>
                <p className="font-semibold">{U.skippedTitle(filled.skipped.length)}</p>
                <ul className="flex flex-col gap-1">
                  {filled.skipped.map((k, i) => (
                    <li key={i}>
                      {U.skippedLine(
                        postName.get(k.line.postId) ?? "",
                        dayLabel(k.line.day),
                        DUTY_ROTA_COPY.shift[k.line.shift].label,
                        personName(k.line.userId),
                        k.why,
                      )}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            <div>
              <LabButton size="sm" variant="text" onClick={() => setFilled(null)}>
                {U.close}
              </LabButton>
            </div>
          </div>
        ) : null}
        {groups.length ? (
          <div className="overflow-x-auto px-2 pb-3">
            <table className="w-full min-w-[960px] border-collapse text-[13px]">
              <thead>
                <tr>
                  <th
                    scope="col"
                    className="text-caption text-muted-foreground w-52 px-2 py-2 text-left font-semibold"
                  >
                    {G.post}
                  </th>
                  {days.map((d) => (
                    <th
                      key={d}
                      scope="col"
                      className="text-caption text-muted-foreground px-2 py-2 text-left font-semibold"
                    >
                      {dayLabel(d)}
                    </th>
                  ))}
                </tr>
              </thead>
              {groups.map((g) => (
                <tbody key={g.key}>
                  <tr>
                    <th
                      colSpan={8}
                      scope="colgroup"
                      className="text-label text-foreground px-2 pt-3 pb-1 text-left"
                    >
                      {g.name}
                    </th>
                  </tr>
                  {g.posts.map((post) => (
                    <tr key={post.id} className="border-border border-t align-top">
                      <th scope="row" className="px-2 py-2 text-left font-normal">
                        <div className="flex flex-col items-start gap-1">
                          <span className="text-label text-foreground">{post.name}</span>
                          <span className="text-caption text-muted-foreground">
                            {DUTY_ROTA_COPY.level[post.level]} · {G.capacity(post.capacity)}
                          </span>
                          {post.archived ? (
                            <Tag>{G.archived}</Tag>
                          ) : canEdit ? (
                            <LabButton
                              size="sm"
                              variant="text"
                              onClick={() => setDialog({ k: "archive", post })}
                            >
                              {G.archive}
                            </LabButton>
                          ) : null}
                        </div>
                      </th>
                      {days.map((day) => {
                        const held = holdersOn(post, day);
                        return (
                          <td key={day} className="px-2 py-2">
                            <ul className="flex flex-col gap-2">
                              {held.map((a) => (
                                <li key={a.id} className="flex flex-col items-start gap-1">
                                  <span className="text-foreground">{a.name}</span>
                                  <span className="text-caption text-muted-foreground">
                                    {shiftWord(a)}
                                    {a.kind === "rostered"
                                      ? ""
                                      : ` · ${DUTY_ROTA_COPY.kind[a.kind]}`}
                                  </span>
                                  <Tag>{DUTY_ROTA_COPY.state[a.state]}</Tag>
                                  {published &&
                                  viewerId === a.userId &&
                                  actions.askSwap &&
                                  OPEN.has(a.state) ? (
                                    <LabButton
                                      size="sm"
                                      variant="text"
                                      aria-label={U.askCoverLabel(post.name, dayLabel(day))}
                                      onClick={() => setDialog({ k: "ask", a, post, day })}
                                    >
                                      {U.askCover}
                                    </LabButton>
                                  ) : null}
                                  {canEdit && !published && OPEN.has(a.state) ? (
                                    <LabButton
                                      size="sm"
                                      variant="text"
                                      onClick={() => setDialog({ k: "end", a })}
                                    >
                                      {G.endEarly}
                                    </LabButton>
                                  ) : null}
                                </li>
                              ))}
                            </ul>
                            {canEdit && !published && !post.archived ? (
                              <LabButton
                                size="sm"
                                variant="text"
                                data-day={day}
                                aria-label={G.addLabel(post.name, dayLabel(day))}
                                onClick={() => setDialog({ k: "assign", post, day, holders: held })}
                              >
                                {G.add}
                              </LabButton>
                            ) : null}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        ) : (
          <p className="text-muted-foreground text-body-s px-4 py-3">{G.noPosts}</p>
        )}
      </Panel>

      {canEdit ? (
        <Panel title={DUTY_ROTA_COPY.decide.title} count={week.swapsToDecide.length}>
          {week.swapsToDecide.length ? (
            <ul className="divide-border divide-y">
              {week.swapsToDecide.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
                  <span className="text-body-s">
                    {DUTY_ROTA_COPY.decide.line(
                      s.askedByName,
                      s.kind,
                      s.colleagueName,
                      s.postName,
                      `${when(s.startsAt)} – ${when(s.endsAt)}`,
                    )}
                  </span>
                  <LabButton
                    size="sm"
                    variant="primary"
                    busy={busy}
                    onClick={() =>
                      act(() => actions.decideSwap({ requestId: s.id, decision: "approved" }))
                    }
                  >
                    {DUTY_ROTA_COPY.decide.approve}
                  </LabButton>
                  <LabButton size="sm" onClick={() => setDialog({ k: "refuse", s })}>
                    {DUTY_ROTA_COPY.decide.refuse}
                  </LabButton>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-body-s px-4 py-3">
              {DUTY_ROTA_COPY.decide.none}
            </p>
          )}
        </Panel>
      ) : null}

      {canDelegate ? (
        <Panel
          title={DUTY_ROTA_COPY.delegate.list}
          count={week.delegates.length}
          action={
            <LabButton size="sm" onClick={() => setDialog({ k: "delegate" })}>
              {DUTY_ROTA_COPY.delegate.open}
            </LabButton>
          }
        >
          {week.delegates.length ? (
            <ul className="divide-border divide-y">
              {week.delegates.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                  <span className="text-body-s">
                    {DUTY_ROTA_COPY.delegate.entry(
                      d.name,
                      d.canPublish,
                      d.until ? dayLabel(d.until) : null,
                    )}
                  </span>
                  <LabButton
                    size="sm"
                    variant="text"
                    busy={busy}
                    onClick={() => act(() => actions.revokeDelegate({ delegateId: d.id }))}
                  >
                    {DUTY_ROTA_COPY.delegate.revoke}
                  </LabButton>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-body-s px-4 py-3">
              {DUTY_ROTA_COPY.delegate.none}
            </p>
          )}
        </Panel>
      ) : null}

      <GapReport
        gaps={week.gaps.map((g) => ({
          postName: postName.get(g.postId) ?? "",
          from: g.from,
          to: g.to,
        }))}
        needsCover={week.needsCover.map((a) => ({
          postName: postName.get(a.postId) ?? "",
          name: a.name,
          from: a.startsAt,
          to: a.endsAt,
        }))}
      />

      {dialog?.k === "assign" ? (
        <AssignDialog
          post={dialog.post}
          day={dialog.day}
          eligible={week.eligible}
          cadreNames={cadreNames}
          holders={dialog.holders
            .filter((a) => OPEN.has(a.state))
            .map((a) => ({ id: a.id, name: `${a.name} · ${shiftWord(a)}` }))}
          assign={actions.assignDuty}
          onClose={close}
        />
      ) : dialog?.k === "post" ? (
        <PostDialog
          departmentId={departmentId}
          wards={wards}
          cadres={cadres}
          posts={week.posts.filter((p) => !p.archived)}
          createPost={actions.createPost}
          onClose={close}
        />
      ) : dialog?.k === "end" ? (
        <AskDialog
          title={DUTY_ROTA_COPY.end.title(dialog.a.name)}
          reason
          save={DUTY_ROTA_COPY.end.save}
          onSave={(reason) => actions.endDuty({ assignmentId: dialog.a.id, reason })}
          onClose={close}
        />
      ) : dialog?.k === "unlock" ? (
        <AskDialog
          title={U.unlockTitle(departmentName)}
          body={U.unlockBody}
          reason
          why={U.unlockWhy}
          save={U.unlockSave}
          onSave={(reason) => actions.unlockWeek({ departmentId, weekStart, reason })}
          onClose={close}
        />
      ) : dialog?.k === "refuse" ? (
        <AskDialog
          title={DUTY_ROTA_COPY.decide.refuseTitle}
          reason
          save={DUTY_ROTA_COPY.decide.refuseSave}
          onSave={(reason) =>
            actions.decideSwap({ requestId: dialog.s.id, decision: "refused", reason })
          }
          onClose={close}
        />
      ) : dialog?.k === "template" ? (
        <TemplateDialog
          posts={week.posts.filter((p) => !p.archived)}
          lines={week.templates}
          eligible={week.eligible}
          save={actions.saveTemplate}
          end={actions.endTemplate}
          onClose={close}
        />
      ) : dialog?.k === "delegate" ? (
        <DelegateDialog
          eligible={week.eligible.filter((e) => e.userId !== viewerId)}
          add={(raw) => actions.addDelegate({ departmentId, ...(raw as object) })}
          onClose={close}
        />
      ) : dialog?.k === "ask" && actions.askSwap ? (
        <SwapDialog
          title={DUTY_ROTA_COPY.swap.title(dialog.post.name, dayLabel(dialog.day))}
          assignmentId={dialog.a.id}
          colleagues={week.eligible
            .filter(
              (e) => e.userId !== dialog.a.userId && dialog.post.eligibleCadres.includes(e.cadre),
            )
            .map((e) => ({ userId: e.userId, name: e.name }))}
          theirDuties={week.assignments
            .filter(
              (x) =>
                x.postId === dialog.post.id && x.userId !== dialog.a.userId && OPEN.has(x.state),
            )
            .map((x) => ({
              id: x.id,
              userId: x.userId,
              label: `${when(x.startsAt)} · ${shiftWord(x)}`,
            }))}
          ask={actions.askSwap}
          onClose={close}
        />
      ) : dialog?.k === "archive" ? (
        <AskDialog
          title={DUTY_ROTA_COPY.archiveAsk.title(dialog.post.name)}
          body={DUTY_ROTA_COPY.archiveAsk.body}
          save={DUTY_ROTA_COPY.archiveAsk.save}
          onSave={() => actions.archivePost({ postId: dialog.post.id })}
          onClose={close}
        />
      ) : null}
    </div>
  );
}

/** End early (asks for the reason) and archive a post (asks to confirm). */
function AskDialog({
  title,
  body,
  reason: wantsReason,
  why,
  save,
  onSave,
  onClose,
}: {
  title: string;
  body?: string;
  reason?: boolean;
  why?: string;
  save: string;
  onSave: (reason: string) => ReturnType<RotaAction>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const go = () =>
    start(async () => {
      setError(null);
      const r = await onSave(reason);
      if (!r.ok) return setError(r.error);
      onClose();
    });
  return (
    <EditorDialog open onOpenChange={(o) => !o && !pending && onClose()} width="medium">
      <div className="flex flex-col gap-1 px-6 pt-5">
        <DialogTitle>{title}</DialogTitle>
        {body ? <p className="text-body-s text-ink-600">{body}</p> : null}
      </div>
      <div className="flex flex-col gap-3 px-6 py-4">
        {wantsReason ? (
          <label className="flex flex-col gap-2">
            <span className="text-body-s font-semibold">{DUTY_ROTA_COPY.end.reason}</span>
            <input
              value={reason}
              maxLength={200}
              onChange={(e) => setReason(e.target.value)}
              className="border-input bg-card text-body-s h-10 rounded-[10px] border px-3"
            />
          </label>
        ) : null}
        {error ? (
          <p role="alert" className="text-body-s text-foreground">
            {error}
          </p>
        ) : null}
      </div>
      <div className="border-border flex flex-wrap items-center justify-end gap-2 border-t px-6 py-3">
        <LabButton variant="quiet" onClick={onClose} busy={pending}>
          {DUTY_ROTA_COPY.end.cancel}
        </LabButton>
        <LabButton
          variant="primary"
          onClick={go}
          busy={pending}
          disabledReason={
            wantsReason && reason.trim().length < 2 ? (why ?? DUTY_ROTA_COPY.end.why) : null
          }
        >
          {save}
        </LabButton>
      </div>
    </EditorDialog>
  );
}

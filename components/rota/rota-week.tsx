"use client";

import type { RotaAction } from "./assign-dialog";
import type { Post } from "@/lib/rota/cover";
import type { loadRotaWeek } from "@/lib/rota/read";
import { useState, useTransition } from "react";

import { EditorDialog } from "@/components/medsync/editor-dialog";
import { Panel } from "@/components/medsync/panel";
import { Tag } from "@/components/medsync/tag";
import { LabButton } from "@/components/tide/work/button";
import { DialogTitle } from "@/components/ui/dialog";
import { DUTY_ROTA_COPY } from "@/content/duty-rota";
import { addDays, shiftOf } from "@/lib/rota/cover";
import { AssignDialog } from "./assign-dialog";
import { dayLabel, GapReport } from "./gap-report";
import { PostDialog } from "./post-dialog";

const G = DUTY_ROTA_COPY.grid;
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
  | { k: "archive"; post: Post };

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
  actions: {
    createPost: RotaAction;
    archivePost: RotaAction;
    assignDuty: RotaAction;
    endDuty: RotaAction;
  };
}) {
  const [dialog, setDialog] = useState<Dialog | null>(null);
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

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title={departmentName}
        action={
          canEdit ? (
            <LabButton size="sm" onClick={() => setDialog({ k: "post" })}>
              {G.newPost}
            </LabButton>
          ) : null
        }
      >
        <p className="text-muted-foreground text-caption px-4 pt-3">
          {DUTY_ROTA_COPY.plannedNotPresent}
        </p>
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
                                  {canEdit && OPEN.has(a.state) ? (
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
                            {canEdit && !post.archived ? (
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
  save,
  onSave,
  onClose,
}: {
  title: string;
  body?: string;
  reason?: boolean;
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
          disabledReason={wantsReason && reason.trim().length < 2 ? DUTY_ROTA_COPY.end.why : null}
        >
          {save}
        </LabButton>
      </div>
    </EditorDialog>
  );
}

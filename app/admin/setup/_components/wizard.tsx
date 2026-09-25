"use client";

import type { StepState } from "../_lib/rules";
import type { DepartmentsData } from "./departments-task";
import type { ProfileData } from "./profile-tasks";
import type { ReactNode } from "react";
import dynamic from "next/dynamic";
import { useActionState } from "react";
import { CheckIcon, PlusIcon, TrashIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pill } from "@/components/ui/pill";
import { SETUP } from "@/content/onboarding";
import { CHECKLIST, OPD_BANDS_V2 } from "@/content/onboarding-setup";
import { cn } from "@/lib/utils";
import { countDone, departmentLabel, neededTasks } from "../_lib/rules";
import {
  addWardAction,
  finaliseSetupAction,
  inviteBackupAdminAction,
  inviteStaffAction,
  removeWardAction,
} from "../actions";
import { DepartmentsTask } from "./departments-task";
import { formatDay, FormStatus } from "./ui";

// The recommended/optional tasks sit in collapsed rows: their code loads after the page does (Law 10).
const LocationTask = dynamic(() => import("./location-task").then((m) => m.LocationTask), {
  ssr: false,
});
const ServicesTask = dynamic(() => import("./profile-tasks").then((m) => m.ServicesTask), {
  ssr: false,
});
const OperatingTask = dynamic(() => import("./profile-tasks").then((m) => m.OperatingTask), {
  ssr: false,
});
const ContactsTask = dynamic(() => import("./profile-tasks").then((m) => m.ContactsTask), {
  ssr: false,
});

/**
 * Hospital setup checklist (§5.10) — grown from the six-step wizard (kickoff §F).
 *
 * One page, no Next: every task is a native <details> row with its own short form and Save.
 * "Done" is derived from the data the server passes in, never from local storage, so closing the
 * tab and coming back resumes exactly where the rows are. Ticks are ink, actions are teal.
 */

interface WizardProps {
  hospital: { id: string; name: string };
  hasApplication: boolean;
  departments: DepartmentsData & { confirmedCount: number; startConfirmed: boolean };
  wards: ReadonlyArray<{ id: string; name: string; bedCount: number }>;
  roster: ReadonlyArray<{ id: string; designation: string; email: string; fullName: string }>;
  pendingInvitations: ReadonlyArray<{ id: string; email: string; invitedAtIso: string }>;
  location: { accuracyM: number; atIso: string | null } | null;
  profile: ProfileData | null;
  agreement: { version: string; name: string; signedAtIso: string } | null;
}

const A = CHECKLIST.action;

export function SetupWizard(props: WizardProps) {
  const { departments: d, profile: p } = props;
  const hasBackup = props.roster.some((r) => r.designation === "backup");
  const primaryDone = props.roster.some((r) => r.designation === "primary");
  const needed = neededTasks({
    departments: d.confirmedCount,
    startChosen: d.startConfirmed,
    backup: hasBackup,
    wards: props.wards.length,
  });
  const neededTotal = Object.keys(needed).length;
  const neededDone = countDone(needed);
  const ready = neededDone === neededTotal && primaryDone;

  const servicesDone = !!p && p.servicesOffered.length > 0;
  const operatingDone =
    !!p &&
    [
      p.internetConnectivity,
      p.powerBackup,
      p.bedCapacityBand,
      p.clinicalStaffBand,
      p.existingEmr,
    ].every(Boolean) &&
    OPD_BANDS_V2.some((b) => b.code === p.dailyOpdBand);
  const contactsDone = !!p && !!p.mainPhone && !!p.officialEmail;
  const noApp = <p className="text-body-s text-muted-foreground">{CHECKLIST.noApplication}</p>;

  return (
    <div className="mx-auto w-full max-w-[860px] px-4 py-8 sm:px-8 sm:py-12">
      <header className="mb-8 flex flex-col gap-2">
        <span className="text-muted-foreground font-mono text-[10px] tracking-[0.18em] uppercase">
          {CHECKLIST.eyebrow}
        </span>
        <h1 className="font-display text-foreground text-heading-l leading-tight font-medium tracking-[-0.02em]">
          {CHECKLIST.title(props.hospital.name)}
        </h1>
        <p className="text-body-m text-foreground font-medium">
          {CHECKLIST.neededCount(neededDone, neededTotal)}
        </p>
        <p className="text-muted-foreground text-body-s">{CHECKLIST.lead}</p>
      </header>

      <Group title={SETUP.neededTitle}>
        <Task
          title={CHECKLIST.departments.title}
          done={needed.departments}
          summary={CHECKLIST.departments.summary(
            d.confirmedCount,
            d.start ? departmentLabel(d.start) : null,
          )}
          action={needed.departments ? A.change : A.start}
        >
          <DepartmentsTask
            hospitalId={props.hospital.id}
            hasApplication={props.hasApplication}
            data={d}
          />
        </Task>
        <Task
          title={CHECKLIST.backup.title}
          done={hasBackup}
          summary={CHECKLIST.backup.summary(hasBackup)}
          action={hasBackup ? A.change : A.start}
        >
          <StepAdminTeam hospitalId={props.hospital.id} roster={props.roster} />
        </Task>
        <Task
          title={CHECKLIST.wards.title}
          done={needed.wards}
          summary={CHECKLIST.wards.summary(props.wards.length)}
          action={needed.wards ? A.change : A.start}
        >
          <StepWards hospitalId={props.hospital.id} wards={props.wards} />
        </Task>
      </Group>

      <Group title={SETUP.recommendedTitle}>
        <Task
          title={SETUP.location}
          done={!!props.location}
          summary={
            props.location
              ? CHECKLIST.location.summaryDone(props.location.accuracyM)
              : CHECKLIST.location.summaryTodo
          }
          action={props.location ? A.change : A.set}
        >
          <LocationTask hospitalId={props.hospital.id} saved={props.location} />
        </Task>
        <Task
          title={SETUP.services}
          done={servicesDone}
          summary={
            servicesDone
              ? CHECKLIST.services.summaryDone(p.servicesOffered.length)
              : CHECKLIST.services.summaryTodo
          }
          action={servicesDone ? A.change : A.start}
        >
          {p ? <ServicesTask hospitalId={props.hospital.id} p={p} /> : noApp}
        </Task>
        <Task
          title={SETUP.operating}
          done={operatingDone}
          summary={
            operatingDone ? CHECKLIST.operating.summaryDone : CHECKLIST.operating.summaryTodo
          }
          action={operatingDone ? A.change : A.start}
        >
          {p ? <OperatingTask hospitalId={props.hospital.id} p={p} /> : noApp}
        </Task>
      </Group>

      <Group title={SETUP.optionalTitle}>
        <Task
          title={SETUP.contacts}
          done={contactsDone}
          summary={contactsDone ? CHECKLIST.contacts.summaryDone : CHECKLIST.contacts.summaryTodo}
          action={contactsDone ? A.change : A.add}
        >
          {p ? <ContactsTask hospitalId={props.hospital.id} p={p} /> : noApp}
        </Task>
      </Group>

      {props.agreement ? (
        <p className="text-body-s text-muted-foreground border-border mb-8 border-t pt-4">
          {CHECKLIST.agreement(
            props.agreement.version,
            props.agreement.name,
            formatDay(props.agreement.signedAtIso),
          )}
        </p>
      ) : null}

      <Group>
        <Task
          title={CHECKLIST.staff.title}
          summary={CHECKLIST.staff.summary(props.pendingInvitations.length)}
          action={A.add}
        >
          <StepStaff hospitalId={props.hospital.id} pendingInvitations={props.pendingInvitations} />
        </Task>
      </Group>

      <section
        aria-labelledby="setup-go-live"
        className="border-border bg-card shadow-card rounded-xl border p-5 sm:p-6"
      >
        <h2 id="setup-go-live" className="text-foreground text-heading-s font-medium">
          {CHECKLIST.goLive.title}
        </h2>
        <p className="text-body-s text-foreground mt-1">
          {ready
            ? CHECKLIST.goLive.ready
            : CHECKLIST.goLive.notReady(neededTotal - neededDone || 1)}
        </p>
        <StepGoLive hospitalId={props.hospital.id} ready={ready} />
      </section>
    </div>
  );
}

/* ─── Checklist rows ─────────────────────────────────────────────── */

function Group({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="mb-8 flex flex-col gap-3">
      {title ? (
        <h2 className="text-muted-foreground font-mono text-[11px] tracking-[0.14em] uppercase">
          {title}
        </h2>
      ) : null}
      <ul className="flex flex-col gap-2">{children}</ul>
    </section>
  );
}

/** One task: a native disclosure. State is a shape plus a word (never colour alone). */
function Task({
  title,
  summary,
  done,
  action,
  children,
}: {
  title: string;
  summary: string;
  /** Omitted for rows that aren't a checklist task (staff invitations). */
  done?: boolean;
  action: string;
  children: ReactNode;
}) {
  const stateWord = done === undefined ? null : done ? CHECKLIST.state.done : CHECKLIST.state.todo;
  return (
    <li className="border-border bg-card rounded-lg border">
      <details className="group">
        <summary className="hover:bg-muted/40 ease-expo-out flex min-h-11 cursor-pointer list-none items-center gap-3 rounded-lg px-4 py-3 transition-colors duration-100 outline-none focus-visible:shadow-[0_0_0_2px_rgba(20,184,166,0.4)] motion-reduce:transition-none sm:px-5 [&::-webkit-details-marker]:hidden">
          {done === undefined ? null : (
            <span
              aria-hidden
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full border",
                done ? "border-foreground text-foreground" : "border-gray-300 dark:border-gray-600",
              )}
            >
              {done ? <CheckIcon className="size-3.5" strokeWidth={2.25} /> : null}
            </span>
          )}
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-foreground text-body-m font-medium">{title}</span>
            <span className="text-muted-foreground text-body-s">
              {stateWord ? `${stateWord} · ${summary}` : summary}
            </span>
          </span>
          <span className="text-body-s font-medium text-teal-700 group-open:invisible dark:text-teal-400">
            {action}
          </span>
        </summary>
        <div className="border-border border-t px-4 py-4 sm:px-5">{children}</div>
      </details>
    </li>
  );
}

/* ─── Wards ──────────────────────────────────────────────────────── */

function StepWards({
  hospitalId,
  wards,
}: {
  hospitalId: string;
  wards: ReadonlyArray<{ id: string; name: string; bedCount: number }>;
}) {
  return (
    <div className="flex flex-col gap-3">
      {wards.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {wards.map((w) => (
            <li
              key={w.id}
              className="border-border bg-muted/30 text-body-s flex items-center justify-between gap-3 rounded-md border py-1 pr-1 pl-3"
            >
              <span className="text-foreground flex-1 font-medium">{w.name}</span>
              <span className="text-muted-foreground font-mono tabular-nums">
                {CHECKLIST.wards.bedCount(w.bedCount)}
              </span>
              <RemoveWardForm hospitalId={hospitalId} wardId={w.id} />
            </li>
          ))}
        </ul>
      ) : null}
      <AddWardForm hospitalId={hospitalId} />
    </div>
  );
}

function AddWardForm({ hospitalId }: { hospitalId: string }) {
  const [state, action, pending] = useActionState<StepState, FormData>(addWardAction, {});
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="hospital_id" value={hospitalId} />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex flex-1 flex-col gap-1">
          <Label htmlFor="ward_name" className="text-body-s">
            {CHECKLIST.wards.name}
          </Label>
          <Input
            id="ward_name"
            name="name"
            placeholder={CHECKLIST.wards.namePlaceholder}
            required
            maxLength={120}
            className="h-11"
          />
        </div>
        <div className="flex flex-col gap-1 sm:w-[120px]">
          <Label htmlFor="bed_count" className="text-body-s">
            {CHECKLIST.wards.beds}
          </Label>
          <Input
            id="bed_count"
            name="bed_count"
            type="number"
            inputMode="numeric"
            min={0}
            defaultValue={0}
            required
            className="h-11"
          />
        </div>
        <Button type="submit" variant="secondary" size="md" className="min-h-11" disabled={pending}>
          <PlusIcon aria-hidden className="size-3.5" /> {CHECKLIST.wards.add}
        </Button>
      </div>
      <FormStatus state={state} />
    </form>
  );
}

function RemoveWardForm({ hospitalId, wardId }: { hospitalId: string; wardId: string }) {
  const [, action, pending] = useActionState<StepState, FormData>(removeWardAction, {});
  return (
    <form action={action}>
      <input type="hidden" name="hospital_id" value={hospitalId} />
      <input type="hidden" name="ward_id" value={wardId} />
      <Button
        type="submit"
        variant="ghost"
        size="iconSm"
        className="size-11"
        disabled={pending}
        aria-label={CHECKLIST.wards.remove}
      >
        <TrashIcon className="size-3.5" />
      </Button>
    </form>
  );
}

/* ─── Backup admin ───────────────────────────────────────────────── */

function StepAdminTeam({
  hospitalId,
  roster,
}: {
  hospitalId: string;
  roster: ReadonlyArray<{ id: string; designation: string; email: string; fullName: string }>;
}) {
  const [state, action, pending] = useActionState<StepState, FormData>(inviteBackupAdminAction, {});
  const B = CHECKLIST.backup;
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-1.5">
        {roster.map((r) => (
          <li
            key={r.id}
            className="border-border bg-muted/30 text-body-s flex items-center justify-between gap-3 rounded-md border px-3 py-2"
          >
            <span className="flex min-w-0 flex-col">
              <span className="text-foreground font-medium">{r.fullName}</span>
              <span className="text-muted-foreground text-caption truncate font-mono">
                {r.email}
              </span>
            </span>
            <Pill>
              {r.designation === "primary" ? B.designation.primary : B.designation.backup}
            </Pill>
          </li>
        ))}
      </ul>
      <p className="text-body-s text-muted-foreground">{B.lead}</p>
      <form action={action} className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <input type="hidden" name="hospital_id" value={hospitalId} />
        <div className="flex flex-1 flex-col gap-1">
          <Label htmlFor="backup_email" className="text-body-s">
            {B.email}
          </Label>
          <Input
            id="backup_email"
            name="email"
            type="email"
            autoComplete="off"
            required
            placeholder="colleague@hospital.go.ug"
            className="h-11"
          />
        </div>
        <Button type="submit" variant="secondary" size="md" className="min-h-11" disabled={pending}>
          {pending ? B.inviting : B.invite}
        </Button>
      </form>
      {state.link ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="backup_link" className="text-body-s">
            {B.linkLabel}
          </Label>
          <Input
            id="backup_link"
            readOnly
            value={state.link}
            onFocus={(e) => e.currentTarget.select()}
            aria-describedby="backup_link_hint"
            className="h-11 font-mono"
          />
          <p id="backup_link_hint" className="text-body-s text-muted-foreground">
            {B.linkHint}
          </p>
        </div>
      ) : (
        <FormStatus state={state} />
      )}
    </div>
  );
}

/* ─── Staff invitations (not a go-live task) ─────────────────────── */

function StepStaff({
  hospitalId,
  pendingInvitations,
}: {
  hospitalId: string;
  pendingInvitations: ReadonlyArray<{ id: string; email: string; invitedAtIso: string }>;
}) {
  const [state, action, pending] = useActionState<StepState, FormData>(inviteStaffAction, {});
  const T = CHECKLIST.staff;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-body-s text-muted-foreground">{T.lead}</p>
      <form action={action} className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <input type="hidden" name="hospital_id" value={hospitalId} />
        <div className="flex flex-1 flex-col gap-1">
          <Label htmlFor="staff_email" className="text-body-s">
            {T.email}
          </Label>
          <Input id="staff_email" name="email" type="email" required className="h-11" />
        </div>
        <Button type="submit" variant="secondary" size="md" className="min-h-11" disabled={pending}>
          {pending ? T.inviting : T.invite}
        </Button>
      </form>
      <FormStatus state={state} />
      {pendingInvitations.length > 0 ? (
        <ul className="flex flex-col gap-1 pt-2">
          {pendingInvitations.map((inv) => (
            <li
              key={inv.id}
              className="text-body-s text-muted-foreground flex items-center justify-between gap-3"
            >
              <span className="truncate font-mono">{inv.email}</span>
              <span className="text-caption shrink-0 font-mono">{formatDay(inv.invitedAtIso)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/* ─── Go live (calls sa-activate-hospital) ───────────────────────── */

function StepGoLive({ hospitalId, ready }: { hospitalId: string; ready: boolean }) {
  const [state, action, pending] = useActionState<StepState, FormData>(finaliseSetupAction, {});
  const G = CHECKLIST.goLive;
  return (
    <form action={action} className="mt-3 flex flex-col gap-3">
      <input type="hidden" name="hospital_id" value={hospitalId} />
      <p className="text-body-s text-muted-foreground">{G.lead}</p>
      <FormStatus state={state} />
      <div>
        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="min-h-11"
          disabled={!ready || pending}
        >
          {pending ? G.activating : G.activate}
        </Button>
      </div>
    </form>
  );
}

import type { Section } from "@patient-core/me-health";
import type { Loaded, loadOnFile, loadRecords } from "@/lib/patient-web/me-data";
import type { Place } from "@patient-core/me-places";
import type { ReportedItem } from "@/lib/patient/reported-history";
import Link from "next/link";
import { initials, SECTION_WORDS, splitHistory } from "@patient-core/me-health";
import { OFF_WORDS } from "@patient-core/me-places";
import { HOUSEHOLD_RELATIONSHIPS } from "@patient-core/me-profile";
import { ChevronRightIcon, HeartPulseIcon, LockIcon, PillIcon, TriangleAlertIcon, UsersIcon } from "lucide-react";

import { Avatar, EmptyState, ICON, Note, Pill, TextLink } from "@/components/tide/kit";
import { ME_COPY as C } from "@/content/patient/me";
import { ME_WEB_COPY as M } from "@/content/patient/me-web";
import { PATIENT_WEB_COPY as W } from "@/content/patient/web";
import { formatFullDate } from "@/lib/patient/booking-format";
import { RetryButton } from "../../_components/home-bits";
import { DetailsForm } from "../profile/_components/details-form";
import { HouseholdForm } from "../household/_components/household-form";
import { PlacesView } from "../places/_components/places-view";
import { HistoryEditorView } from "./history-editor";

/*
 * Me's sections (the owner's three-page redesign): the bodies the old sub-pages had (My conditions, Allergies,
 * Family history, Visit records, People I book for, My places, A few more details), now drawn inside Me's
 * pane. The page loads the data once; each body keeps its own honest empty and failed words.
 */

type History = Loaded<ReportedItem[]>;

/** My conditions, Allergies and Family history, one compact group each (ADR 0414), unconfirmed until a clinician
 * checks; a rail with the counts, the privacy notes said once, and medicines. */
export function HealthSection(p: {
  history: History;
  legacyConditions: string[];
  sex: string | null;
  medicinesSub: string;
}) {
  const h = splitHistory(p.history.status === "ready" ? p.history.value : []);
  const nkaId =
    p.history.status === "ready"
      ? (p.history.value.find((i) => i.kind === "no_known_allergies")?.id ?? null)
      : null;
  const groups: { section: Section; Icon: typeof HeartPulseIcon; cls: string; items: typeof h.conditions }[] = [
    { section: "conditions", Icon: HeartPulseIcon, cls: "text-pw-area-readings", items: h.conditions },
    { section: "allergies", Icon: TriangleAlertIcon, cls: "text-pw-area-medicines", items: h.allergies },
    { section: "family", Icon: UsersIcon, cls: "text-pw-area-team", items: h.family },
  ];
  return (
    <div className="grid items-start gap-5 min-[1101px]:grid-cols-[230px_minmax(0,1fr)]">
      <aside className="flex flex-col gap-3 max-[1100px]:order-2">
        <div className="rounded-pw-card bg-pw-surface-2 flex flex-col gap-1 p-2">
          <span className="text-pw-ink-3 px-2 pt-1 text-[12px] font-semibold">{M.inYourHealth}</span>
          {groups.map(({ section, Icon, cls, items }) => (
            <div key={section} className="flex items-center gap-2.5 rounded-xl px-2 py-1.5">
              <Icon className={`size-4 shrink-0 ${cls}`} {...ICON} />
              <span className="flex-1 text-[14px] font-semibold">{SECTION_WORDS[section].title}</span>
              <span className="text-[14px] font-bold tabular-nums">{items.length}</span>
            </div>
          ))}
        </div>
        <Link
          href="/patient/care/medicines"
          className="rounded-pw-card bg-pw-surface-2 hover:bg-pw-surface-3 flex items-center gap-3 p-3.5"
        >
          <PillIcon className="text-pw-area-medicines size-4 shrink-0" {...ICON} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-[14px] font-semibold">{C.medicines}</span>
            <span className="text-pw-ink-3 text-[12px]">{p.medicinesSub}</span>
          </span>
          <ChevronRightIcon className="text-pw-ink-3 size-4 shrink-0" {...ICON} />
        </Link>
        <p className="text-pw-ink-3 flex gap-2 text-[12px] leading-[17px]">
          <LockIcon className="mt-0.5 size-3.5 shrink-0" {...ICON} />
          {C.privateNote}
        </p>
        <p className="text-pw-ink-3 text-[12px] leading-[17px]">{W.whoSeesHistory}</p>
      </aside>
      <div className="flex min-w-0 flex-col gap-3">
        {groups.map(({ section, Icon, cls, items }) => (
          <HistoryEditorView
            key={section}
            section={section}
            items={items}
            noKnownAllergies={h.noKnownAllergies}
            nkaId={nkaId}
            status={p.history.status}
            legacy={section === "conditions" ? p.legacyConditions : []}
            sex={p.sex}
            whoSees={W.whoSeesHistory}
            compact={{ icon: <Icon className={`size-[18px] ${cls}`} {...ICON} />, hint: M.hints[section] }}
          />
        ))}
      </div>
    </div>
  );
}

/** Visit records (ADR 0342 §2): the summaries a clinician shared, newest first. */
export function RecordsSection(p: {
  records: Awaited<ReturnType<typeof loadRecords>> | null;
}) {
  return (
    <div className="flex flex-col gap-3">
      {!p.records ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-pw-ink-2 text-[17px]">{C.recordsFailed}</p>
          <RetryButton />
        </div>
      ) : !p.records.length ? (
        <EmptyState title={C.recordsEmpty} />
      ) : (
        <ul className="flex flex-col gap-2">
          {p.records.map((v) => (
            <li key={v.id}>
              <Link
                href={`/patient/me/records/${v.id}`}
                className="rounded-pw-row bg-pw-surface-2 hover:bg-pw-surface-3 flex items-center gap-3 p-4"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-[16px] font-semibold">{formatFullDate(v.startedAt)}</span>
                  <span className="text-pw-ink-2 text-[14px]">
                    {v.hospitalName}
                    {v.clinician ? ` · ${v.clinician}` : ""}
                  </span>
                  <span className="text-[14px]">{v.outcome}</span>
                  {v.updated ? <Pill className="mt-1 self-start">{C.updated}</Pill> : null}
                </span>
                <ChevronRightIcon className="text-pw-ink-3 size-5 shrink-0" {...ICON} />
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Note>{W.whoSeesRecords}</Note>
    </div>
  );
}

/** People I book for (PRD §2.9, ADR 0089): live booking agents, adults only (S19). */
export function PeopleSection(p: {
  members: { bookingAgentId: string; memberLabel: string; relationship: string }[] | null;
}) {
  if (p.members === null)
    return <EmptyState title={C.householdFailed} body={C.householdFailedHint} action={<RetryButton />} />;
  return (
    <div className="flex flex-col gap-4">
      {p.members.length === 0 ? (
        <p className="text-pw-ink-2 text-[17px]">{C.nobody}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {p.members.map((m) => (
            <li key={m.bookingAgentId} className="rounded-pw-row bg-pw-surface-2 flex items-center gap-3 p-3">
              <Avatar
                initials={initials(m.memberLabel)}
                label={m.memberLabel}
                className="bg-pw-place-tint text-pw-place-text"
              />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-[16px] font-semibold">{m.memberLabel}</span>
                <span className="text-pw-ink-2 text-[14px]">
                  {HOUSEHOLD_RELATIONSHIPS.find((r) => r.value === m.relationship)?.label ?? m.relationship}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-pw-ink-3 text-[13px]">{C.peopleNote}</p>
      <HouseholdForm />
    </div>
  );
}

/** My places (ADR 0402): a list, no map; a pin only from "Use my location" (L9). */
export function PlacesSection(p: { places: Loaded<Place[]> }) {
  return p.places.status === "off" ? (
    <Note>{OFF_WORDS}</Note>
  ) : p.places.status === "error" ? (
    <div className="flex flex-col items-start gap-2">
      <Note>{C.placesFailed}</Note>
      <RetryButton />
    </div>
  ) : (
    <PlacesView places={p.places.value} />
  );
}

/** A few more details: title, language, ID and next of kin through `/api/mobile/profile`; the hospital on its own page. */
export function DetailsSection(p: {
  onFile: Awaited<ReturnType<typeof loadOnFile>> | null;
  hospitalName: string | null;
}) {
  const hospital = (
    <section className="rounded-pw-row bg-pw-surface-2 flex flex-col gap-2 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[16px] font-semibold">{C.hospitalPart}</h3>
        {p.hospitalName ? <span className="text-pw-accent-text text-[13px] font-semibold">{C.added}</span> : null}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <p className="flex-1 text-[16px]">{p.hospitalName ?? C.notChosen}</p>
        <TextLink href="/patient/hospitals">{p.hospitalName ? C.changePick : C.choose}</TextLink>
      </div>
    </section>
  );
  return p.onFile?.ok ? (
    <DetailsForm onFile={p.onFile.onFile} hospital={hospital} />
  ) : (
    <div className="flex flex-col items-start gap-2">
      {hospital}
      <Note>{`${p.onFile && !p.onFile.ok ? p.onFile.message : C.detailsFailed} ${C.detailsLoadTail}`}</Note>
      <RetryButton />
    </div>
  );
}

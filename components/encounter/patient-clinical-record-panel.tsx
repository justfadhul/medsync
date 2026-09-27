import type { EncounterScope } from "@/lib/encounter/record";
import Link from "next/link";
import { AlertTriangleIcon, FileTextIcon, PillIcon, StethoscopeIcon } from "lucide-react";

import { encounterEngineLive } from "@/lib/encounter/feature";
import { loadPatientClinicalRecord } from "@/lib/encounter/record";

/**
 * Shared LONGITUDINAL patient clinical record (kickoff §4) — the thin surface the
 * doctor + nurse patient pages consume. Server component: authorises + loads +
 * writes audit-on-read via loadPatientClinicalRecord. Allergies are surfaced
 * first (safety). Honest states: gated (engine not live), no-access, empty.
 *
 * Read-only here; documentation entry + the per-encounter timeline land as their
 * own surfaces. No fabricated data — empty lists say so plainly.
 */
export async function PatientClinicalRecordPanel({
  scope,
  patientUserId,
  encounterHrefBase,
}: {
  scope: EncounterScope;
  patientUserId: string;
  /** If set (e.g. "/doctor/encounters"), encounter rows link to the per-encounter view. */
  encounterHrefBase?: string;
}) {
  // Gated until migration 0040 is applied (see lib/encounter/feature.ts).
  if (!encounterEngineLive()) {
    return (
      <Shell>
        <EmptyNote
          title="Clinical record"
          body="Activates with the clinical module — the encounter schema is applied at sign-off."
        />
      </Shell>
    );
  }

  const rec = await loadPatientClinicalRecord(patientUserId, scope);
  if (!rec.ok) {
    return (
      <Shell>
        <EmptyNote title="Clinical record" body={rec.error} />
      </Shell>
    );
  }

  const anaphylaxis = rec.allergies.some((a) => a.severity === "anaphylaxis");

  return (
    <Shell>
      {/* Allergies — surfaced first; unmissable. */}
      <section
        className={
          rec.allergies.length > 0
            ? "rounded-xl border border-amber-300/70 bg-amber-50 p-4 ring-1 ring-amber-200/60 dark:border-amber-800/50 dark:bg-amber-950/30 dark:ring-amber-800/30"
            : "border-border bg-card rounded-lg border p-4"
        }
      >
        <h3 className="inline-flex items-center gap-1.5 font-mono text-[10.5px] tracking-[0.14em] uppercase">
          <AlertTriangleIcon
            className={
              rec.allergies.length > 0
                ? "size-3.5 text-amber-600 dark:text-amber-400"
                : "text-muted-foreground size-3.5"
            }
            aria-hidden
          />
          Allergies {anaphylaxis ? "· anaphylaxis on file" : ""}
        </h3>
        {rec.allergies.length === 0 ? (
          <p className="text-muted-foreground mt-2 text-[12.5px]">None recorded.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1.5">
            {rec.allergies.map((a) => (
              <li key={a.id} className="flex items-baseline justify-between gap-3 text-[12.5px]">
                <span className="text-foreground font-medium">{a.substance}</span>
                <span className="text-muted-foreground text-right text-[11.5px]">
                  {[a.reaction, a.severity].filter(Boolean).join(" · ") || "—"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <ListCard
          title="Active problems"
          Icon={StethoscopeIcon}
          empty="No active problems."
          items={rec.problems.map((p) => ({
            key: p.id,
            primary: p.item,
            secondary: p.icd10Code ?? undefined,
          }))}
        />
        <ListCard
          title="Active medications"
          Icon={PillIcon}
          empty="No active medications."
          items={rec.medications.map((m) => ({
            key: m.id,
            primary: m.name,
            secondary: [m.dose, m.route, m.frequency].filter(Boolean).join(" · ") || undefined,
          }))}
        />
        <ListCard
          title="Recent diagnoses"
          Icon={FileTextIcon}
          empty="No diagnoses recorded."
          items={rec.diagnoses.map((d) => ({
            key: d.id,
            primary: d.text,
            secondary: [d.icd10Code, d.status, d.mustNotMiss ? "must-not-miss" : null]
              .filter(Boolean)
              .join(" · "),
          }))}
        />
        <ListCard
          title="Encounters"
          Icon={FileTextIcon}
          empty="No encounters yet."
          items={rec.encounters.map((e) => ({
            key: e.id,
            primary: `${e.encounterType} · ${e.state}`,
            secondary: [formatDate(e.startedAt), e.disposition].filter(Boolean).join(" · "),
            href: encounterHrefBase ? `${encounterHrefBase}/${e.id}` : undefined,
          }))}
        />
      </div>
    </Shell>
  );
}

/* ── presentational bits (match the patient-page card language) ── */

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <span className="text-muted-foreground inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.16em] uppercase">
        <span aria-hidden className="bg-iris-icon ring-iris-edge size-1 rounded-full ring-2" />
        Clinical record
      </span>
      {children}
    </section>
  );
}

function ListCard({
  title,
  Icon,
  items,
  empty,
}: {
  title: string;
  Icon: typeof PillIcon;
  items: { key: string; primary: string; secondary?: string; href?: string }[];
  empty: string;
}) {
  return (
    <div className="border-border bg-card flex flex-col gap-2 rounded-lg border p-4">
      <h3 className="text-muted-foreground inline-flex items-center gap-1.5 font-mono text-[10.5px] tracking-[0.14em] uppercase">
        <Icon className="size-3.5" aria-hidden />
        {title}
      </h3>
      {items.length === 0 ? (
        <p className="text-muted-foreground text-[12.5px]">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map((it) => {
            const body = (
              <>
                <span className="text-foreground text-[12.5px]">{it.primary}</span>
                {it.secondary ? (
                  <span className="text-muted-foreground text-caption">{it.secondary}</span>
                ) : null}
              </>
            );
            return (
              <li key={it.key} className="flex flex-col">
                {it.href ? (
                  <Link
                    href={it.href}
                    className="hover:bg-muted/30 -mx-1 flex flex-col rounded px-1"
                  >
                    {body}
                  </Link>
                ) : (
                  body
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function EmptyNote({ title, body }: { title: string; body: string }) {
  return (
    <div className="border-border bg-card/40 text-muted-foreground rounded-lg border border-dashed p-4">
      <span className="text-foreground/80 text-body-s font-medium">{title}</span>
      <p className="mt-1 text-[11.5px] leading-relaxed">{body}</p>
    </div>
  );
}

function formatDate(d: Date): string {
  // Stable, locale-independent (avoids hydration drift): YYYY-MM-DD.
  return new Date(d).toISOString().slice(0, 10);
}

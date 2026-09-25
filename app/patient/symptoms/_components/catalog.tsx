"use client";

import type { SubmissionResult } from "../actions";
import type { AudienceState } from "./audience-selector";
import type { SameDayState } from "./review-outcome";
import type { CatalogRenderMode } from "@/lib/emergency/feature";
import type {
  CatalogItem,
  CategoryKey,
  SubmissionAudience,
} from "@/supabase/functions/_shared/symptom-catalog/types";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { PatientPageHeader } from "@/app/patient/_components/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  clearPendingCatalogDraft,
  readPendingCatalogDraft,
  writePendingCatalogDraft,
} from "@/lib/patient/pending-symptoms";
import { cn } from "@/lib/utils";
import { CATALOG } from "@/supabase/functions/_shared/symptom-catalog/catalog.v0.1";
import {
  classify,
  dangerSigns,
  searchItems,
  t,
  visibleCategories,
  visibleItems,
} from "@/supabase/functions/_shared/symptom-catalog/classify";
import { MAX_SELECTED_ITEMS } from "@/supabase/functions/_shared/symptom-catalog/types";
import {
  emergencyEventAction,
  logZeroResultAction,
  requestSameDayAction,
  submitSymptomsAction,
} from "../actions";
import { AudienceSelector, toAudience } from "./audience-selector";
import { CategoryGrid } from "./category-grid";
import { CategoryPane, CategorySheet, emergencyFirst } from "./category-pane";
import { DangerStrip } from "./danger-strip";
import { EmergencyInterrupt } from "./emergency-interrupt";
import { ItemRow } from "./item-row";
import { ReviewOutcome } from "./review-outcome";
import { Search } from "./search";
import { SelectionTray } from "./selection-tray";
import { Watermark } from "./watermark";

/**
 * "What's wrong?" — the catalog as a pre-step to booking (PRD MS-PRD-SYM-001
 * §7.2; ADR 0098). One client component owns the state: who it is about,
 * the search, the items chosen, their qualifiers, and the tier — computed
 * here, offline, by the same `classify` the server runs on submit. Nothing
 * leaves the device until the patient picks a next step on S4.
 *
 *   S1  audience · search · danger strip · category grid · tray
 *   S2  a category's items — a right pane from md up, a bottom sheet below
 *   S3  an item's questions, inline under its row
 *   S4  review and outcome: the tier word, why, the catalog's sentence, one door
 *
 * An emergency item interrupts the moment it is chosen (§5.4) — see the
 * effect on the classification below, which is what opens the sheet; no
 * button does.
 */

/** S1's height budget at 360px wide (PRD §7.2), each zone's CSS pinned to it. */
export const S1_ZONES = {
  /** The workspace bar (`h-13`, layout.tsx). */
  appBar: 52,
  /** `min-h-11` segmented control. */
  audience: 44,
  /** `h-12` input. */
  search: 48,
  /** Two `h-12` rows + `gap-1` + the "All danger signs" line: a 44px target (`min-h-11 -my-3`) taking 20px of flow. */
  dangerStrip: 120,
  /** Four `h-17` rows + three `gap-2`. */
  categoryGrid: 296,
  /** `min-h-14` sticky bar, hidden until the first selection. */
  tray: 56,
  /** Four `gap-2` between the five zones. */
  gaps: 32,
} as const;

export const SKIP_ITEM_KEY = "SYM.NCD.ROUTINE_REVIEW";

const SUBMIT_FAILED =
  "We couldn't send this. Your choices are kept here — try again when you are connected.";

export interface CatalogProps {
  mode: Exclude<CatalogRenderMode, "off">;
  hospital: { id: string; name: string; emergencyPhone: string | null } | null;
  /** The profile's sex at birth is not male: show the pregnancy toggle for "Me" (PRD §6.1). */
  showPregnancyForMe: boolean;
  /** `?item=` — a danger-sign tile on the home lands here with the item chosen. */
  initialItem: string | null;
  /** `?list=danger` — the home's "All danger signs" link. */
  initialList: "danger" | null;
}

const subscribeNoop = () => () => {};
const WIDE = "(min-width: 768px)";
const subscribeWide = (cb: () => void) => {
  const mql = window.matchMedia(WIDE);
  mql.addEventListener("change", cb);
  return () => mql.removeEventListener("change", cb);
};

/** sessionStorage is client-only: mount the state machine once the client owns the tree. */
export function Catalog(props: CatalogProps) {
  const mounted = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
  if (!mounted) {
    return (
      <div className="flex flex-col gap-2" aria-busy>
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-30 w-full" />
        <Skeleton className="h-74 w-full" />
      </div>
    );
  }
  return <CatalogInner {...props} />;
}

type ListOpen = { kind: "category"; key: CategoryKey } | { kind: "danger" } | null;

function fromAudience(a: SubmissionAudience): AudienceState {
  if (a === "pregnant") return { who: "me", ageBand: "child_2m_5y", pregnant: true };
  if (a.startsWith("child_"))
    return { who: "child", ageBand: a as AudienceState["ageBand"], pregnant: false };
  return { who: "me", ageBand: "child_2m_5y", pregnant: false };
}

function CatalogInner({
  mode,
  hospital,
  showPregnancyForMe,
  initialItem,
  initialList,
}: CatalogProps) {
  const router = useRouter();
  const wide = useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(WIDE).matches,
    () => false,
  );

  // A draft left by a failed send or a reload; one already submitted is the
  // wizard's to consume, not ours to re-open.
  const [initial] = useState(() => {
    const d = readPendingCatalogDraft();
    const restore = d && !d.submissionId && d.catalogVersion === CATALOG.version ? d : null;
    const items = restore?.items ?? [];
    if (
      initialItem &&
      CATALOG.items.some((i) => i.key === initialItem) &&
      !items.includes(initialItem)
    ) {
      items.push(initialItem);
    }
    return {
      audience: restore ? fromAudience(restore.audience) : fromAudience("adult"),
      items,
      qualifiers: restore?.qualifiers ?? {},
      freeText: restore?.freeText ?? "",
    };
  });
  const [audience, setAudience] = useState<AudienceState>(initial.audience);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>(initial.items);
  const [qualifiers, setQualifiers] = useState<Record<string, Record<string, string>>>(
    initial.qualifiers,
  );
  const [freeText, setFreeText] = useState(initial.freeText);
  const [list, setList] = useState<ListOpen>(initialList === "danger" ? { kind: "danger" } : null);
  const [step, setStep] = useState<"pick" | "review">("pick");
  const [declined, setDeclined] = useState<string[]>([]);
  const [submission, setSubmission] = useState<SubmissionResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sameDay, setSameDay] = useState<SameDayState>({ status: "idle" });
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const aud = toAudience(audience);
  const byKey = useMemo(
    () => new Map<string, CatalogItem>(CATALOG.items.map((i) => [i.key, i])),
    [],
  );
  const visible = useMemo(() => visibleItems(CATALOG, aud), [aud]);
  const categories = useMemo(() => visibleCategories(CATALOG, aud), [aud]);
  const strip = useMemo(() => dangerSigns(CATALOG, aud), [aud]);
  const allDanger = useMemo(() => visible.filter((i) => i.tier === "E"), [visible]);
  const chosen = useMemo(
    () => selected.map((k) => byKey.get(k)).filter((i): i is CatalogItem => !!i),
    [selected, byKey],
  );
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const local = useMemo(
    () => classify({ audience: aud, items: selected, qualifiers }, CATALOG),
    [aud, selected, qualifiers],
  );
  const results = useMemo(() => searchItems(CATALOG, aud, query), [aud, query]);
  const searching = query.trim().length > 0;
  const skipItem = byKey.get(SKIP_ITEM_KEY);

  // The draft survives a reload and a failed send (PRD §7.6) — without a
  // submission id, so the wizard never reads it as a finished report.
  useEffect(() => {
    if (submission) return;
    if (selected.length === 0) {
      clearPendingCatalogDraft();
      return;
    }
    writePendingCatalogDraft({
      audience: aud,
      items: selected,
      qualifiers,
      freeText: freeText || null,
      catalogVersion: CATALOG.version,
    });
  }, [aud, selected, qualifiers, freeText, submission]);

  // PRD §5.4: the interrupt is DERIVED from the classification — an
  // emergency item chosen, a qualifier answered upward, a fever moved to a
  // baby under two months — never from Continue. It stays open until the
  // patient says the item is not happening now; a declined item stays
  // declined until it is removed and chosen again.
  const interrupt =
    local.tier === "E" ? (local.reasons.find((k) => !declined.includes(k)) ?? null) : null;

  // Zero-result terms, anonymised, after the patient has stopped typing (§7.4).
  useEffect(() => {
    const term = query.trim();
    if (term.length < 3 || results.length > 0) return;
    const id = setTimeout(() => void logZeroResultAction(term), 800);
    return () => clearTimeout(id);
  }, [query, results.length]);

  const invalidate = () => {
    setSubmission(null);
    setSameDay({ status: "idle" });
    setError(null);
    setIdempotencyKey(crypto.randomUUID());
  };

  const toggle = (key: string) => {
    invalidate();
    if (selectedSet.has(key)) {
      setSelected((s) => s.filter((k) => k !== key));
      setQualifiers(({ [key]: _gone, ...rest }) => rest);
      setDeclined((d) => d.filter((k) => k !== key));
    } else {
      // The report's cap (the server refuses more); the tray says so.
      setSelected((s) => (s.length >= MAX_SELECTED_ITEMS ? s : [...s, key]));
    }
  };
  const answer = (itemKey: string, q: string, o: string) => {
    invalidate();
    setQualifiers((all) => ({ ...all, [itemKey]: { ...all[itemKey], [q]: o } }));
  };
  const changeAudience = (next: AudienceState) => {
    invalidate();
    setAudience(next);
    // Items the new audience is never shown are dropped, not silently ignored.
    const keep = new Set(visibleItems(CATALOG, toAudience(next)).map((i) => i.key));
    setSelected((s) => s.filter((k) => keep.has(k)));
    setDeclined((d) => d.filter((k) => keep.has(k)));
  };
  const decline = (key: string) => setDeclined((d) => (d.includes(key) ? d : [...d, key]));
  const goReview = () => {
    setList(null);
    setStep("review");
    window.scrollTo({ top: 0 });
    // Continue unmounts with the tray: focus lands on the new page title
    // (the header's h1 renders on the next frame).
    requestAnimationFrame(() => {
      const h1 = document.querySelector<HTMLHeadingElement>("h1");
      if (h1) {
        h1.tabIndex = -1;
        h1.focus({ preventScroll: true });
      }
    });
  };

  const ensureSubmitted = async (): Promise<SubmissionResult | null> => {
    if (submission) return submission;
    setBusy(true);
    setError(null);
    try {
      const res = await submitSymptomsAction({
        audience: aud,
        items: selected,
        qualifiers,
        free_text: freeText || null,
      });
      if (!res.ok) {
        setError(SUBMIT_FAILED);
        return null;
      }
      // The decline happened before the report existed; link it now so the
      // report's outcome is honest and the same-day door opens (ruling 6).
      const lastDeclined = declined[declined.length - 1];
      if (res.submission.tier === "E" && lastDeclined) {
        const linked = await emergencyEventAction({
          event: "declined",
          item_key: lastDeclined,
          submission_id: res.submission.submission_id,
        });
        // The server refuses to book an E report that was never declined: a
        // failed link is a failed submit — nothing is kept, so the next
        // Continue submits (and links) again.
        if (!linked) {
          setError(SUBMIT_FAILED);
          return null;
        }
      }
      setSubmission(res.submission);
      writePendingCatalogDraft({
        audience: aud,
        items: selected,
        qualifiers,
        freeText: freeText || null,
        submissionId: res.submission.submission_id,
        tier: res.submission.tier,
        catalogVersion: res.submission.catalog_version,
      });
      return res.submission;
    } finally {
      setBusy(false);
    }
  };

  const onBook = async () => {
    const sub = await ensureSubmitted();
    if (sub) router.push("/patient/book");
  };
  const onSameDay = async () => {
    const sub = await ensureSubmitted();
    if (!sub) return;
    setSameDay({ status: "pending" });
    const res = await requestSameDayAction({
      submissionId: sub.submission_id,
      idempotencyKey,
    });
    if (res.ok) setSameDay({ status: "receipt", receipt: res.receipt });
    else if (res.noSlot) setSameDay({ status: "no_slot" });
    else setSameDay({ status: "error", error: res.error });
  };

  const pane =
    list?.kind === "category"
      ? {
          title: t(CATALOG, categories.find((c) => c.key === list.key)?.labelKey ?? "strip.title"),
          items: visible.filter((i) => i.category === list.key),
        }
      : list?.kind === "danger"
        ? { title: t(CATALOG, "strip.title"), items: allDanger }
        : null;
  const paneProps = pane
    ? {
        ...pane,
        selected: selectedSet,
        qualifiers,
        onToggle: toggle,
        onAnswer: answer,
        onClose: () => setList(null),
      }
    : null;
  const counts = chosen.reduce<Record<string, number>>((acc, i) => {
    acc[i.category] = (acc[i.category] ?? 0) + 1;
    return acc;
  }, {});

  const review = (
    <ReviewOutcome
      items={chosen}
      qualifiers={qualifiers}
      local={local}
      submission={submission}
      hospitalName={hospital?.name ?? null}
      emergencyPhone={hospital?.emergencyPhone ?? null}
      declinedKey={declined.length ? (declined[declined.length - 1] ?? null) : null}
      freeText={freeText}
      onFreeText={setFreeText}
      busy={busy}
      error={error}
      sameDay={sameDay}
      onBook={() => void onBook()}
      onSameDay={() => void onSameDay()}
      onChange={() => setStep("pick")}
    />
  );

  const s1 = (
    <div className="flex flex-col gap-2">
      <AudienceSelector
        value={audience}
        showPregnancyForMe={showPregnancyForMe}
        onChange={changeAudience}
      />
      <Search value={query} onChange={setQuery} />
      {searching ? (
        results.length > 0 ? (
          <ul className="flex flex-col gap-2" aria-label="Search results">
            {emergencyFirst(results).map((it) => (
              <ItemRow
                key={it.key}
                item={it}
                selected={selectedSet.has(it.key)}
                answers={qualifiers[it.key]}
                onToggle={() => toggle(it.key)}
                onAnswer={(q, o) => answer(it.key, q, o)}
              />
            ))}
          </ul>
        ) : (
          <div className="flex flex-col gap-3">
            <p role="status" className="text-foreground text-body-m leading-relaxed">
              We couldn&rsquo;t find that. Pick the closest area below, or tell the clinic in your
              own words at the end.
            </p>
            <DangerStrip
              items={strip}
              selected={selectedSet}
              allCount={allDanger.length}
              onToggle={toggle}
              onAll={() => setList({ kind: "danger" })}
            />
            <CategoryGrid
              categories={categories}
              counts={counts}
              onOpen={(key) => setList({ kind: "category", key })}
            />
          </div>
        )
      ) : (
        <>
          <DangerStrip
            items={strip}
            selected={selectedSet}
            allCount={allDanger.length}
            onToggle={toggle}
            onAll={() => setList({ kind: "danger" })}
          />
          <CategoryGrid
            categories={categories}
            counts={counts}
            onOpen={(key) => setList({ kind: "category", key })}
          />
        </>
      )}
      {skipItem ? (
        <Link
          href="/patient/book"
          onClick={() => clearPendingCatalogDraft()}
          className="text-body-s inline-flex min-h-11 w-fit items-center text-teal-700 underline-offset-4 hover:underline"
        >
          I&rsquo;m coming for a review or check-up — skip this
        </Link>
      ) : null}
    </div>
  );

  const sheetFooter =
    selected.length > 0 ? (
      <Button type="button" size="lg" className="w-full" onClick={goReview}>
        {selected.length} selected · Continue
      </Button>
    ) : null;

  return (
    <div className="flex flex-col gap-4">
      <PatientPageHeader
        eyebrow={hospital?.name ?? "MedSync"}
        title={step === "review" ? "What to do next" : "What's wrong?"}
        backHref={step === "review" ? undefined : "/patient"}
        backLabel="Home"
        description={
          step === "review"
            ? undefined
            : wide
              ? "Tell us what you feel or see. Pick an area, or search. This does not replace a clinician."
              : undefined
        }
      />
      {mode === "draft_watermarked" ? <Watermark /> : null}

      <div className="grid gap-6 md:grid-cols-2 md:items-start">
        {/* Below md the review replaces S1; from md up it is the right pane.
            From md up S1 stays put (sticky under the workspace bar) while the
            pane scrolls inside its own container. */}
        <div
          className={cn(
            step === "review" && !wide && "hidden",
            "md:sticky md:top-[calc(3.25rem+2rem)] md:self-start",
          )}
        >
          {s1}
        </div>
        {wide ? (
          <div className="min-w-0 md:sticky md:top-[calc(3.25rem+2rem)] md:self-start">
            {step === "review" ? (
              review
            ) : paneProps ? (
              <CategoryPane {...paneProps} />
            ) : (
              <p className="text-muted-foreground text-body-s rounded-xl border border-dashed p-6 text-center">
                Pick an area, or search. Everything you choose shows here.
              </p>
            )}
          </div>
        ) : step === "review" ? (
          <div className="min-w-0">{review}</div>
        ) : null}
      </div>

      {step === "pick" ? (
        <SelectionTray items={chosen} onRemove={toggle} onContinue={goReview} />
      ) : null}

      {!wide && paneProps ? (
        <CategorySheet {...paneProps} open={step === "pick"} footer={sheetFooter} />
      ) : null}

      <EmergencyInterrupt
        item={interrupt ? (byKey.get(interrupt) ?? null) : null}
        hospitalName={hospital?.name ?? null}
        emergencyPhone={hospital?.emergencyPhone ?? null}
        submissionId={submission?.submission_id ?? null}
        onDecline={decline}
      />
    </div>
  );
}

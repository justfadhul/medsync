"use client";

import type { SignupResult } from "@/lib/onboarding/account";
import type { DocumentKind } from "@/lib/onboarding/documents";
import type { OnboardingEvent } from "@/lib/onboarding/types";
import type { ReactNode } from "react";
import type { DefaultValues, FieldValues } from "react-hook-form";
import type * as z from "zod/mini";
import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckIcon, TriangleAlertIcon, WifiOffIcon } from "lucide-react";
import { FormProvider, get, useForm, useWatch } from "react-hook-form";

import { recordOnboardingEvent } from "@/app/signup/_actions/events";
import { SectionNumber } from "@/components/medsync/section-number";
import { Button } from "@/components/ui/button";
import { DOCUMENTS, KIT } from "@/content/onboarding";
import { cn } from "@/lib/utils";
import { DocumentsContext } from "./document-field";
import { uploadDocument } from "./document-upload";
import { fieldId } from "./fields";

/*
 * SectionedForm — one page, numbered sections, one button (ADR 0119, §5.1). Sections fill in any
 * order; the submit is never disabled: pressing it validates everything, and an amber summary at
 * the top links to each field. Fields autosave to sessionStorage (never passwords, NIN or files).
 * The submit carries an idempotency key, so a retry after a lost response can't double-create.
 */

export interface SectionDef {
  id: string;
  title: string;
  fields: readonly string[];
}

type SectionState = { kind: "done" } | { kind: "toGo"; n: number } | { kind: "notStarted" };
const SectionsContext = createContext<{
  defs: readonly SectionDef[];
  states: Record<string, SectionState>;
} | null>(null);

const newId = () => crypto.randomUUID();
const storage = {
  get: (k: string) => {
    try {
      return sessionStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      sessionStorage.setItem(k, v);
    } catch {
      /* private mode: the form still works, it just won't survive a reload */
    }
  },
  del: (k: string) => {
    try {
      sessionStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  },
};

export interface SectionedFormProps<T extends FieldValues> {
  form: OnboardingEvent["form"];
  /** The draft's own name, when two pages share a form's funnel events (sign-up and the desk claim). */
  draft?: string;
  schema: z.ZodMiniType<T>;
  defaults: DefaultValues<T>;
  sections: readonly SectionDef[];
  /** Never written to the draft. */
  secret?: readonly string[];
  submit: (input: T, key: string) => Promise<SignupResult>;
  submitLabel: string;
  pendingLabel: string;
  header: ReactNode;
  /** The consent block, after the last section. */
  consent: ReactNode;
  /** One line under the button: what happens next. */
  after?: ReactNode;
  /** Replaces the submit when the answers rule signup out (the under-18 guard). */
  blocker?: (values: T) => ReactNode | null;
  children: ReactNode;
}

function readDraft<T>(key: string): { key: string; values?: Partial<T> } {
  try {
    const d = JSON.parse(storage.get(key) ?? "{}") as { key?: string; values?: Partial<T> };
    return { key: d.key ?? newId(), values: d.values };
  } catch {
    return { key: newId() }; // a corrupt draft is dropped
  }
}

const SECRET_ALWAYS = [
  "password",
  "consent",
  "consentVersion",
  "consentSha",
  "smsVersion",
  "smsSha",
];

export function SectionedForm<T extends FieldValues>(props: SectionedFormProps<T>) {
  const { form: formName, schema, defaults, sections, submit } = props;
  const router = useRouter();
  const methods = useForm<T>({
    // zodResolver's generics trip over superRefine'd schemas; the schema is the form's own type.
    resolver: zodResolver(schema as never) as never,
    mode: "onTouched",
    defaultValues: defaults,
    shouldFocusError: false,
  });
  const { control, formState, handleSubmit, setError, reset } = methods;
  const values = useWatch({ control }) as T;

  const draftKey = `onboarding-v2:${props.draft ?? formName}`;
  const secret = useMemo(
    () => new Set([...SECRET_ALWAYS, ...(props.secret ?? [])]),
    [props.secret],
  );
  // The submit's idempotency key survives a reload with the draft (not rendered, so SSR "" is fine).
  const [submitKey] = useState(() =>
    typeof window === "undefined" ? "" : readDraft<T>(draftKey).key,
  );
  const [restored, setRestored] = useState(false);
  const tab = useRef({ id: "", start: 0, started: false });
  const [docs] = useState(() => new Map<DocumentKind, Blob>());

  // ── Draft: restore once after mount, then save as they type ──
  useEffect(() => {
    tab.current.id = storage.get("onboarding-v2:tab") ?? newId();
    storage.set("onboarding-v2:tab", tab.current.id);
    const { values: saved } = readDraft<T>(draftKey);
    if (saved && Object.keys(saved).length) {
      reset({ ...defaults, ...saved } as T, { keepDefaultValues: true });
      setRestored(true); // eslint-disable-line react-hooks/set-state-in-effect -- one-time restore after hydration
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
  }, []);

  useEffect(() => {
    if (!submitKey) return;
    const t = setTimeout(() => {
      const kept = Object.fromEntries(
        Object.entries(values ?? {}).filter(([k, v]) => !secret.has(k) && v !== "" && v != null),
      );
      storage.set(draftKey, JSON.stringify({ key: submitKey, values: kept }));
    }, 400);
    return () => clearTimeout(t);
  }, [values, submitKey, draftKey, secret]);

  // ── Funnel (EV-1: codes and keys only) ──
  const send = useCallback(
    (e: Omit<OnboardingEvent, "form" | "tabId" | "elapsedMs">) => {
      if (!tab.current.id) return;
      void recordOnboardingEvent({
        ...e,
        form: formName,
        tabId: tab.current.id,
        elapsedMs: tab.current.start ? Math.round(performance.now() - tab.current.start) : 0,
      }).catch(() => undefined);
    },
    [formName],
  );
  const onFirstFocus = () => {
    if (tab.current.started) return;
    tab.current.started = true;
    tab.current.start = performance.now();
    send({ event: "start" });
  };

  // ── Section states from the shared schema ──
  const issues = useMemo(() => {
    const r = schema.safeParse(values);
    return r.success ? new Set<string>() : new Set(r.error.issues.map((i) => String(i.path[0])));
  }, [schema, values]);
  const states = useMemo(() => {
    const out: Record<string, SectionState> = {};
    for (const s of sections) {
      const started = s.fields.some(
        (f) => get(formState.touchedFields, f) || get(formState.dirtyFields, f),
      );
      const open = s.fields.filter((f) => issues.has(f)).length;
      out[s.id] =
        open === 0 && started
          ? { kind: "done" }
          : started
            ? { kind: "toGo", n: open }
            : { kind: "notStarted" };
    }
    return out;
  }, [sections, issues, formState.touchedFields, formState.dirtyFields]);
  const doneReported = useRef(new Set<string>());
  useEffect(() => {
    for (const [id, st] of Object.entries(states))
      if (st.kind === "done" && !doneReported.current.has(id)) {
        doneReported.current.add(id);
        send({ event: "section_complete", section: id });
      }
  }, [states, send]);

  // ── Submit ──
  const [pending, setPending] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [showSummary, setShowSummary] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const [summaryTick, setSummaryTick] = useState(0);
  useEffect(() => {
    if (summaryTick) summaryRef.current?.focus(); // after the summary has rendered
  }, [summaryTick]);
  const sending = useRef(false);

  const onInvalid = () => {
    setShowSummary(true);
    send({ event: "submit_attempt" });
    for (const [k, err] of Object.entries(methods.formState.errors))
      send({
        event: "field_error",
        fieldKey: k,
        errorCode: String((err as { type?: string })?.type ?? "invalid")
          .replace(/[^a-z0-9_]/g, "_")
          .slice(0, 40),
      });
    setSummaryTick((t) => t + 1);
  };

  const onValid = async (data: T) => {
    if (sending.current) return;
    sending.current = true;
    setPending(props.pendingLabel);
    setOffline(false);
    setFormError(null);
    send({ event: "submit_attempt" });
    try {
      const result = await submit(data, submitKey);
      if (!result.ok) {
        for (const [k, message] of Object.entries(result.fieldErrors ?? {}))
          setError(k as never, { type: "server", message }, { shouldFocus: false });
        setFormError(result.formError ?? null);
        setShowSummary(true);
        setSummaryTick((t) => t + 1);
        return;
      }
      send({ event: "submit_ok" });
      for (const kind of result.uploads as DocumentKind[]) {
        const blob = docs.get(kind);
        if (!blob) continue;
        setPending(DOCUMENTS.uploading(kind.replace(/_/g, " ")));
        await uploadDocument(kind, blob).catch(() => false); // a failed upload stays "Still needed" (DOC-2)
      }
      storage.del(draftKey);
      router.replace(result.next);
    } catch {
      setOffline(true); // the network, not the answers: nothing is lost
    } finally {
      sending.current = false;
      setPending(null);
    }
  };
  // Built at event time, not during render (onValid reads refs).
  const doSubmit = (e?: React.BaseSyntheticEvent) => handleSubmit(onValid, onInvalid)(e);

  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!offline) return;
    const retry = () => formRef.current?.requestSubmit();
    window.addEventListener("online", retry, { once: true });
    return () => window.removeEventListener("online", retry);
  }, [offline]);

  const errorList = sections
    .flatMap((s) => s.fields)
    .map((f) => [f, get(formState.errors, f)?.message as string | undefined] as const)
    .filter(([, m]) => m && m !== "under_18");
  const blocked = props.blocker?.(values);

  return (
    <FormProvider {...methods}>
      <DocumentsContext.Provider value={docs}>
        <SectionsContext.Provider value={{ defs: sections, states }}>
          <div className="mx-auto w-full max-w-5xl px-4 pt-8 pb-28 sm:px-6 lg:grid lg:grid-cols-[12rem_minmax(0,40rem)] lg:gap-14 lg:pt-14">
            <ProgressRail />
            <div className="min-w-0">
              {props.header}
              <ProgressBar />
              {restored ? (
                <p
                  className="text-body-s text-muted-foreground mt-4 flex flex-wrap items-center gap-x-2 rounded-md bg-gray-50 px-3 py-2 dark:bg-gray-900"
                  role="status"
                >
                  {KIT.draftRestored}
                  <button
                    type="button"
                    className="font-medium text-teal-700 underline underline-offset-4 dark:text-teal-400"
                    onClick={() => {
                      storage.del(draftKey);
                      reset(defaults);
                      setRestored(false);
                    }}
                  >
                    {KIT.draftDismiss}
                  </button>
                </p>
              ) : null}
              <form
                ref={formRef}
                noValidate
                onSubmit={(e) => void doSubmit(e)}
                onFocus={onFirstFocus}
                onKeyDown={(e) => {
                  // Enter moves to the next field instead of submitting a half-filled form.
                  const t = e.target as HTMLElement;
                  if (
                    e.key !== "Enter" ||
                    t.tagName !== "INPUT" ||
                    (t as HTMLInputElement).type === "checkbox"
                  )
                    return;
                  e.preventDefault();
                  const all = [
                    ...e.currentTarget.querySelectorAll<HTMLElement>(
                      "input:not([type=hidden]):not([tabindex='-1']),select,button[type=submit]",
                    ),
                  ];
                  all[all.indexOf(t) + 1]?.focus();
                }}
                className="mt-8 flex flex-col gap-6"
              >
                {showSummary && (errorList.length > 0 || formError) ? (
                  <div
                    ref={summaryRef}
                    tabIndex={-1}
                    role="alert"
                    className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900 outline-none focus-visible:ring-2 focus-visible:ring-teal-500 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-100"
                  >
                    <p className="text-body-m flex items-center gap-2 font-medium">
                      <TriangleAlertIcon aria-hidden className="size-4 shrink-0" strokeWidth={2} />
                      {formError && errorList.length === 0
                        ? formError
                        : KIT.summaryTitle(errorList.length)}
                    </p>
                    {errorList.length > 0 ? (
                      <ul className="text-body-s mt-2 flex list-disc flex-col gap-1 pl-6">
                        {errorList.map(([f, m]) => (
                          <li key={f}>
                            <a
                              href={`#${fieldId(f)}`}
                              className="underline underline-offset-4"
                              onClick={(e) => {
                                e.preventDefault();
                                const el = document.getElementById(fieldId(f));
                                el?.closest("details")?.setAttribute("open", ""); // a folded field opens first
                                el?.scrollIntoView({ block: "center" });
                                el?.focus({ preventScroll: true });
                              }}
                            >
                              {m}
                            </a>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {formError && errorList.length > 0 ? (
                      <p className="text-body-s mt-2">{formError}</p>
                    ) : null}
                  </div>
                ) : null}

                {props.children}
                {props.consent}

                {offline ? (
                  <div
                    role="alert"
                    className="text-body-s flex flex-wrap items-center gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-100"
                  >
                    <WifiOffIcon aria-hidden className="size-4 shrink-0" />
                    <span className="flex-1">{KIT.offline}</span>
                    <Button type="submit" variant="secondary" size="sm">
                      {KIT.retry}
                    </Button>
                  </div>
                ) : null}

                {blocked ?? (
                  <div className="flex flex-col gap-3">
                    <Button
                      type="submit"
                      variant="primary"
                      size="lg"
                      className="tap w-full sm:w-auto sm:self-start"
                      aria-busy={!!pending}
                    >
                      {pending ? (
                        <>
                          <span
                            aria-hidden
                            className="size-3 shrink-0 rounded-full border-2 border-current/30 border-t-current motion-safe:animate-spin"
                          />
                          {pending}
                        </>
                      ) : (
                        props.submitLabel
                      )}
                    </Button>
                    {props.after ? (
                      <p className="text-body-s text-muted-foreground text-pretty">{props.after}</p>
                    ) : null}
                  </div>
                )}
              </form>
            </div>
          </div>
        </SectionsContext.Provider>
      </DocumentsContext.Provider>
    </FormProvider>
  );
}

function stateWord(s: SectionState | undefined) {
  if (!s || s.kind === "notStarted") return KIT.state.notStarted;
  return s.kind === "done" ? KIT.state.done : KIT.state.toGo(s.n);
}

/** Which section is in view (for the plum dot). */
function useInView(ids: readonly string[]) {
  const [current, setCurrent] = useState(ids[0]);
  useEffect(() => {
    const els = ids
      .map((id) => document.getElementById(`s-${id}`))
      .filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (hit) setCurrent(hit.target.id.slice(2));
      },
      { rootMargin: "-35% 0px -55% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [ids]);
  return current;
}

const scrollToSection = (id: string) =>
  document.getElementById(`s-${id}`)?.scrollIntoView({
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    block: "start",
  });

/** Desktop (≥ 1024 px): a sticky rail listing the sections, each with its state word. */
function ProgressRail() {
  const ctx = useContext(SectionsContext)!;
  const current = useInView(useMemo(() => ctx.defs.map((d) => d.id), [ctx.defs]));
  return (
    <nav aria-label={KIT.sectionsNav} className="hidden lg:block">
      <ol className="sticky top-28 flex flex-col gap-1">
        {ctx.defs.map((d, i) => {
          const st = ctx.states[d.id];
          const here = current === d.id;
          return (
            <li key={d.id}>
              <button
                type="button"
                onClick={() => scrollToSection(d.id)}
                aria-current={here ? "step" : undefined}
                className="group grid w-full grid-cols-[0.75rem_1fr] items-start gap-x-2 rounded-md px-2 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-900"
              >
                <span
                  aria-hidden
                  className={cn(
                    "mt-[7px] size-1.5 rounded-full transition-opacity duration-150",
                    here ? "bg-teal-icon opacity-100" : "opacity-0",
                  )}
                />
                <span className="flex flex-col">
                  <span
                    className={cn(
                      "text-body-s",
                      here ? "text-foreground font-medium" : "text-muted-foreground",
                    )}
                  >
                    <span className="font-mono tabular-nums">
                      [{String(i + 1).padStart(2, "0")}]
                    </span>{" "}
                    {d.title}
                  </span>
                  <span className="text-body-s text-muted-foreground flex items-center gap-1">
                    {st?.kind === "done" ? (
                      <CheckIcon
                        aria-hidden
                        className="text-foreground size-3.5"
                        strokeWidth={2.25}
                      />
                    ) : null}
                    {stateWord(st)}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Phone: a sticky bar under the header — "1 of 3 done", one segment per section. */
function ProgressBar() {
  const ctx = useContext(SectionsContext)!;
  const done = ctx.defs.filter((d) => ctx.states[d.id]?.kind === "done").length;
  return (
    <div className="glass border-border/60 sticky top-14 z-20 -mx-4 mt-6 border-b px-4 py-2.5 sm:-mx-6 sm:px-6 lg:hidden">
      <div className="flex items-center gap-3">
        <div className="flex flex-1 gap-1" aria-hidden>
          {ctx.defs.map((d) => (
            <span
              key={d.id}
              className={cn(
                "h-1 flex-1 rounded-full transition-colors duration-150",
                ctx.states[d.id]?.kind === "done"
                  ? "bg-foreground"
                  : "bg-gray-200 dark:bg-gray-700",
              )}
            />
          ))}
        </div>
        <span className="text-body-s text-muted-foreground tabular-nums" aria-live="polite">
          {KIT.progress(done, ctx.defs.length)}
        </span>
      </div>
    </div>
  );
}

/** One numbered card. Its title and state come from the section list the form was given. */
export function Section({ id, children }: { id: string; children: ReactNode }) {
  const ctx = useContext(SectionsContext)!;
  const index = ctx.defs.findIndex((d) => d.id === id);
  const def = ctx.defs[index]!;
  const st = ctx.states[id];
  return (
    <section
      id={`s-${id}`}
      aria-labelledby={`s-${id}-title`}
      className="border-border bg-card shadow-card scroll-mt-32 rounded-lg border p-5 sm:p-6 lg:scroll-mt-24"
    >
      <header className="mb-5 flex items-center gap-3">
        <SectionNumber n={index + 1} />
        <h2 id={`s-${id}-title`} className="text-heading-s text-foreground">
          {def.title}
        </h2>
        <span className="text-body-s text-muted-foreground ml-auto flex items-center gap-1 whitespace-nowrap">
          {st?.kind === "done" ? (
            <CheckIcon aria-hidden className="text-foreground size-3.5" strokeWidth={2.25} />
          ) : null}
          {stateWord(st)}
        </span>
      </header>
      <div className="flex flex-col gap-5">{children}</div>
    </section>
  );
}

/** Kicker, H1 and the "what you'll need" lead. */
export function FormHeader({
  kicker,
  title,
  lead,
  children,
}: {
  kicker: string;
  title: string;
  lead: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-3">
      <p className="text-overline text-muted-foreground font-mono uppercase">{kicker}</p>
      <h1 className="font-display text-display-s text-foreground text-balance">{title}</h1>
      <p className="text-body-l text-muted-foreground max-w-[52ch] text-pretty">{lead}</p>
      {children}
    </header>
  );
}

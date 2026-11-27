"use client";

/**
 * Triage on the clinic floor, as a centred pop-up (ADR 0531; it replaces the side panel). One screen: the level
 * and every score across the top, the vital signs on the left with the trend from earlier triages beside each
 * field, and one tabbed panel on the right (red flags, the NEWS2 map, the other scores, next steps, where they go).
 * The steps the panel had are all kept: the life-threat check with an explicit "None of these", the stop at
 * Level 1, the reason for changing a level, and the save through the floor's own port (so offline triage queues).
 * No vital-sign number is compared here: levels, tones, bands and trends come from lib/triage and
 * lib/clinic-floor/triage-view.
 */
import type { FloorCtx } from "./floor";
import type { Draft, Field } from "./shared";
import type { FloorPerson } from "@/lib/clinic-floor/fixture";
import type { Gcs, ScoreBand, Tone, Trend } from "@/lib/clinic-floor/triage-view";
import type { VitalKey } from "@/lib/triage/interpret";
import type { AcuityLevel, Acvpu, PregnancyStatus, TriageInput } from "@/lib/triage/types";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";

import { EditorDialog } from "@/components/medsync/editor-dialog";
import desk from "@/components/reception/desk.module.css";
import { c } from "@/components/reception/ui";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { FLOOR, FLOOR_ERRORS } from "@/content/clinic-floor/floor";
import { TD } from "@/content/clinic-floor/triage-dialog";
import { EU_RESUS } from "@/content/eu/words";
import { fill } from "@/content/lab-workspace-v2";
import {
  bandOf,
  doctorLoad,
  euResusChoices,
  GCS_MAX,
  gcsBand,
  gcsNote,
  gcsTotal,
  news2Chart,
  news2Classes,
  otherScores,
  TEMPERATURE_WORDS_CSO_SIGNED,
  temperatureWord,
  toneOfBands,
  trendOf,
} from "@/lib/clinic-floor/triage-view";
import { initials } from "@/lib/reception/desk/model";
import { ACUITY_TIERS } from "@/lib/triage/constants";
import { TRIAGE_DISCRIMINATORS } from "@/lib/triage/discriminators";
import { runTriage } from "@/lib/triage/engine";
import { interpretVitals } from "@/lib/triage/interpret";
import { recommend } from "@/lib/triage/recommend";
import { COLOUR_WORD } from "@/lib/workspace/words";
import {
  draftInput,
  first,
  hm,
  levelTxt,
  mins,
  NEEDED,
  num,
  THREAT_LABEL,
  THREATS,
  whoOf,
} from "./shared";
import t from "./triage-dialog.module.css";

const P = FLOOR.panel;
type Tab = "flags" | "news" | "other" | "next" | "send";
/** `eu`: the EU resus space chosen (D4), sent only at Level 1–2 and online. */
type D = Draft & { flags: string[]; gcs: Gcs; tab: Tab; eu: string | null };

// The draft temperature words show outside production until the CSO signs them; there the engine's own word stays.
const TEMP_WORDS = TEMPERATURE_WORDS_CSO_SIGNED || process.env.NODE_ENV !== "production";

const FIELDS: { f: Field; key: VitalKey; label: string; unit: string }[] = [
  { f: "rr", key: "respiratoryRate", label: P.vitals.rr[0], unit: P.vitals.rr[1] },
  { f: "spo2", key: "spo2", label: P.vitals.spo2[0], unit: P.vitals.spo2[1] },
  { f: "pulse", key: "pulse", label: P.vitals.pulse[0], unit: P.vitals.pulse[1] },
  { f: "sys", key: "systolicBp", label: TD.vitals.sys, unit: P.vitals.bp[3] },
  { f: "dia", key: "diastolicBp", label: TD.vitals.dia, unit: P.vitals.bp[3] },
  { f: "temp", key: "temperature", label: P.vitals.temp[0], unit: P.vitals.temp[1] },
  { f: "sugar", key: "bloodGlucose", label: P.vitals.sugar[0], unit: P.vitals.sugar[1] },
];

const TONE: Record<string, string | undefined> = {
  ok: t.ok,
  warn: t.warn,
  bad: t.bad,
  mild: t.mild,
};
const VTONE: Record<string, string> = {
  normal: "ok",
  borderline: "mild",
  abnormal: "warn",
  critical: "bad",
};
const RANK = ["ok", "mild", "warn", "bad"];
const worse = (a: string, b: string) => (RANK.indexOf(a) >= RANK.indexOf(b) ? a : b);
const popOf = (ruleset: string) =>
  ruleset === "paediatric_pews"
    ? "paediatric"
    : ruleset === "obstetric_meows"
      ? "obstetric"
      : "adult";
/** A vital-sign field takes digits and one decimal point, nothing else. */
const numeric = (x: string) =>
  x
    .replace(",", ".")
    .replace(/[^\d.]/g, "")
    .replace(/(\..*)\./g, "$1")
    .slice(0, 6);
const fix2 = (n: number | null) => (n == null ? "—" : n.toFixed(2));
const whole = (n: number | null) => (n == null ? "—" : String(Math.round(n)));

function Flag() {
  return (
    <svg className={t.fl} viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <path
        d="M3.5 1.5v13"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        className={t.flFill}
        d="M3.5 2.5h9l-2.2 3 2.2 3h-9z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** What the sign was at the last triage, in plain words beside its field. */
function Was({ tr }: { tr: Trend | null }) {
  return tr ? <span className={t.tr}>{fill(TD.vitals.was, { v: tr.last })}</span> : null;
}

function Scale({ bands }: { bands: readonly ScoreBand[] }) {
  return (
    <div className={t.scale}>
      {bands.map((b) => (
        <span key={b.word} className={b.on ? `${t.on} ${TONE[b.tone]}` : undefined}>
          <small>{b.cut}</small>
          {TD.words[b.word]}
        </span>
      ))}
    </div>
  );
}

export function TriageDialog({ ctx, p, re }: { ctx: FloorCtx; p: FloorPerson; re: boolean }) {
  const [d, setD] = useState<D>(() => ({
    threats: [],
    none: false,
    v: {},
    avpu: "A",
    o2: false,
    // Owner ruling 15 Nov 2026: F or unknown sex starts at "unknown"; a re-check carries the last answer forward.
    preg: (re && p.triage?.input.context.pregnancy) || "unknown",
    scale2: re && p.triage?.input.context.spo2Scale2Enabled === true,
    sugar: true,
    pick: null,
    why: "",
    clinic: p.clinic,
    doc: p.doctorId,
    note: "",
    flags: [],
    gcs: { e: null, v: null, m: null },
    tab: "flags",
    eu: null,
  }));
  const [busy, setBusy] = useState(false);
  const set = (x: Partial<D>) => setD((o) => ({ ...o, ...x }));
  const close = () => ctx.setSel(null);

  // Earlier triages this visit, oldest first: the trend's history and the engine's prior level.
  const prior = useMemo(
    () =>
      p.triage
        ? [
            ...(p.triage.earlier ?? []),
            { input: p.triage.input, level: p.triage.level, at: p.triage.at },
          ]
        : [],
    [p.triage],
  );
  const last = prior[prior.length - 1] ?? null;

  const input: TriageInput = useMemo(
    () => ({
      ...draftInput(p, d),
      presentDiscriminators: d.flags,
      adjustments: { priorLevel: last?.level ?? null },
    }),
    [p, d, last],
  );
  const missing = NEEDED.filter(([, fs]) => fs.some((f) => num(d.v[f]) == null)).map(
    ([k]) => P.missing[k],
  );
  const threat = d.threats.length > 0;
  const ready = threat || missing.length === 0;
  // Shown live as the nurse types (the engine marks it provisional); saved only once the needed signs are in.
  const live = useMemo(() => runTriage(input), [input]);
  const result = ready ? live : null;
  const iv = useMemo(() => interpretVitals(input.vitals, live), [input, live]);
  const recs = recommend(live, d.pick ?? undefined);
  const scores = otherScores(live, input.vitals);
  const engine = result?.level ?? null;
  const level = (d.pick ?? engine) as AcuityLevel | null;
  const changed = d.pick != null && d.pick !== engine;
  const isL1 = live.level === 1 || level === 1;
  const clinic = ctx.clinicOf(d.clinic);
  const checked = threat || d.none;
  const still = [
    ...(!checked ? [P.missingThreat] : []),
    ...(threat ? [] : missing),
    ...(changed && !d.why ? [P.missingWhy] : []),
  ];
  const off = busy || !result || isL1 || still.length > 0;
  const shown = live.level;
  const tier = ACUITY_TIERS.find((x) => x.level === shown)!;
  const oxygen = d.o2 ? "oxygen" : "air";
  const resus = ctx.user.role === "doctor" ? "/doctor/resus" : "/nurse/resus";
  const euSpaces = euResusChoices(level, ctx.data.euResus);
  // Online only (it is not queued, ADR 0497) and only a space still offered at this level.
  const euBed = (!ctx.offline && euSpaces.find((x) => x.bedId === d.eu)) || null;

  const send = async () => {
    if (off || !result || !level) return;
    setBusy(true);
    const note = [d.note.trim(), gcsNote(d.gcs)].filter(Boolean).join(" · ").slice(0, 280);
    const payload = {
      intake_id: p.id,
      patient_user_id: p.patientUserId,
      age_years: p.age,
      pregnancy: input.context.pregnancy,
      reproductive_age_female: input.context.reproductiveAgeFemale,
      spo2_scale2_enabled: input.context.spo2Scale2Enabled,
      vitals: input.vitals,
      life_threat_flags: input.lifeThreatFlags,
      present_discriminators: d.flags,
      prior_level: last?.level ?? null,
      assigned_level: level,
      override_reason: changed ? d.why : undefined,
    };
    const res = await ctx.port.triage(payload, {
      clientId: crypto.randomUUID(),
      intakeId: p.id,
      recheck: re,
      departmentId: d.clinic,
      doctorUserId: d.doc,
      note: note || null,
      euBedId: euBed?.bedId ?? null,
    });
    setBusy(false);
    if (!res.ok) return ctx.say(res.error ?? FLOOR_ERRORS.saveFailed);
    const band =
      res.recheck ??
      recommend(result, level).find((r) => r.code === "monitor_interval")?.recheck ??
      null;
    const before = last?.level ?? null;
    ctx.setPeople((ps) =>
      ps.map((x) =>
        x.id !== p.id
          ? x
          : {
              ...x,
              clinic: d.clinic,
              doctorId: d.doc,
              triage: {
                input,
                level,
                at: ctx.now,
                by: first(ctx.user.name),
                note: note || (re ? (x.triage?.note ?? "") : ""),
                recheck: band,
                earlier: prior,
              },
            },
      ),
    );
    close();
    // The triage is saved; a send to EU resus that was refused says why.
    if (res.error) ctx.say(res.error);
    else if (euBed) ctx.say(EU_RESUS.sent(euBed.wardName, euBed.label));
    else if (!re)
      ctx.say(fill(P.sent, { name: p.name, clinic: clinic.short, level: levelTxt(level) }));
    else if (before != null && level < before)
      ctx.say(fill(P.movedUp, { name: p.name, level: levelTxt(level) }));
    else if (before != null && level > before)
      ctx.say(fill(P.movedDown, { name: p.name, level: levelTxt(level) }));
    else ctx.say(fill(P.rechecked, { level: levelTxt(level) }));
  };

  /* ─── the result band ─── */
  const n = live.news2;
  const tile = (label: string, value: ReactNode, sub: string, tone: Tone | null) => (
    <div className={`${t.m} ${tone ? TONE[tone] : ""}`}>
      <span className={t.cap}>{label}</span>
      <b>{value}</b>
      <small>{sub}</small>
    </div>
  );
  const on = (bands: readonly ScoreBand[]) => bands.find((b) => b.on);
  const lastNews = last ? runTriage(last.input).news2?.total : null;
  const band = (
    <div className={`${t.box} ${t.band} ${t[`b${shown}`]}`}>
      <div className={`${t.lvb} ${t[`l${shown}`]}`}>
        <b>L{shown}</b>
        <span>{COLOUR_WORD[shown]}</span>
      </div>
      <div className={t.lvt}>
        <b>{isL1 ? TD.band.emergency : tier.meaning}</b>
        <span className={t.sub}>
          {isL1 ? fill(P.l1Title, { level: levelTxt(1) }) : live.disposition}
          {isL1 ? null : (
            <>
              {" · "}
              {TD.band.within} <b>{fill(TD.band.min, { n: tier.targetMinutes })}</b>
            </>
          )}
        </span>
        <span className={t.ladder} aria-label={fill(TD.band.ladder, { n: shown })}>
          {([1, 2, 3, 4, 5] as const).map((l) => (
            <i key={l} className={l === shown ? `${t.on} ${t[`l${l}`]}` : undefined}>
              {l}
            </i>
          ))}
          {live.provisional && !isL1 ? <em>{TD.band.provisional}</em> : null}
          {isL1 ? (
            <a className={c("btn", "sm", "r")} href={resus}>
              {P.openResus}
            </a>
          ) : null}
        </span>
        {last ? (
          <span
            className={`${t.was} ${result && shown < last.level ? t.bad : result && shown > last.level ? t.ok : ""}`}
          >
            {fill(TD.band.was, {
              level: `L${last.level}`,
              news: lastNews ?? "—",
              ago: mins(ctx.now - last.at),
            })}
            {result
              ? ` · ${shown < last.level ? TD.band.more : shown > last.level ? TD.band.less : TD.band.same}`
              : ""}
            {live.trendEscalated ? ` · ${TD.band.trend}` : ""}
          </span>
        ) : null}
      </div>
      <div className={t.mg}>
        {tile(
          TD.tiles.news2,
          n ? n.total : "—",
          !n
            ? TD.tiles.adultOnly
            : n.provisional
              ? TD.tiles.provisional
              : n.hasSingleParameterThree
                ? TD.tiles.oneAtThree
                : TD.tiles.allIn,
          n ? toneOfNews(n.total, n.hasSingleParameterThree) : null,
        )}
        {tile(
          TD.tiles.shockIndex,
          fix2(scores.shockIndex.value),
          on(scores.shockIndex.bands)
            ? TD.words[on(scores.shockIndex.bands)!.word]
            : TD.tiles.needsPulseBp,
          toneOfBands(scores.shockIndex.bands),
        )}
        {tile(
          TD.tiles.qsofa,
          scores.qsofa.score == null ? "—" : `${scores.qsofa.score}/3`,
          scores.qsofa.score == null
            ? TD.tiles.needsVitals
            : scores.qsofa.positive
              ? TD.tiles.positive
              : TD.tiles.notPositive,
          scores.qsofa.score == null ? null : scores.qsofa.positive ? "bad" : "ok",
        )}
        {tile(
          TD.tiles.map,
          whole(scores.map.value),
          scores.map.value == null ? TD.tiles.needsBp : TD.tiles.mmHg,
          null,
        )}
        {tile(
          TD.tiles.pulsePressure,
          whole(scores.pulsePressure.value),
          on(scores.pulsePressure.bands)
            ? TD.words[on(scores.pulsePressure.bands)!.word]
            : TD.tiles.needsBp,
          toneOfBands(scores.pulsePressure.bands),
        )}
        {tile(
          TD.tiles.modifiedShockIndex,
          fix2(scores.modifiedShockIndex.value),
          on(scores.modifiedShockIndex.bands)
            ? TD.words[on(scores.modifiedShockIndex.bands)!.word]
            : TD.tiles.needsPulseBp,
          toneOfBands(scores.modifiedShockIndex.bands),
        )}
        {tile(
          TD.tiles.glucose,
          scores.glucose.value ?? "—",
          on(scores.glucose.bands)
            ? TD.words[on(scores.glucose.bands)!.word]
            : TD.tiles.notRecorded,
          toneOfBands(scores.glucose.bands),
        )}
      </div>
    </div>
  );

  /* ─── vital signs, with the trend beside each field ─── */
  const vitalTile = ({ f, key, label, unit }: (typeof FIELDS)[number]) => {
    const raw = d.v[f] ?? "";
    const val = num(raw);
    const i = iv[key];
    const tw = key === "temperature" && val != null && TEMP_WORDS ? temperatureWord(val) : null;
    const tone =
      val == null ? "" : tw ? worse(tw.tone, VTONE[i.tone] ?? "ok") : (VTONE[i.tone] ?? "");
    const word = tw
      ? TD.temp[tw.word] + (i.points ? ` · ${fill(TD.temp.news, { n: i.points })}` : "")
      : i.label;
    const tr = trendOf(
      key as keyof TriageInput["vitals"],
      prior.map((x) => x.input.vitals[key as keyof TriageInput["vitals"]] as number | null),
      val,
      { scale2: d.scale2, oxygen },
    );
    return (
      <label key={f} className={`${t.v} ${tone ? TONE[tone] : ""} ${val == null ? "" : t.set}`}>
        <span className={t.vh}>
          <span className={t.cap}>
            {label} <span className={t.unit}>{unit}</span>
          </span>
          <Was tr={tr} />
        </span>
        <span className={t.vi}>
          <input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder="—"
            value={raw}
            onChange={(e) => set({ v: { ...d.v, [f]: numeric(e.target.value) } })}
            aria-label={label}
          />
        </span>
        <small>{val == null ? TD.vitals.notRecorded : word}</small>
      </label>
    );
  };
  const total = gcsTotal(d.gcs);
  const gband = total == null ? null : gcsBand(total);
  const vitals = (
    <div className={t.box}>
      <div className={t.bh}>
        <span className={t.cap}>
          {last
            ? fill(TD.vitals.recheck, { n: prior.length + 1, ago: mins(ctx.now - last.at) })
            : TD.vitals.cap}
        </span>
        <label className={t.tog} title={P.scale2Title}>
          <input type="checkbox" checked={d.scale2} onChange={() => set({ scale2: !d.scale2 })} />
          {P.scale2}
        </label>
      </div>
      <div className={t.vg}>
        {FIELDS.map(vitalTile)}
        <label className={`${t.v} ${d.o2 ? TONE.warn : ""}`}>
          <span className={t.cap}>{TD.vitals.air}</span>
          <select value={oxygen} onChange={(e) => set({ o2: e.target.value === "oxygen" })}>
            <option value="air">{TD.vitals.roomAir}</option>
            <option value="oxygen">{TD.vitals.onOxygen}</option>
          </select>
          <small>{iv.oxygen.label}</small>
        </label>
        <label className={`${t.v} ${TONE[VTONE[iv.consciousness.tone] ?? ""] ?? ""} ${t.set}`}>
          <span className={t.cap}>{P.consciousness}</span>
          <select value={d.avpu} onChange={(e) => set({ avpu: e.target.value as Acvpu })}>
            {(Object.keys(P.acvpu) as Acvpu[]).map((k) => (
              <option key={k} value={k}>
                {P.acvpu[k]}
              </option>
            ))}
          </select>
          <small>{iv.consciousness.label}</small>
        </label>
        <div
          className={`${t.v} ${t.gcs} ${gband === "severe" ? TONE.bad : gband === "moderate" ? TONE.warn : ""}`}
        >
          <span className={t.cap}>{TD.gcs.cap}</span>
          <span className={t.gr}>
            {(["e", "v", "m"] as const).map((k) => {
              const [name, letter, words] = TD.gcs.parts[k];
              return (
                <GcsPart
                  key={k}
                  name={name}
                  letter={letter}
                  words={words}
                  max={GCS_MAX[k]}
                  value={d.gcs[k]}
                  onPick={(x) => set({ gcs: { ...d.gcs, [k]: x } })}
                />
              );
            })}
            <b>
              {total ?? "—"}
              <span className={t.sub}>{TD.gcs.of}</span>
            </b>
          </span>
          <small>{gband ? TD.gcs.bands[gband] : TD.gcs.pick}</small>
        </div>
        {p.sex !== "M" ? (
          <label className={t.v}>
            <span className={t.cap}>{P.pregnancy}</span>
            <select
              value={d.preg}
              onChange={(e) => set({ preg: e.target.value as PregnancyStatus })}
            >
              {(Object.keys(P.pregnancyOpts) as PregnancyStatus[]).map((k) => (
                <option key={k} value={k}>
                  {P.pregnancyOpts[k]}
                </option>
              ))}
            </select>
            <small />
          </label>
        ) : null}
      </div>
    </div>
  );

  /* ─── the right-hand panel ─── */
  const others = TRIAGE_DISCRIMINATORS.filter(
    (x) =>
      x.source === "manual" &&
      !x.lifeThreat &&
      (x.appliesTo === "all" || x.appliesTo === popOf(live.ruleset)),
  );
  const raised = d.threats.length + d.flags.length;
  const flagChip = (key: string, label: string, lvl: number, on: boolean, flip: () => void) => (
    <button key={key} type="button" className={t.chip} aria-pressed={on} onClick={flip}>
      <Flag />
      <span className={t.grow}>{label}</span>
      <span className={t.pt}>L{lvl}</span>
    </button>
  );
  const flagsTab = (
    <>
      <p className={t.ask}>{P.s1Ask}</p>
      <div className={t.chips}>
        {THREATS.map(([code, key]) =>
          flagChip(code, THREAT_LABEL.get(code) ?? code, 1, d.threats.includes(key), () =>
            set({
              none: false,
              threats: d.threats.includes(key)
                ? d.threats.filter((x) => x !== key)
                : [...d.threats, key],
            }),
          ),
        )}
        {others.map((x) =>
          flagChip(x.code, x.label, x.minAcuity, d.flags.includes(x.code), () =>
            set({
              none: false,
              flags: d.flags.includes(x.code)
                ? d.flags.filter((y) => y !== x.code)
                : [...d.flags, x.code],
            }),
          ),
        )}
        <button
          type="button"
          className={`${t.chip} ${t.none}`}
          aria-pressed={d.none}
          onClick={() => set({ none: !d.none, threats: [], flags: [] })}
        >
          {P.none}
        </button>
      </div>
    </>
  );

  const newsTab = () => {
    if (!n) return <p className={t.sub}>{TD.chart.notAdult}</p>;
    const pts = (par: string) => n.parameters.find((q) => q.parameter === par)?.points ?? 0;
    const PAR = {
      respiratoryRate: "respiratory_rate",
      spo2: "spo2",
      systolicBp: "systolic_bp",
      pulse: "pulse",
      temperature: "temperature",
    } as const;
    const cell = (key: string, label: string, points: number, hit: boolean) => (
      <td key={key} className={hit ? `${t.on} ${t[`p${points}`]}` : undefined}>
        {label}
      </td>
    );
    const score = (points: number, recorded: boolean) => (
      <td className={`${t.sc} ${recorded && points ? `${t.on} ${t[`p${points}`]}` : ""}`}>
        {recorded ? (points ? `+${points}` : "0") : "—"}
      </td>
    );
    const blank = (i: number) => <td key={i} className={t.nil} />;
    const alert = d.avpu === "A";
    return (
      <>
        <div className={t.ntot}>
          <span>
            <span className={t.cap}>{TD.chart.total}</span>
            <b>{n.total}</b>
          </span>
          <span className={t.ncls}>
            {news2Classes(n.total, n.hasSingleParameterThree).map((x) => (
              <span key={x.key} className={x.on ? `${t.on} ${t[`l${x.level}`]}` : undefined}>
                {TD.chart.classes[x.key]}
                <small>
                  L{x.level}
                  {x.key === "single3" ? TD.chart.orMore : ""}
                </small>
              </span>
            ))}
          </span>
        </div>
        <table className={t.nt}>
          <thead>
            <tr>
              <th />
              {[3, 2, 1, 0, 1, 2, 3].map((x, i) => (
                <th key={i}>{x}</th>
              ))}
              <th>{TD.chart.score}</th>
            </tr>
          </thead>
          <tbody>
            {news2Chart(d.scale2, oxygen).map((row) => {
              const val = input.vitals[row.key];
              const mine = val == null ? null : bandOf(row.bands, val);
              return (
                <tr key={row.key}>
                  <th scope="row">{TD.chart.signs[row.key]}</th>
                  {row.cells.map((x, i) =>
                    x ? cell(String(i), x.label, x.points, mine?.from === x.from) : blank(i),
                  )}
                  {score(pts(PAR[row.key]), val != null)}
                </tr>
              );
            })}
            <tr>
              <th scope="row">{TD.chart.signs.oxygen}</th>
              {[0, 1, 2].map(blank)}
              {cell("air", TD.chart.air, 0, !d.o2)}
              {blank(4)}
              {cell("o2", TD.chart.oxygen, 2, d.o2)}
              {blank(6)}
              {score(pts("supplemental_oxygen"), true)}
            </tr>
            <tr>
              <th scope="row">{TD.chart.signs.mind}</th>
              {[0, 1, 2].map(blank)}
              {cell("a", TD.chart.alert, 0, alert)}
              {[4, 5].map(blank)}
              {cell("cvpu", TD.chart.cvpu, 3, !alert)}
              {score(pts("consciousness"), true)}
            </tr>
          </tbody>
        </table>
        {n.missing.length ? (
          <p className={`${t.sub} ${t.warn}`}>
            {fill(TD.chart.notRecorded, { list: n.missing.join(", ").replace(/_/g, " ") })}
          </p>
        ) : null}
        <p className={t.sub}>{TD.chart.legend}</p>
      </>
    );
  };

  const card = (
    span: number,
    name: string,
    value: ReactNode,
    how: ReactNode,
    tone: Tone | null,
    scale: ReactNode,
  ) => (
    <div className={`${t.sc2} ${tone ? TONE[tone] : ""}`} style={{ gridColumn: `span ${span}` }}>
      <div className={t.sch}>
        <span className={t.cap}>{name}</span>
        <b>{value}</b>
      </div>
      <div className={t.how}>{how}</div>
      {scale}
    </div>
  );
  const need = (x: string) => <span className={t.needs}>{x}</span>;
  const vv = input.vitals;
  const q = scores.qsofa;
  const crit = (label: string, met: boolean, value: ReactNode) => (
    <span className={value == null ? undefined : `${t.on} ${TONE[met ? "bad" : "ok"]}`}>
      {label}
      <small>
        {value == null ? (
          TD.other.notRecorded
        ) : (
          <>
            {value} · {met ? TD.other.met : TD.other.notMet}
          </>
        )}
      </small>
    </span>
  );
  const otherTab = (
    <>
      <div className={t.sgrid}>
        {card(
          3,
          TD.tiles.shockIndex,
          fix2(scores.shockIndex.value),
          scores.shockIndex.value == null
            ? need(TD.other.needSi)
            : fill(TD.other.si, { a: vv.pulse ?? "", b: vv.systolicBp ?? "" }),
          toneOfBands(scores.shockIndex.bands),
          <Scale bands={scores.shockIndex.bands} />,
        )}
        {card(
          3,
          TD.tiles.modifiedShockIndex,
          fix2(scores.modifiedShockIndex.value),
          scores.modifiedShockIndex.value == null
            ? need(TD.other.needMsi)
            : fill(TD.other.msi, { a: vv.pulse ?? "", b: whole(scores.map.value) }),
          toneOfBands(scores.modifiedShockIndex.bands),
          <Scale bands={scores.modifiedShockIndex.bands} />,
        )}
        {card(
          6,
          TD.tiles.qsofa,
          q.score == null ? "—" : `${q.score} / 3`,
          fill(TD.other.qsofa, { n: q.positiveAt }),
          q.score == null ? null : q.positive ? "bad" : "ok",
          <div className={t.scale}>
            {crit(
              fill(TD.other.qRr, { cut: q.criteria[0]!.cut }),
              q.criteria[0]!.met,
              vv.respiratoryRate,
            )}
            {crit(
              fill(TD.other.qSbp, { cut: q.criteria[1]!.cut }),
              q.criteria[1]!.met,
              vv.systolicBp,
            )}
            {crit(TD.other.qMind, q.criteria[2]!.met, P.acvpu[d.avpu])}
          </div>,
        )}
        {card(
          2,
          TD.tiles.map,
          whole(scores.map.value),
          scores.map.value == null
            ? need(TD.other.needBp)
            : fill(TD.other.map, { s: vv.systolicBp ?? "", d: vv.diastolicBp ?? "" }),
          null,
          null,
        )}
        {card(
          2,
          TD.tiles.pulsePressure,
          whole(scores.pulsePressure.value),
          scores.pulsePressure.value == null
            ? need(TD.other.needBp)
            : fill(TD.other.pp, { s: vv.systolicBp ?? "", d: vv.diastolicBp ?? "" }),
          toneOfBands(scores.pulsePressure.bands),
          <Scale bands={scores.pulsePressure.bands} />,
        )}
        {card(
          2,
          TD.tiles.glucose,
          scores.glucose.value ?? "—",
          scores.glucose.value == null ? need(TD.other.needGlu) : TD.other.glu,
          toneOfBands(scores.glucose.bands),
          <Scale bands={scores.glucose.bands} />,
        )}
      </div>
      <p className={t.sub}>
        {fill(TD.other.foot, { p: scores.pulsePressure.narrowPercent, g: scores.glucose.dkaAbove })}
      </p>
    </>
  );

  const pill = (key: string, on: boolean, label: ReactNode, flip: () => void) => (
    <button key={key} type="button" className={t.chip} data-plain aria-pressed={on} onClick={flip}>
      {label}
    </button>
  );
  // Only clinics running today are offered, plus the one they came for and the one picked.
  const running = ctx.data.clinics.filter(
    (cl) => cl.doctors.length > 0 || cl.hours || cl.id === p.clinic || cl.id === d.clinic,
  );
  const docCard = (id: string | null, name: string, photo: string | null | undefined) => {
    const load = doctorLoad(ctx.rows, ctx.doctors, id, ctx.now, clinic.id);
    const state =
      id == null
        ? TD.send.anySub
        : load.state === "break"
          ? fill(TD.send.break, { t: hm(load.until ?? ctx.now) })
          : TD.send[load.state];
    return (
      <button
        key={id ?? "any"}
        type="button"
        className={t.doc}
        aria-pressed={d.doc === id}
        onClick={() => set({ doc: id })}
      >
        {photo && !ctx.priv ? (
          // eslint-disable-next-line @next/next/no-img-element -- a signed, short-lived link; no optimiser.
          <img className={t.av} src={photo} alt="" />
        ) : (
          <span className={t.av} aria-hidden="true">
            {id ? initials(name) : "·"}
          </span>
        )}
        <span className={t.grow}>
          <b>{name}</b>
          <small className={id && load.state !== "free" ? t[`s_${load.state}`] : undefined}>
            {state}
          </small>
        </span>
        <span className={t.qn}>
          {load.queue > 1 ? fill(TD.send.queue[2], { n: load.queue }) : TD.send.queue[load.queue]}
        </span>
      </button>
    );
  };
  const sendTab = (
    <>
      <span className={t.cap}>{TD.send.clinics}</span>
      <div className={t.chips}>
        {running.map((cl) =>
          pill(
            cl.id,
            d.clinic === cl.id,
            <>
              <i className={t.dot} style={{ background: cl.hue }} />
              {cl.name}
            </>,
            () =>
              set({ clinic: cl.id, doc: cl.doctors.some((x) => x.id === d.doc) ? d.doc : null }),
          ),
        )}
      </div>
      <span className={t.cap}>{fill(TD.send.doctors, { clinic: clinic.short })}</span>
      <div className={t.docs}>
        {docCard(null, TD.send.any, null)}
        {clinic.doctors.map((x) => docCard(x.id, x.name, x.photo))}
      </div>
      {clinic.doctors.length ? null : (
        <p className={t.sub}>{fill(TD.send.noDoctors, { clinic: clinic.short })}</p>
      )}
      {level && level < 3 ? (
        <p className={`${t.sub} ${t.warn}`}>
          {d.doc
            ? fill(TD.send.alertOne, { n: level, doctor: ctx.docName(d.doc), clinic: clinic.short })
            : fill(TD.send.alert, { n: level, clinic: clinic.short })}
        </p>
      ) : null}
      {euSpaces.length ? (
        <>
          <span className={t.cap}>{EU_RESUS.title}</span>
          <div className={t.chips}>
            {euSpaces.map((x) => (
              <button
                key={x.bedId}
                type="button"
                className={t.chip}
                data-plain
                aria-pressed={d.eu === x.bedId}
                disabled={ctx.offline}
                onClick={() => set({ eu: d.eu === x.bedId ? null : x.bedId })}
              >
                {EU_RESUS.chip(x.wardName, x.label)}
              </button>
            ))}
          </div>
          {ctx.offline ? <p className={t.sub}>{EU_RESUS.offline}</p> : null}
        </>
      ) : null}
      <input
        className={t.reason}
        type="text"
        placeholder={P.note}
        value={d.note}
        maxLength={240}
        onChange={(e) => set({ note: e.target.value })}
        aria-label={P.note}
      />
    </>
  );

  const TABS: [Tab, ReactNode][] = [
    [
      "flags",
      <>
        <Flag />
        {TD.tabs.flags}
        {raised ? ` · ${fill(TD.tabs.raised, { n: raised })}` : ""}
      </>,
    ],
    ["news", TD.tabs.news],
    ["other", TD.tabs.other],
    ["next", `${TD.tabs.next} · ${recs.length}`],
    ["send", TD.tabs.send],
  ];
  const side = (
    <div className={`${t.box} ${t.side}`}>
      <div className={t.tabs} role="group" aria-label={TD.tabs.label}>
        {TABS.map(([k, label]) => (
          <button
            key={k}
            type="button"
            className={k === "flags" && raised ? t.raised : undefined}
            aria-pressed={d.tab === k}
            onClick={() => set({ tab: k })}
          >
            {label}
          </button>
        ))}
      </div>
      <div className={t.panel}>
        {d.tab === "flags" ? (
          flagsTab
        ) : d.tab === "news" ? (
          newsTab()
        ) : d.tab === "other" ? (
          otherTab
        ) : d.tab === "send" ? (
          sendTab
        ) : recs.length ? (
          recs.map((r) => (
            <div key={r.code} className={t.rec}>
              <b>{r.suggestion}</b>
              <span>{r.rationale}</span>
            </div>
          ))
        ) : (
          <span className={t.sub}>{TD.next.none}</span>
        )}
      </div>
    </div>
  );

  return (
    <EditorDialog
      open
      onOpenChange={(o) => !o && close()}
      width="xl"
      className="w-auto max-w-none overflow-visible rounded-none bg-transparent p-0 shadow-none ring-0 sm:max-h-none sm:max-w-none"
    >
      <div className={`${desk.tokens} ${t.dlg}`}>
        <div className={t.dh}>
          <span className={t.av} aria-hidden="true">
            {initials(p.name)}
          </span>
          <div className={t.grow}>
            <DialogTitle className={t.title}>
              {p.name} <span className={t.sub}>{whoOf(p)}</span>
            </DialogTitle>
            <DialogDescription className={t.sub}>
              {ctx.clinicOf(p.clinic).name} · {ctx.docName(p.doctorId)} ·{" "}
              {fill(P.waitLine, { w: mins(ctx.now - p.arrivedAt), t: hm(p.arrivedAt) })}
              {p.reason ? ` · ${p.reason}` : ""}
            </DialogDescription>
          </div>
          <button type="button" className={c("btn", "sm", "q", "x")} onClick={close}>
            {P.close}
          </button>
        </div>
        <div className={t.db}>
          {band}
          <div className={t.cols}>
            {vitals}
            {side}
          </div>
        </div>
        <div className={t.df}>
          <span className={t.note} role="status">
            {isL1
              ? fill(P.l1Missing, { level: levelTxt(1) })
              : still.length
                ? fill(P.stillNeeded, { list: still.join(", ") })
                : P.ready}
          </span>
          <div className={t.dfrow}>
            {!isL1 ? (
              <>
                <span className={t.cap}>{TD.assign}</span>
                <span className={t.levels} role="group" aria-label={P.levelGroup}>
                  {([2, 3, 4, 5] as AcuityLevel[]).map((l) => (
                    <button
                      key={l}
                      type="button"
                      className={level === l ? t[`l${l}`] : undefined}
                      aria-pressed={level === l}
                      disabled={!result}
                      onClick={() => set({ pick: l === engine ? null : l, why: "" })}
                    >
                      L{l}
                    </button>
                  ))}
                </span>
              </>
            ) : null}
            {changed ? (
              <span className={t.chips} role="group" aria-label={P.whyChange}>
                {(d.pick! > engine! ? P.whyDown : P.whyUp).map((w) =>
                  pill(w, d.why === w, w, () => set({ why: w })),
                )}
              </span>
            ) : null}
            <span className={t.grow} />
            <button type="button" className={t.to} onClick={() => set({ tab: "send" })}>
              {TD.change}
            </button>
            <button type="button" className={c("btn", "k")} onClick={send} disabled={off}>
              {fill(re ? P.saveRecheck : P.send, {
                clinic: clinic.short,
                level: level ? levelTxt(level) : "",
              }).replace(/ · $/, "")}
            </button>
          </div>
        </div>
      </div>
    </EditorDialog>
  );
}

/** How a NEWS2 total colours its tile: the engine's own level for it, read as a tone. */
function toneOfNews(total: number, singleThree: boolean): Tone {
  const on = news2Classes(total, singleThree).find((x) => x.on)!;
  return on.level === 2 ? "bad" : on.level === 3 ? "warn" : "ok";
}

/** One Glasgow Coma Scale part: closed it shows the score only ("E3"); opened, each choice keeps its meaning. */
function GcsPart({
  name,
  letter,
  words,
  max,
  value,
  onPick,
}: {
  name: string;
  letter: string;
  words: readonly string[];
  max: number;
  value: number | null;
  onPick: (n: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <select
      aria-label={name}
      value={value ?? ""}
      onMouseDown={() => setOpen(true)}
      onKeyDown={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onChange={(e) => {
        onPick(e.target.value ? Number(e.target.value) : null);
        setOpen(false);
      }}
    >
      <option value="">{letter} —</option>
      {Array.from({ length: max }, (_, i) => max - i).map((x) => (
        <option key={x} value={x}>
          {letter}
          {x}
          {open || value !== x ? ` · ${words[x - 1]}` : ""}
        </option>
      ))}
    </select>
  );
}

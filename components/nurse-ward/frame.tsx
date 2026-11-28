"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { DeskShell } from "@/components/reception/shell";
import { DeskDialog, Icon } from "@/components/reception/ui";
import { dayWord, hm, k, WIcon } from "./ui";

export interface FrameData {
  /** The server's clock, so the first paint matches; the card then ticks in the browser. */
  nowIso: string;
  hospitalName: string;
  wardName: string;
  userName: string;
  place: string;
  inCharge: boolean;
  canCosign: boolean;
  patients: number;
  dueHour: number;
  overdue: number;
  todoSoon: number;
  emergencies: { patientUserId: string; code: string }[];
  onShift: { id: string; name: string; patients: number; me: boolean }[];
}

type Item = readonly [label: string, href: string, icon: string, count: number | ""];

/** Prototype v82's nav, each place pointing at its real page. */
function navOf(f: FrameData): Item[] {
  const mine: Item = ["My patients", "/nurse/patients", "users", f.patients || ""];
  const todo: Item = ["To do", "/nurse/tasks", "check", f.todoSoon || ""];
  const due: Item = ["Due now", "/nurse/tasks?view=due", "clock", f.dueHour + f.overdue || ""];
  const meds: Item = ["Medicines", "/nurse/mar", "pill", ""];
  const cosign: Item = ["Co-sign queue", "/nurse/cosign-queue", "check", ""];
  const beds: Item = ["Bed board", "/nurse/beds", "bed", ""];
  const incoming: Item = ["Incoming", "/nurse/incoming", "inbox", ""];
  const handover: Item = ["Handover", "/nurse/handover/sbar", "swap", ""];
  const cd: Item = ["Controlled drugs", "/nurse/cd-dose", "lock", ""];
  const cal: Item = ["Calendar", "/nurse/calendar", "cal", ""];
  if (f.inCharge)
    return [
      ["Ward overview", "/nurse", "grid", ""],
      mine,
      todo,
      due,
      meds,
      cosign,
      beds,
      ["Assign nurses", "/nurse/assignments", "assign", ""],
      ["Duty rota", "/nurse/leave", "cal", ""],
      incoming,
      handover,
      cd,
      cal,
    ];
  return [
    mine,
    todo,
    due,
    meds,
    ...(f.canCosign ? [cosign] : []),
    beds,
    incoming,
    handover,
    cd,
    cal,
  ];
}

const KEYS: readonly (readonly [string, readonly string[]])[] = [
  ["Find a patient", ["/"]],
  ["My patients", ["G", "P"]],
  ["To do", ["G", "T"]],
  ["Due now", ["G", "D"]],
  ["Medicines", ["G", "M"]],
  ["Handover", ["G", "H"]],
  ["Bed board", ["G", "B"]],
  ["Calendar (in-charge: Ward overview)", ["G", "C"]],
  ["Collapse the sidebar", ["["]],
  ["Close a window", ["Esc"]],
  ["This list", ["?"]],
];

const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  (t.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) ||
    !!t.closest("[role=dialog]"));

/**
 * The ward desk's frame (ADR 0546), prototype v82 on the clinic floor's desk shell: the "now" card, the ward's
 * places with their counts, who is on shift, the view switch, emergency reviews and Find in the top bar.
 */
export function NurseWardFrame({
  data,
  at,
  children,
}: {
  data: FrameData;
  /** The fixture's page, standing in for the address. */
  at?: string;
  children: ReactNode;
}) {
  const realPath = usePathname();
  const view = useSearchParams().get("view");
  const path = at?.split("?")[0] ?? realPath;
  // The page as the nav names it: To do and Due now share a path and differ by ?view=due.
  const loc = at ?? (view === "due" ? `${realPath}?view=due` : realPath);
  const router = useRouter();
  const [rail, setRail] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [q, setQ] = useState("");
  const [seenPath, setSeenPath] = useState(path);
  const [now, setNow] = useState(() => new Date(data.nowIso));
  const qRef = useRef<HTMLInputElement>(null);

  if (seenPath !== path) {
    setSeenPath(path);
    setDrawer(false);
  }

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let g = 0;
    const GO: Record<string, string> = {
      p: "/nurse/patients",
      t: "/nurse/tasks",
      d: "/nurse/tasks?view=due",
      m: "/nurse/mar",
      h: "/nurse/handover/sbar",
      b: "/nurse/beds",
      c: data.inCharge ? "/nurse" : "/nurse/calendar",
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && drawer) return setDrawer(false);
      if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (Date.now() - g < 1200 && GO[key]) {
        e.preventDefault();
        g = 0;
        router.push(GO[key]);
      } else if (key === "g") g = Date.now();
      else if (e.key === "[") {
        e.preventDefault();
        setRail((r) => !r);
      } else if (e.key === "?") {
        e.preventDefault();
        setSheet((s) => !s);
      } else if (e.key === "/") {
        e.preventDefault();
        qRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer, router, data.inCharge]);

  const nav = navOf(data);
  // The longest prefix wins, so /nurse/patients/[id] lights My patients and /nurse lights only itself.
  const here =
    nav.find(([, href]) => href === loc)?.[1] ??
    [...nav]
      .filter(([, href]) => {
        if (href.includes("?")) return false;
        return href === "/nurse" ? path === "/nurse" : path === href || path.startsWith(`${href}/`);
      })
      .sort((a, b) => b[1].length - a[1].length)[0]?.[1];
  const seg: Item[] = data.inCharge
    ? [nav[0]!, nav[1]!, nav.find((n) => n[0] === "Duty rota")!]
    : [nav[0]!, nav[2]!, nav[3]!];

  // The day so far, midnight to midnight: the desk does not know the shift's hours yet.
  const [hh, mm] = hm(now).split(":").map(Number);
  const pct = (hh! * 60 + mm!) / 1440;
  const ringC = 2 * Math.PI * 24;
  const em = data.emergencies;

  return (
    <DeskShell
      label="Ward desk"
      priv={false}
      offline={false}
      banner={null}
      rail={rail}
      setRail={setRail}
      drawer={drawer}
      setDrawer={setDrawer}
      hospitalName={data.hospitalName}
      user={{ name: data.userName, place: data.place }}
      syncText="Saved to the hospital record"
      onKeys={() => setSheet(true)}
      onSwitchUser={() => router.push("/accounts")}
      onEmergency={() => router.push("/nurse/resus")}
      toast={null}
      clearToast={() => {}}
      side={
        <>
          <Link
            href={data.inCharge ? "/nurse" : "/nurse/patients"}
            prefetch={false}
            className={k("today")}
            aria-label={`${data.wardName} now: ${data.patients} patients, ${data.dueHour} due, ${data.overdue} overdue`}
          >
            <span className={k("tt", "full")}>
              <span>
                {data.wardName} · {dayWord(now)}
              </span>
              <b className={k("mono")}>{hm(now)}</b>
            </span>
            <span className={k("ring", "railOnly")} aria-hidden="true">
              <svg viewBox="0 0 56 56">
                <circle
                  cx="28"
                  cy="28"
                  r="24"
                  fill="none"
                  stroke="currentColor"
                  strokeOpacity=".16"
                  strokeWidth="3.5"
                />
                <circle
                  cx="28"
                  cy="28"
                  r="24"
                  fill="none"
                  stroke="var(--next)"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  strokeDasharray={`${(ringC * pct).toFixed(1)} ${ringC.toFixed(1)}`}
                  transform="rotate(-90 28 28)"
                />
              </svg>
              <b className={k("mono")}>{hm(now)}</b>
            </span>
            <span className={k("rs", "railOnly")}>
              <span>
                <b>{data.dueHour}</b>
                <small>due</small>
              </span>
              <span>
                <b>{data.overdue}</b>
                <small>late</small>
              </span>
            </span>
            <span className={k("ts", "full")}>
              <span>
                <b>{data.patients}</b>
                <small>{data.inCharge ? "on the ward" : "my patients"}</small>
              </span>
              <span>
                <b>{data.dueHour}</b>
                <small>due this hour</small>
              </span>
              <span>
                <b>{data.overdue}</b>
                <small>overdue</small>
              </span>
            </span>
            <span className={k("tb", "full")} aria-hidden="true">
              <i style={{ width: `${Math.round(pct * 100)}%` }} />
            </span>
            <span className={k("tf", "full")}>{data.todoSoon} to do now or within the hour</span>
          </Link>

          <nav className={k("nav")} aria-label="Ward desk">
            {nav.map(([label, href, icon, count]) => (
              <Link
                key={label}
                href={href}
                prefetch={false}
                className={k("nv", href === here && "on")}
                aria-current={href === here ? "page" : undefined}
                title={label}
              >
                <WIcon n={icon} />
                <span className={k("lbl")}>{label}</span>
                {count !== "" ? <em>{count}</em> : null}
              </Link>
            ))}
            {em.length ? (
              <Link
                href={`/nurse/patients/${em[0]!.patientUserId}`}
                prefetch={false}
                className={k("nv", "navEm")}
                title="Emergency review"
              >
                <WIcon n="check" />
                <span className={k("lbl")}>Emergency review</span>
                <em>{em.length}</em>
                <i className={k("dot")} aria-hidden="true" />
              </Link>
            ) : null}
          </nav>

          {data.onShift.length ? (
            <>
              <div className={k("rule")} aria-hidden="true" />
              <div className={k("secH", "full")}>
                On shift
                <small>{data.inCharge ? "on your ward now" : "with you today"}</small>
              </div>
              <div className={k("clw", "full")}>
                <div className={k("cl2")}>
                  {data.onShift.map((n) => (
                    <span key={n.id} className={k("ck2", n.me && "on")} title={n.name}>
                      <span className={k("box")} aria-hidden="true">
                        <Icon n="tick" size={10} w={3.4} />
                      </span>
                      <span className={k("cn")}>
                        {n.name}
                        {n.me ? " (you)" : ""}
                      </span>
                      <span className={k("cm")}>{n.patients}</span>
                    </span>
                  ))}
                </div>
              </div>
            </>
          ) : null}
        </>
      }
      top={
        <>
          <div className={k("seg")} role="group" aria-label="View">
            {seg.map(([label, href]) => (
              <Link
                key={label}
                href={href}
                prefetch={false}
                className={k(href === here && "on")}
                aria-current={href === here ? "page" : undefined}
              >
                {label === "Ward overview" ? "Ward" : label}
              </Link>
            ))}
          </div>
          <span className={k("grow")} />
          {em.length ? (
            <Link
              href={`/nurse/patients/${em[0]!.patientUserId}`}
              prefetch={false}
              className={k("prepill")}
            >
              <span className={k("pulse")} aria-hidden="true" />
              <b>{em.length}</b>
              <span className={k("tl")}>need emergency review</span>
            </Link>
          ) : null}
          <form
            className={k("srch")}
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              router.push(`/nurse/patients${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`);
            }}
          >
            <label style={{ display: "block" }}>
              <span className={k("sr")}>Find a patient or bed</span>
              <Icon n="search" size={16} w={2} />
              <input
                ref={qRef}
                type="search"
                autoComplete="off"
                placeholder="Find a patient or bed  /"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </label>
          </form>
        </>
      }
      after={
        <DeskDialog
          open={sheet}
          onClose={() => setSheet(false)}
          label="Keyboard shortcuts"
          tile="keys"
          title="Keyboard shortcuts"
          lead="Letters work when you are not typing in a box."
        >
          <div className={k("kys")}>
            {KEYS.map(([what, ks]) => (
              <div key={what} className={k("ky")}>
                <span>{what}</span>
                <span className={k("kk")}>
                  {ks.map((x) => (
                    <kbd key={x}>{x}</kbd>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </DeskDialog>
      }
    >
      <div className={k("wd")}>{children}</div>
    </DeskShell>
  );
}

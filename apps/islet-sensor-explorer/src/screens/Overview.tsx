import type { Zone } from "@/content/sensor";
import { useId } from "react";
import { useNavigate } from "react-router-dom";

import { PathLegend } from "@/components/diagram/PathLegend";
import { Card } from "@/components/ui/Card";
import { SectionNumber } from "@/components/ui/SectionNumber";
import { CYCLE_META, META, SAFETY, SCREENS, TRUST_RULE, ZONE_LABELS } from "@/content/sensor";
import { cn } from "@/lib/cn";
import { bracketCode, findScreen } from "@/lib/content";
import { pathClass, wrapLabel, ZONE_COLUMN_ORDER } from "@/lib/graph";
import { ALL_NODES } from "@/lib/nodes";
import { useExplorerStore } from "@/store/explorer";

/* Hero geometry. Three zone panels side by side, each holding its parts as
   small labelled nodes. Nothing here is content. */
const VIEW = { width: 1064, height: 440 };
const PANEL = { y: 44, w: 336, h: 366, gap: 20 };
const NODE = { w: 140, h: 52, gapX: 12, gapY: 10 };
const NODE_COLUMNS = 2;
/* Three lines is what the longest two part names need. Truncating a part name
   in the hero would make the reader go and look it up. */
const LABEL_CHARS = 20;
const LABEL_LINES = 3;
const LABEL_LINE_H = 12;

function panelX(column: number): number {
  return 8 + column * (PANEL.w + PANEL.gap);
}

interface HeroNode {
  id: number;
  name: string;
  zone: Zone;
  x: number;
  y: number;
}

/** Lay the parts of each zone into a two-column block inside its panel. */
function heroNodes(): HeroNode[] {
  const nodes: HeroNode[] = [];
  ZONE_COLUMN_ORDER.forEach((zone, column) => {
    const inZone = ALL_NODES.filter((part) => part.zone === zone).sort((a, b) => a.id - b.id);
    const left = panelX(column) + 16;
    inZone.forEach((part, index) => {
      const row = Math.floor(index / NODE_COLUMNS);
      const slot = index % NODE_COLUMNS;
      nodes.push({
        id: part.id,
        name: part.name,
        zone,
        x: left + slot * (NODE.w + NODE.gapX),
        y: PANEL.y + 40 + row * (NODE.h + NODE.gapY),
      });
    });
  });
  return nodes;
}

const HERO_NODES = heroNodes();

export function Overview() {
  const screen = findScreen("/");
  const navigate = useNavigate();
  const setSelectedPart = useExplorerStore((state) => state.setSelectedPart);
  const baseId = useId();

  if (!screen) return null;

  /** Open screen [01] with this part already selected. */
  function openPart(id: number) {
    setSelectedPart(id);
    navigate("/parts");
  }

  const partsScreen = SCREENS.find((entry) => entry.path === "/parts");

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-10">
      <header className="flex flex-col gap-4">
        <SectionNumber code={bracketCode(screen.code)} className="self-start" />
        <h1 className="font-display text-display-s lg:text-display-m text-gray-900">
          {META.programme}
        </h1>
        <p className="text-body-l max-w-prose text-gray-600">{META.strapline}</p>
        <p className="text-body-m max-w-prose text-gray-600">
          Two sensors sit in the peritoneal cavity and measure glucose in completely different ways:
          one reads a glow, the other reads a current. {CYCLE_META.periodLabel} they are both read,
          compared against each other, and turned into a single value with an uncertainty attached.
          A safety supervisor decides how much that value can be trusted, and the dosing controller
          is allowed to act only within the trust it is given and within limits a clinician set.
          Everything outside the body reports, alerts and reviews. None of it doses.
        </p>
        <p className="text-body-s max-w-prose text-gray-500">
          {META.footer} Document {META.documentCode}.
        </p>
      </header>

      {/* The three zones */}
      <figure className="m-0 flex min-w-0 flex-col gap-3">
        <div className="hidden lg:block">
          <svg
            viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
            role="group"
            aria-labelledby={`${baseId}-hero-title`}
            preserveAspectRatio="xMidYMid meet"
            className="block h-auto w-full max-w-full"
          >
            <title id={`${baseId}-hero-title`}>
              The three zones of the glucose-sensing subsystem, with every part in each
            </title>

            {ZONE_COLUMN_ORDER.map((zone, column) => (
              <g key={zone}>
                <rect
                  x={panelX(column)}
                  y={PANEL.y}
                  width={PANEL.w}
                  height={PANEL.h}
                  rx={12}
                  strokeWidth={1}
                  className="fill-gray-50 stroke-gray-200"
                />
                <text
                  x={panelX(column) + 16}
                  y={PANEL.y - 12}
                  className="text-overline fill-gray-500 uppercase"
                >
                  {ZONE_LABELS[zone]}
                </text>
                {zone === "outside" ? (
                  <text
                    x={panelX(column) + PANEL.w - 16}
                    y={PANEL.y + PANEL.h + 20}
                    textAnchor="end"
                    className="text-caption fill-gray-600"
                  >
                    {SAFETY.noOutsideDosing}
                  </text>
                ) : null}
              </g>
            ))}

            {HERO_NODES.map((node) => {
              const part = ALL_NODES.find((entry) => entry.id === node.id);
              if (!part) return null;
              const insulin = part.path === "insulin";
              const lines = wrapLabel(node.name, LABEL_CHARS, LABEL_LINES);
              const firstY = node.y + NODE.h / 2 - ((lines.length - 1) * LABEL_LINE_H) / 2 + 4;
              return (
                <g
                  key={node.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`${part.id} ${part.name}. Open it on screen ${bracketCode(partsScreen?.code ?? "01")} ${partsScreen?.title ?? "Parts"}.`}
                  onClick={() => openPart(node.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openPart(node.id);
                    }
                  }}
                  className="group ease-expo-out cursor-pointer transition-opacity duration-150 focus:outline-none motion-reduce:transition-none"
                >
                  <rect
                    x={node.x}
                    y={node.y}
                    width={NODE.w}
                    height={NODE.h}
                    rx={8}
                    strokeWidth={1}
                    className={cn(
                      "fill-card group-focus-visible:stroke-ring group-hover:fill-teal-50",
                      insulin ? pathClass("insulin").stroke : "stroke-gray-200",
                    )}
                  />
                  {/* One text element with positioned spans, rather than one
                      element per line. Separate elements concatenate with no
                      space between them, so the group's visible text would read
                      "1Optical tip" and would not match its accessible name. */}
                  <text className="text-caption fill-gray-900">
                    <tspan
                      x={node.x + 8}
                      y={node.y + 14}
                      className="tabular fill-gray-500 font-mono"
                    >
                      {part.id}
                    </tspan>
                    {lines.map((line, lineIndex) => (
                      <tspan key={line} x={node.x + 26} y={firstY + lineIndex * LABEL_LINE_H}>
                        {" "}
                        {line}
                      </tspan>
                    ))}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        <figcaption className="text-body-s text-gray-600">
          <span className="font-medium text-gray-900">The three zones.</span> Every part of the
          subsystem, in the zone it lives in. Select any one to open it on screen{" "}
          {bracketCode(partsScreen?.code ?? "01")} {partsScreen?.title ?? "Parts"}.
        </figcaption>
      </figure>

      {/* Below lg: the same parts as a list, complete rather than shrunken */}
      <section aria-labelledby="overview-parts" className="min-w-0 lg:hidden">
        <h2 id="overview-parts" className="text-overline text-gray-500 uppercase">
          Every part, by zone
        </h2>
        <div className="mt-4 flex flex-col gap-6">
          {ZONE_COLUMN_ORDER.map((zone) => (
            <div key={zone} className="min-w-0">
              <h3 className="text-body-s font-medium text-gray-900">{ZONE_LABELS[zone]}</h3>
              {zone === "outside" ? (
                <p className="text-caption mt-1 text-gray-600">{SAFETY.noOutsideDosing}</p>
              ) : null}
              <ul className="mt-2 flex flex-col gap-1.5">
                {ALL_NODES.filter((part) => part.zone === zone).map((part) => (
                  <li key={part.id}>
                    <button
                      type="button"
                      onClick={() => openPart(part.id)}
                      className="tap ease-expo-out bg-card flex w-full items-baseline gap-3 rounded-md border border-gray-200 px-3 py-2 text-left transition-colors duration-150 hover:border-teal-100 hover:bg-teal-50 motion-reduce:transition-none"
                    >
                      <span className="text-caption tabular shrink-0 font-mono text-gray-500">
                        {part.id}
                      </span>
                      <span className="text-body-s min-w-0 text-gray-900">{part.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card tone="teal">
          <h2 className="text-heading-s text-gray-900">The rule this whole design turns on</h2>
          <p className="text-body-m mt-3 text-gray-900">{TRUST_RULE}</p>
          <p className="text-body-s mt-3 text-gray-600">
            {SAFETY.onlyRedDoses} {SAFETY.noOutsideDosing}
          </p>
        </Card>
        <Card>
          <PathLegend />
        </Card>
      </div>

      {/* Where to go next */}
      <section aria-labelledby="overview-screens" className="min-w-0">
        <h2 id="overview-screens" className="text-overline text-gray-500 uppercase">
          The nine screens
        </h2>
        <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {SCREENS.map((entry) => (
            <li key={entry.path} className="min-w-0">
              <a
                href={entry.path}
                onClick={(event) => {
                  event.preventDefault();
                  navigate(entry.path);
                }}
                className="tap ease-expo-out bg-card flex h-full min-w-0 flex-col gap-1 rounded-lg border border-gray-200 px-4 py-3 transition-colors duration-150 hover:border-teal-100 hover:bg-teal-50 motion-reduce:transition-none"
              >
                <span className="text-caption tabular font-mono text-teal-800">
                  {bracketCode(entry.code)}
                </span>
                <span className="text-body-s font-medium text-gray-900">{entry.title}</span>
                <span className="text-caption text-gray-600">{entry.blurb}</span>
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

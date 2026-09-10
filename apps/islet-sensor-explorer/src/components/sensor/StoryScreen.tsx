import type { SensorInfluence, SensorStory } from "@/content/sensor";
import { useId, useState } from "react";

import { stepPanelId, stepTabId } from "@/components/sensor/step-ids";
import { Stepper } from "@/components/sensor/Stepper";
import { Card } from "@/components/ui/Card";
import { SectionNumber } from "@/components/ui/SectionNumber";
import { LINKS, PARTS, SAFETY, TRUST_RULE } from "@/content/sensor";
import { bracketCode, findScreen } from "@/lib/content";
import { useReducedMotion } from "@/lib/use-reduced-motion";

export interface StoryScreenProps {
  story: SensorStory;
  path: string;
  /** Draws the figure for the step showing now. */
  renderFigure: (state: {
    step: number;
    reduced: boolean;
    demoOn: boolean;
    titleId: string;
    descId: string;
    labelFor: (from: number, to: number) => string;
  }) => React.ReactNode;
  /** A short line under the figure naming what the reader is looking at. */
  figureCaption: string;
}

function partName(id: number): string {
  return PARTS.find((part) => part.id === id)?.name ?? "";
}

/** The wording of one link, so a figure never retypes a number. */
function linkWhat(from: number, to: number): string {
  return LINKS.find((link) => link.from === from && link.to === to)?.what ?? "";
}

function InfluenceList({ items, heading }: { items: SensorInfluence[]; heading: string }) {
  return (
    <section>
      <h2 className="text-overline text-gray-500 uppercase">{heading}</h2>
      <ul className="mt-3 flex flex-col gap-4">
        {items.map((item) => (
          <li key={item.name}>
            <p className="text-body-s font-medium text-gray-900">{item.name}</p>
            <p className="text-body-s mt-0.5 text-gray-600">{item.effect}</p>
            <p className="text-body-s mt-1 text-gray-500">{item.why}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The shape both sensor stories take: a four-step stepper over a drawing, with
 * the written detail beside it and, in a side panel, what can fool this sensor
 * and what wears it out.
 *
 * Neither sensor doses anything, so nothing on either screen is red. The two
 * screens say so, and say what the reading is allowed to move, so a reader
 * arriving here from the map is not left guessing.
 */
export function StoryScreen({ story, path, renderFigure, figureCaption }: StoryScreenProps) {
  const screen = findScreen(path);
  const reduced = useReducedMotion();
  const [step, setStep] = useState(0);
  const [demoOn, setDemoOn] = useState(false);
  const baseId = useId();
  const titleId = `${baseId}-figure-title`;
  const descId = `${baseId}-figure-desc`;
  // useId gives an id with no spaces in it, which aria-controls and
  // aria-labelledby both require. A screen title would not.
  const stepIds = `${baseId}-step`;

  const current = story.steps[step] ?? story.steps[0];
  if (!screen || !current) return null;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8">
      <header className="flex flex-col gap-3">
        <SectionNumber code={bracketCode(screen.code)} className="self-start" />
        <h1 className="font-display text-heading-l lg:text-display-s text-gray-900">
          {screen.title}
        </h1>
        <p className="text-body-l max-w-prose text-gray-600">{screen.blurb}</p>
        <p className="text-body-m max-w-prose text-gray-600">{story.summary}</p>
        <p className="text-body-s max-w-prose text-gray-500">
          {partName(story.tipPartId)} sits in the peritoneal cavity, {partName(story.modulePartId)}{" "}
          in the implanted housing. This sensor reports a number and nothing else:{" "}
          {SAFETY.onlyRedDoses.charAt(0).toLowerCase() + SAFETY.onlyRedDoses.slice(1)}
        </p>
      </header>

      <Stepper
        steps={story.steps}
        index={step}
        onSelect={setStep}
        label={screen.title}
        idPrefix={stepIds}
        className="border-y border-gray-200 py-5"
      />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <div
            role="tabpanel"
            id={stepPanelId(stepIds, current.n)}
            aria-labelledby={stepTabId(stepIds, current.n)}
            tabIndex={0}
            className="min-w-0 rounded-lg"
          >
            <figure className="m-0 min-w-0">
              <Card tone="muted" className="p-4">
                {renderFigure({ step, reduced, demoOn, titleId, descId, labelFor: linkWhat })}
              </Card>
              <figcaption className="text-body-s mt-3 text-gray-600">
                <span className="font-medium text-gray-900">
                  Step {current.n}. {current.title}.
                </span>{" "}
                {current.detail}
              </figcaption>
            </figure>
          </div>

          {current.linkRef ? (
            <p className="text-caption tabular font-mono text-gray-500">
              {linkWhat(current.linkRef.from, current.linkRef.to)}
            </p>
          ) : null}

          {story.demo ? (
            <div className="flex flex-wrap items-start gap-3">
              <button
                type="button"
                aria-pressed={demoOn}
                onClick={() => setDemoOn((on) => !on)}
                className={
                  demoOn
                    ? "tap ease-expo-out text-body-s rounded-md border border-teal-600 bg-teal-50 px-3 py-2 font-medium text-teal-800 transition-colors duration-150 motion-reduce:transition-none"
                    : "tap ease-expo-out bg-card text-body-s rounded-md border border-gray-200 px-3 py-2 font-medium text-gray-600 transition-colors duration-150 hover:border-teal-100 hover:bg-teal-50 motion-reduce:transition-none"
                }
              >
                {story.demo.label}
              </button>
              <p className="text-body-s max-w-prose flex-1 text-gray-600" role="status">
                {demoOn ? story.demo.on : story.demo.off}
              </p>
            </div>
          ) : null}

          {/* The same four steps in words, so the drawing is never the only copy. */}
          <details className="border-t border-gray-200 pt-4">
            <summary className="text-body-s cursor-pointer font-medium text-gray-900">
              All four steps in words
            </summary>
            <ol className="mt-3 flex flex-col gap-3">
              {story.steps.map((entry) => (
                <li key={entry.n} className="text-body-s text-gray-600">
                  <span className="tabular font-mono text-gray-500">{entry.n}. </span>
                  <span className="font-medium text-gray-900">{entry.title}.</span> {entry.detail}
                </li>
              ))}
            </ol>
          </details>
        </div>

        <aside className="flex flex-col gap-6 lg:sticky lg:top-32 lg:self-start">
          <Card>
            <InfluenceList heading="What can fool it" items={story.fooledBy} />
            <hr className="my-6 border-gray-200" />
            <InfluenceList heading="What wears it out" items={story.wearsOut} />
          </Card>
          <Card tone="teal">
            <h2 className="text-overline text-gray-500 uppercase">Where the reading goes</h2>
            <p className="text-body-s mt-3 text-gray-900">{TRUST_RULE}</p>
            <p className="text-body-s mt-3 text-gray-600">{SAFETY.noOutsideDosing}</p>
          </Card>
        </aside>
      </div>

      <p className="text-caption text-gray-500">{figureCaption}</p>
    </div>
  );
}

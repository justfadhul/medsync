import { Card } from "@/components/ui/Card";
import { SectionNumber } from "@/components/ui/SectionNumber";
import { bracketCode, findScreen } from "@/lib/content";

export interface ScreenPlaceholderProps {
  /** The route path, used to look the screen up in the content file. */
  path: string;
}

/**
 * The standing shape of a screen: bracket code, title, blurb. The body arrives
 * in a later phase.
 */
export function ScreenPlaceholder({ path }: ScreenPlaceholderProps) {
  const screen = findScreen(path);

  if (!screen) {
    return (
      <Card tone="muted" className="mx-auto max-w-prose">
        <p className="text-body-s text-gray-600">
          This route is not listed in the content file yet, so there is no title or summary to show.
        </p>
      </Card>
    );
  }

  return (
    <div className="stagger-children mx-auto flex max-w-prose flex-col gap-6">
      <header className="flex flex-col gap-3">
        <SectionNumber code={bracketCode(screen.code)} className="self-start" />
        <h1 className="font-display text-heading-l lg:text-display-s text-gray-900">
          {screen.title}
        </h1>
        <p className="text-body-l text-gray-600">{screen.blurb}</p>
      </header>

      <Card tone="muted">
        <h2 className="text-heading-s text-gray-900">Arriving in a later phase</h2>
        <p className="text-body-s mt-2 text-gray-600">
          The shell, the design tokens and the safety framings are in place. The working parts of
          this screen are built next.
        </p>
      </Card>
    </div>
  );
}

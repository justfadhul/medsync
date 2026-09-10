import type { ReactNode } from "react";
import { useId } from "react";

import { cn } from "@/lib/cn";

export interface DiagramFrameProps {
  /** The name of the diagram, read as the accessible name of the picture. */
  title: string;
  /** One line saying what the picture shows. Visible, and read as its description. */
  description: string;
  viewBox: { width: number; height: number };
  /**
   * The same information as the picture, written out. It is read by a screen
   * reader instead of the geometry, so it carries the content and not the shapes.
   */
  textAlternative: ReactNode;
  children: ReactNode;
  /**
   * Layout is the caller's, including hiding the frame below the lg breakpoint
   * (for example "hidden lg:block") when a screen supplies its own stacked list.
   */
  className?: string;
  /**
   * group when the diagram holds interactive nodes, so they stay reachable.
   * img when the picture is static and only its text alternative matters.
   */
  role?: "group" | "img";
}

/**
 * The frame every diagram sits in: a figure, a visible caption, an SVG named by
 * its own title and description, and a written alternative for screen readers.
 *
 * The SVG scales to the width it is given and keeps its ratio, so it never
 * pushes the page sideways at 390 pixels or at 1600.
 */
export function DiagramFrame({
  title,
  description,
  viewBox,
  textAlternative,
  children,
  className,
  role = "group",
}: DiagramFrameProps) {
  const id = useId();
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;

  return (
    <figure className={cn("m-0 w-full max-w-full min-w-0", className)}>
      <svg
        role={role}
        aria-labelledby={`${titleId} ${descriptionId}`}
        viewBox={`0 0 ${viewBox.width} ${viewBox.height}`}
        preserveAspectRatio="xMidYMid meet"
        className="block h-auto w-full max-w-full"
      >
        <title id={titleId}>{title}</title>
        <desc id={descriptionId}>{description}</desc>
        {children}
      </svg>

      <figcaption className="text-body-s mt-3 text-gray-600">
        <span className="font-medium text-gray-900">{title}.</span> {description}
      </figcaption>

      <div className="sr-only">{textAlternative}</div>
    </figure>
  );
}

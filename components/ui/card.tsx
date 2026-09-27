import * as React from "react";

import { cn } from "@/lib/utils";

type CardTone = "standard" | "muted" | "tealTinted";

function Card({
  className,
  tone = "standard",
  ...props
}: React.ComponentProps<"div"> & { tone?: CardTone }) {
  const toneClasses: Record<CardTone, string> = {
    standard: "bg-card text-card-foreground border border-border shadow-card",
    muted: "bg-muted text-card-foreground border border-ink-150",
    tealTinted: "bg-teal-tint text-card-foreground border border-teal-edge",
  };

  return (
    <div
      data-slot="card"
      data-tone={tone}
      className={cn(
        "group/card flex flex-col gap-4 rounded-lg p-6 transition-colors",
        "has-data-[slot=card-footer]:pb-0",
        toneClasses[tone],
        className,
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="card-header" className={cn("flex flex-col gap-1.5", className)} {...props} />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn("font-heading text-heading-s text-foreground", className)}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-body-s text-muted-foreground", className)}
      {...props}
    />
  );
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn("flex items-center gap-2 self-start justify-self-end", className)}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-content" className={cn(className)} {...props} />;
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "border-ink-150 bg-muted -mx-6 -mb-6 flex items-center gap-2 rounded-b-lg border-t px-6 py-4",
        className,
      )}
      {...props}
    />
  );
}

export { Card, CardHeader, CardFooter, CardTitle, CardAction, CardDescription, CardContent };

import type { ComponentProps, ReactNode } from "react";
import { TriangleAlertIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Form-level notice for the auth funnels — calm amber, icon + words. An auth
 * slip is routine attention, never an emergency, so it stays out of clinical
 * red. Extra props land on the box: the sign-in and MFA forms pass an id, a
 * ref and tabIndex={-1} so focus can move to it after a failed attempt.
 */
export function AuthNotice({
  message,
  className,
  ...props
}: { message?: ReactNode } & ComponentProps<"div">) {
  if (!message) return null;
  return (
    <div
      role="alert"
      {...props}
      className={cn(
        "text-body-s flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-amber-900 dark:border-amber-800/40 dark:bg-amber-950/30 dark:text-amber-200",
        className,
      )}
    >
      <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={2} />
      <span>{message}</span>
    </div>
  );
}

/** A field's own error line, named by the input's aria-describedby. Amber text, not red. */
export function FieldNote({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-body-s text-amber-900">
      {message}
    </p>
  );
}

/**
 * The auth inputs (sign-in, MFA): 48px, 16px text (below 16px iOS zooms the
 * page on focus), a gray-500 border (4.7:1 on white; WCAG 1.4.11 wants 3:1), a
 * 2px teal-600 focus ring over the layout's foreground outline, and an amber
 * border — not the Input's red — when invalid.
 */
export const AUTH_INPUT =
  "bg-background h-12 rounded-md border-gray-500 px-3 text-base focus-visible:border-teal-600 focus-visible:shadow-none focus-visible:outline-teal-600! focus-visible:outline-offset-0! aria-invalid:border-amber-700 aria-invalid:bg-background aria-invalid:shadow-none";

/** Labels above the auth inputs: 13/20 medium, foreground (the Label default is an 11px muted caption). */
export const AUTH_LABEL = "text-body-s text-foreground mb-0 leading-5 font-medium";

/** Tiny in-button progress ring shown while a server action is pending. */
export function ButtonSpinner() {
  return (
    <span
      aria-hidden
      className="size-3 shrink-0 rounded-full border-2 border-current/30 border-t-current motion-safe:animate-spin"
    />
  );
}

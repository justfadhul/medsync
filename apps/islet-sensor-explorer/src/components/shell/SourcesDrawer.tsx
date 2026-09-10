import { useCallback, useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";

import { Button } from "@/components/ui/Button";
import { CloseIcon, LinkIcon } from "@/components/ui/icons";
import { META } from "@/content/sensor";
import { asText, describeSource } from "@/lib/content";
import { useReducedMotion } from "@/lib/use-reduced-motion";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

/**
 * Panel motion, from the design system: 250ms on the expo-out curve. Framer
 * Motion takes seconds, and an easing as four numbers.
 */
const PANEL_SECONDS = 0.25;
const EASE_EXPO_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1];

export interface SourcesDrawerProps {
  open: boolean;
  onClose: () => void;
}

/**
 * The source documents behind this model, in a modal drawer. Escape closes it,
 * focus stays inside while it is open, and focus returns to the trigger after.
 */
export function SourcesDrawer({ open, onClose }: SourcesDrawerProps) {
  const reducedMotion = useReducedMotion();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  // Remember the trigger, hold the page still, move focus in, then give focus
  // back when the drawer closes.
  useEffect(() => {
    if (!open) return;
    triggerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const timer = window.setTimeout(() => closeRef.current?.focus(), 0);

    return () => {
      window.clearTimeout(timer);
      document.body.style.overflow = previousOverflow;
      triggerRef.current?.focus();
    };
  }, [open]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const panel = panelRef.current;
      if (!panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onKeyDown]);

  const duration = reducedMotion ? 0 : PANEL_SECONDS;
  const sources = META.sources ?? [];

  return (
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-50">
          <motion.div
            aria-hidden="true"
            onClick={onClose}
            className="absolute inset-0 bg-black/50 dark:bg-black/70"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration, ease: EASE_EXPO_OUT }}
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="sources-drawer-title"
            className="bg-card shadow-popover absolute inset-y-0 right-0 flex w-full max-w-105 flex-col border-l border-gray-200"
            initial={{ x: reducedMotion ? 0 : "100%", opacity: reducedMotion ? 0 : 1 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: reducedMotion ? 0 : "100%", opacity: reducedMotion ? 0 : 1 }}
            transition={{ duration, ease: EASE_EXPO_OUT }}
          >
            <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-5 py-4">
              <div className="min-w-0">
                <h2 id="sources-drawer-title" className="text-heading-s text-gray-900">
                  Sources
                </h2>
                <p className="text-body-s mt-1 text-gray-500">
                  The documents this model is drawn from.
                </p>
              </div>
              <Button
                ref={closeRef}
                variant="ghost"
                size="sm"
                onClick={onClose}
                aria-label="Close the sources drawer"
              >
                <CloseIcon className="size-4" />
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {sources.length === 0 ? (
                <p className="text-body-s text-gray-600">
                  No sources are listed in the content file yet.
                </p>
              ) : (
                <ul className="flex flex-col gap-4">
                  {sources.map((source, index) => {
                    const view = describeSource(source, index);
                    return (
                      <li key={view.key} className="border-gray-150 border-b pb-4 last:border-0">
                        <p className="text-body-s font-medium text-gray-900">{view.title}</p>
                        {view.code ? (
                          <p className="text-caption tabular mt-1 font-mono text-teal-700">
                            {view.code}
                          </p>
                        ) : null}
                        {view.detail ? (
                          <p className="text-body-s mt-1 text-gray-500">{view.detail}</p>
                        ) : null}
                        {view.href ? (
                          <a
                            href={view.href}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="text-caption mt-2 inline-flex items-center gap-1.5 font-mono break-all text-teal-700 underline underline-offset-2"
                          >
                            <LinkIcon className="size-3.5 shrink-0" />
                            {view.href}
                          </a>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="border-t border-gray-200 px-5 py-3">
              <p className="text-caption tabular font-mono text-gray-500">
                {asText(META.documentCode)}
              </p>
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}

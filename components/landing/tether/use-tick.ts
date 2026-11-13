"use client";

import type { RefObject } from "react";
import { useEffect, useEffectEvent, useState } from "react";

/**
 * Calls `tick` every `ms` while `ref` is on screen and the tab is visible (§5.4: every timer pauses when
 * the tab is hidden or the element is off screen). `on: false` stops it; `immediate` also calls it on (re)start.
 */
export function useTick(
  ref: RefObject<Element | null>,
  ms: number,
  tick: () => void,
  on = true,
  immediate = false,
) {
  const fire = useEffectEvent(tick);
  useEffect(() => {
    const el = ref.current;
    if (!on || !el) return;
    let seen = false;
    let id: number | undefined;
    const sync = () => {
      const run = seen && !document.hidden;
      if (run && id === undefined) {
        if (immediate) fire();
        id = window.setInterval(() => fire(), ms);
      } else if (!run && id !== undefined) {
        window.clearInterval(id);
        id = undefined;
      }
    };
    const io = new IntersectionObserver(([e]) => {
      seen = !!e?.isIntersecting;
      sync();
    });
    io.observe(el);
    document.addEventListener("visibilitychange", sync);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", sync);
      if (id !== undefined) window.clearInterval(id);
    };
  }, [ref, ms, on, immediate]);
}

/** True when the visitor asked for reduced motion. Read in effects and handlers only. */
export const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * A snapping carousel's current card and a way to move to one (§9: dots are buttons, arrow keys move). The
 * index follows the scroll, so a swipe, a dot and a key all agree.
 */
export function useSnap(ref: RefObject<HTMLElement | null>) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const on = () => {
      const w = (el.firstElementChild as HTMLElement | null)?.offsetWidth ?? el.clientWidth;
      setIndex(Math.round(el.scrollLeft / (w + 12)));
    };
    el.addEventListener("scroll", on, { passive: true });
    return () => el.removeEventListener("scroll", on);
  }, [ref]);
  const go = (i: number) => {
    const el = ref.current;
    const card = el?.children[Math.max(0, Math.min(el.children.length - 1, i))] as
      | HTMLElement
      | undefined;
    // The list is `relative` with a 20 px inline padding, so a card's offsetLeft is its scroll position + 20.
    if (el && card)
      el.scrollTo({ left: card.offsetLeft - 20, behavior: reducedMotion() ? "auto" : "smooth" });
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      go(index + (e.key === "ArrowRight" ? 1 : -1));
    }
  };
  return { index, go, onKeyDown };
}

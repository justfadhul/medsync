import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function readPreference(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(QUERY).matches;
}

/**
 * True when the reader has asked their system to reduce motion. Every
 * animation in this app must honour it: hold the end state, do not move.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(readPreference);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const list = window.matchMedia(QUERY);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    setReduced(list.matches);
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, []);

  return reduced;
}

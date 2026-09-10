/**
 * Join class names, dropping anything falsy. Deliberately dependency free:
 * no clsx, no tailwind-merge. Later classes win only if they are written
 * later in the call, so keep overrides last.
 */
export type ClassValue = string | false | null | undefined;

export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(" ");
}

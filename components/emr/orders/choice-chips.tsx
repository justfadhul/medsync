import { cn } from "@/lib/utils";

/**
 * A short single choice as a row of chips (priority, fasting, entry status, read-back): native
 * radios in a radiogroup, so arrow keys move and the choice is announced. Selected is the teal
 * checked state (DESIGN: checked controls are teal, never plum). Keyboard changes are instant; a
 * pointer press gets scale(0.97) for 100 ms. Targets are 44 px on touch.
 */
export const PRESS =
  "transition-[transform,background-color,border-color,color] duration-100 ease-expo-out active:scale-[0.97] motion-reduce:active:scale-100";

export function ChoiceChips<V extends string>({
  name,
  label,
  options,
  value,
  onChange,
  disabled,
  className,
}: {
  name: string;
  /** The group's accessible name ("Priority"). */
  label: string;
  options: readonly { value: V; label: string }[];
  value: V | null;
  onChange?: (v: V) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("flex flex-wrap gap-2", className)}>
      {options.map((o) => {
        const checked = value === o.value;
        return (
          <label
            key={o.value}
            data-checked={checked || undefined}
            className={cn(
              "text-body-s has-[:focus-visible]:shadow-focus inline-flex min-h-11 cursor-pointer items-center rounded-full border px-3 select-none sm:min-h-8",
              PRESS,
              checked
                ? "border-teal-600 bg-teal-50 font-medium text-teal-800"
                : "border-border text-foreground bg-transparent",
              disabled && "pointer-events-none opacity-50",
            )}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={checked}
              disabled={disabled}
              onChange={() => onChange?.(o.value)}
              className="sr-only"
            />
            {o.label}
          </label>
        );
      })}
    </div>
  );
}

import type { ProviderCard as Provider } from "@/lib/patient/discover";
import Link from "next/link";
import { ArrowUpRightIcon, StarIcon, StethoscopeIcon } from "lucide-react";

import { formatShortDate } from "@/lib/patient/booking-format";
import { cn } from "@/lib/utils";

/**
 * A clinician the patient could pick — the reference design's doctor card,
 * in MedSync's palette (ADR 0085 §1–§2, §4).
 *
 * What it may say is bounded by what the tables hold. A clinician with no
 * `visit_ratings` rows reads "No ratings yet", never a seeded number; a
 * clinician with no `avatar_path` gets a monogram, never a stock face. The
 * reference's "8 Years · 3.5k+ Patients · 2.8k+ Reviews" strip is not
 * reproduced: no table holds years of service or a patient count, and
 * ADR 0085 rules that a reference's fullness is earned, not printed. What
 * replaces it is true — the rating, the soonest open day, and continuity.
 *
 * "Seen you before" is the one badge that earns its place ahead of a rating
 * (PRD §2.7): continuity with a clinician who knows the patient is worth more
 * than a star average, and it is the first sort key.
 */
export function ProviderCard({ provider }: { provider: Provider }) {
  const initials = initialsOf(provider.fullName);

  return (
    <Link
      href={`/patient/clinician/${provider.userId}`}
      className={cn(
        "group bg-card dark:shadow-card ease-expo-out duration-fast relative flex min-w-56 flex-col gap-3 rounded-xl p-4 shadow-xs transition-shadow",
        "hover:shadow-card focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
      )}
    >
      {/* The face, on plum's lightest tint — who this is, a place colour
          (ADR 0097) — and a flat surface, not the reference's gradient:
          DESIGN-medsync.md forbids decorative grounds. */}
      <span
        data-place
        className="bg-plum-50 relative grid aspect-[4/3] w-full place-items-center overflow-hidden rounded-lg"
      >
        {provider.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- a signed, expiring Supabase URL: next/image would need the host allow-listed and would re-fetch it server-side
          <img
            src={provider.photoUrl}
            alt=""
            className="size-full object-cover"
            loading="lazy"
            decoding="async"
          />
        ) : initials ? (
          <span className="text-plum-700 text-heading-m font-mono font-medium">{initials}</span>
        ) : (
          <StethoscopeIcon strokeWidth={1.5} className="text-plum-700 size-7" aria-hidden />
        )}
      </span>

      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-foreground text-body-m truncate font-medium">
          {provider.fullName}
        </span>
        <span className="text-muted-foreground text-body-s truncate">
          {provider.departmentName}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {provider.rating ? (
          <span className="text-foreground text-body-s inline-flex items-center gap-1">
            {/* Outlined, like every icon (DESIGN § Icons), and ink: a
                rating is information, and teal on this card means "open". */}
            <StarIcon className="text-foreground size-3.5" aria-hidden strokeWidth={1.5} />
            <span className="font-mono tabular-nums">{provider.rating.average.toFixed(1)}</span>
            <span className="text-muted-foreground">
              · {provider.rating.count} {provider.rating.count === 1 ? "review" : "reviews"}
            </span>
          </span>
        ) : (
          <span className="text-muted-foreground text-body-s">No ratings yet</span>
        )}
      </div>

      <div className="flex items-end justify-between gap-2">
        <span className="text-muted-foreground text-body-s">
          {provider.firstOpenDate ? (
            <>
              Next open{" "}
              <span className="text-foreground font-medium">
                {formatShortDate(`${provider.firstOpenDate}T12:00:00Z`)}
              </span>
            </>
          ) : (
            "No days open here yet"
          )}
        </span>
        <span
          aria-hidden
          className="bg-brand-900 text-brand-50 ease-expo-out duration-fast grid size-9 shrink-0 place-items-center rounded-full transition-transform group-hover:-translate-y-0.5"
        >
          <ArrowUpRightIcon className="size-4" strokeWidth={2} />
        </span>
      </div>

      {/* Continuity, stated in words — never colour alone (DESIGN anti-patterns). */}
      {provider.seenBefore ? (
        <span className="bg-card text-foreground text-caption absolute top-6 right-6 rounded-full px-2 py-0.5 font-medium">
          Seen you before
        </span>
      ) : null}
    </Link>
  );
}

/** Up to two initials. Null when the name is a placeholder we should not monogram. */
function initialsOf(name: string): string | null {
  if (name === "Your clinician") return null;
  const letters = name
    .split(/\s+/)
    .map((part) => part[0])
    .filter((ch): ch is string => !!ch && /\p{L}/u.test(ch))
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return letters || null;
}

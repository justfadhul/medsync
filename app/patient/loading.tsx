import { Skeleton } from "@/components/ui/skeleton";

/**
 * Home's silhouette: the greeting, the symptom area, the two doors, and the
 * right column's three blocks — the same grid as the page, so nothing moves
 * when the content lands.
 *
 * Every heavy child route has its own loading file, so this one only has to
 * match home — it used to fire for Track, Visits, Hospitals and Profile too,
 * flashing a shape none of them settle into.
 */
export default function Loading() {
  return (
    <div className="grid gap-6 @5xl/page:grid-cols-[minmax(0,1fr)_20rem] @5xl/page:gap-x-8">
      <div className="flex min-w-0 flex-col gap-6">
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-8 w-52" />
          <Skeleton className="h-4 w-full max-w-[48ch]" />
        </div>
        <div className="flex flex-col gap-3">
          <Skeleton className="h-5 w-36" />
          <div className="grid gap-2 @2xl/page:grid-cols-2">
            <Skeleton className="h-12 rounded-lg" />
            <Skeleton className="h-12 rounded-lg" />
            <Skeleton className="h-12 rounded-lg" />
            <Skeleton className="h-12 rounded-lg" />
          </div>
          <Skeleton className="h-12 w-52 rounded-md" />
        </div>
        <div className="flex flex-col gap-3">
          <Skeleton className="h-5 w-24" />
          <div className="grid gap-3 @xl/page:grid-cols-[3fr_2fr]">
            <Skeleton className="h-18 rounded-xl" />
            <Skeleton className="h-18 rounded-xl" />
          </div>
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-6">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex flex-col gap-3">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-14 rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );
}

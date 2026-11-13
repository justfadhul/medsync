import { COMING } from "@/content/tether-landing/copy";
import { cn } from "@/lib/utils";
import styles from "./sections.module.css";

/**
 * Coming after booking (Step 5): a navy band with three things that are next and not live. The phone shows
 * them as three swipeable cards marked "Soon". "See the future of Tether" stays hidden (D-LP-10).
 */
export function Coming() {
  return (
    <section className="mx-auto max-w-[1080px] px-5 pb-24 max-[760px]:px-0 max-[760px]:pt-[52px] max-[760px]:pb-0">
      <div className="bg-pw-band text-pw-on-band grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] items-start gap-10 rounded-[28px] p-14 max-[760px]:mx-5 max-[760px]:block max-[760px]:px-0 max-[760px]:py-7">
        <div className="max-[760px]:px-[22px]">
          <span className="text-pw-on-band-2 inline-flex items-center gap-2 text-[12px] leading-4 font-semibold tracking-[0.06em] uppercase">
            <i aria-hidden="true" className="bg-pw-accent block size-2 rounded-full" />
            {COMING.kicker}
          </span>
          <h2 className="mt-3.5 text-[clamp(28px,3.6vw,44px)] leading-[1.08] font-medium tracking-[-0.03em] max-[760px]:text-[28px] max-[760px]:leading-8">
            {COMING.title}
          </h2>
          <p className="text-pw-on-band-2 mt-3.5 max-w-[34ch]">
            <span className="max-[760px]:hidden">{COMING.body}</span>
            <span className="min-[761px]:hidden">{COMING.bodyPhone}</span>
          </p>
        </div>
        <ul
          className={cn(
            styles.snap,
            "grid max-[760px]:mt-5 max-[760px]:flex max-[760px]:scroll-px-[22px] max-[760px]:gap-3 max-[760px]:overflow-x-auto max-[760px]:px-[22px]",
          )}
        >
          {COMING.items.map((it, i) => (
            <li
              key={it.title}
              className={cn(
                "min-[761px]:border-pw-band-glass grid gap-0.5 py-[18px] min-[761px]:border-t",
                i === 0 && "min-[761px]:border-t-0 min-[761px]:pt-0",
                "max-[760px]:bg-pw-band-glass max-[760px]:flex-[0_0_78%] max-[760px]:content-start max-[760px]:rounded-[22px] max-[760px]:p-[18px]",
              )}
            >
              <span className="bg-pw-on-band-2 text-pw-band mb-2 w-fit rounded-full px-2.5 py-0.5 text-[12px] leading-4 font-semibold min-[761px]:hidden">
                {COMING.soon}
              </span>
              <b className="text-[18px] font-semibold">{it.title}</b>
              <span className="text-pw-on-band-2 text-[16px] leading-[23px]">
                {"bodyPhone" in it ? (
                  <>
                    <span className="max-[760px]:hidden">{it.body}</span>
                    <span className="min-[761px]:hidden">{it.bodyPhone}</span>
                  </>
                ) : (
                  it.body
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

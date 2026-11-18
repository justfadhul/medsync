import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FootprintsIcon, SmileIcon, UtensilsIcon } from "lucide-react";

import { ICON } from "@/components/tide/kit";
import { PageHeader } from "@/components/tide/shell";
import { HOME_V2_COPY } from "@/content/patient-app/home";
import { patientFlag } from "@/lib/patient-web/flags";
import { requirePatientScope } from "@/lib/patient/scope";

export const metadata: Metadata = { title: "Wellness" };

const W = HOME_V2_COPY.wellness;

/**
 * Wellness, v2 on the web (gate A4): the patient's own logging (move, mood, eat), shared by both modes. Each
 * opens the page that already does it; nothing here reaches the care team.
 */
export default async function WellnessPage() {
  if (!patientFlag("appV2Web")) notFound();
  await requirePatientScope();
  const items = [
    { href: "/patient/care/move", title: W.move, note: W.moveNote, Icon: FootprintsIcon },
    { href: "/patient/mood", title: W.mood, note: W.moodNote, Icon: SmileIcon },
    { href: "/patient/care/move?tab=eat", title: W.eat, note: W.eatNote, Icon: UtensilsIcon },
  ] as const;
  return (
    <>
      <PageHeader title={W.title} subtitle={W.note} />
      <ul className="grid grid-cols-1 gap-4 min-[834px]:grid-cols-3">
        {items.map(({ href, title, note, Icon }) => (
          <li key={href}>
            <Link
              href={href}
              className="rounded-pw-card bg-pw-surface shadow-pw-card hover:bg-pw-surface-2 focus-visible:outline-pw-focus flex h-full flex-col gap-2 p-5 focus-visible:outline-2"
            >
              <Icon className="text-pw-accent-text size-6" {...ICON} />
              <span className="text-[17px] font-semibold">{title}</span>
              <span className="text-pw-ink-2 text-[14px]">{note}</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

import type { MeSection } from "./_components/me-view";
import type { Metadata } from "next";
import {
  ageWords,
  cardLines,
  cardNumber,
  initials,
  sexLetter,
  splitHistory,
} from "@patient-core/me-health";
import { placesSummary } from "@patient-core/me-places";
import { memberNumber, plansFrom, tierNow } from "@patient-core/membership";

import { TextLink } from "@/components/tide/kit";
import { ME_COPY as C } from "@/content/patient/me";
import { ME_WEB_COPY as M } from "@/content/patient/me-web";
import { loadMedicines } from "@/lib/patient-web/day";
import { careModeOn, patientFlag } from "@/lib/patient-web/flags";
import {
  loadCardIdentity,
  loadHistory,
  loadOnFile,
  loadPlaces,
  loadRecords,
  loadSms,
} from "@/lib/patient-web/me-data";
import { loadMembership } from "@/lib/patient-web/membership-v2";
import { myMobile } from "@/lib/patient-web/visit-v2";
import { fetchHousehold } from "@/lib/patient/household";
import { requirePatientScope } from "@/lib/patient/scope";
import pkg from "@/package.json";
import { MeMembership } from "./_components/me-membership";
import { MeView } from "./_components/me-view";
import {
  DetailsSection,
  HealthSection,
  PeopleSection,
  PlacesSection,
  RecordsSection,
} from "./_components/sections";

export const metadata: Metadata = { title: "Me" };
export const dynamic = "force-dynamic";

/**
 * Me (the phone's (tabs)/me.tsx): the health card, my health, the people I book for, places, details,
 * privacy and the app's settings. Every read is a convenience: one that fails leaves its row honest
 * ("Not switched on yet", or the empty words) and the page still draws. Not on the web: the profile photo
 * (no upload path here yet) and the phone's push row (the web has no push).
 */
export default async function MePage({ searchParams }: { searchParams: Promise<{ s?: string }> }) {
  const { s } = await searchParams;
  const scope = await requirePatientScope();
  const now = new Date();
  const [id, history, places, meds, household, smsOn, onFile, records] = await Promise.all([
    loadCardIdentity(scope.userId).catch(() => null),
    loadHistory(scope.userId).catch(() => ({ status: "error" as const })),
    loadPlaces(scope.userId).catch(() => ({ status: "error" as const })),
    loadMedicines(scope.userId).catch(() => null),
    fetchHousehold(scope.userId).catch(() => null),
    loadSms(scope.userId).catch(() => null),
    loadOnFile().catch(() => null),
    loadRecords(scope.userId).catch(() => null),
  ]);

  const name = scope.fullName?.trim() || null;
  const facility = id?.facility ?? scope.primaryHospitalName;
  const h = splitHistory(history.status === "ready" ? history.value : []);
  const lines = cardLines(h, id?.conditions ?? []);
  const hOff = history.status === "off";
  const nok = onFile?.ok ? onFile.onFile.nokOnFile : null;
  const language = onFile?.ok ? onFile.onFile.preferredLanguage?.trim() || null : null;
  const emergencyPhone = id?.emergencyPhone ?? scope.emergencyEntrancePhone;

  // Patient app v2 (Step 10), behind appV2Web: the membership card, plans, trial and Plus payment.
  const v2 = patientFlag("appV2Web");
  const [membership, msisdn] = v2
    ? await Promise.all([loadMembership().catch(() => null), myMobile().catch(() => null)])
    : [null, null];
  const held = tierNow(membership?.row ?? null, now);
  const endsLabel = held.endsIso
    ? new Date(new Date(held.endsIso).getTime() + 3 * 3600_000).toISOString().slice(0, 10)
    : null;

  const membershipCard = v2 ? (
    <MeMembership
      tier={held.tier}
      trial={held.trial}
      endsLabel={endsLabel}
      trialUsed={membership?.row?.trialUsed ?? false}
      name={name ?? C.holderUnknown}
      memberNo={memberNumber(id?.code ?? null)}
      id={{
        ageSex:
          [ageWords(id?.dob ?? null, now), sexLetter(id?.sex ?? null)]
            .filter(Boolean)
            .join(" · ") || null,
        nextOfKin: nok === null ? null : nok ? C.nokOnFile(facility) : C.nokNone,
        ifFound:
          emergencyPhone && facility
            ? C.ifFoundCall(facility, emergencyPhone)
            : C.ifFoundReturn(facility),
        emergencyContact: emergencyPhone ?? "—",
        bloodGroup: null,
        allergies: lines.allergies === "None listed" ? [] : [lines.allergies],
        conditions: lines.conditions === "None listed" ? [] : [lines.conditions],
        hospitalLine: facility ?? "—",
      }}
      plans={plansFrom(membership?.prices ?? [], now.toISOString().slice(0, 10))}
      msisdn={msisdn}
      card={{
        holder: name ?? C.holderUnknown,
        number: cardNumber(id?.code ?? null),
        facility,
        age: ageWords(id?.dob ?? null, now),
        sex: sexLetter(id?.sex ?? null),
        conditions: null,
        allergies: lines.allergies,
        nextOfKin: nok === null ? null : nok ? C.nokOnFile(facility) : C.nokNone,
        ifFound:
          emergencyPhone && facility
            ? C.ifFoundCall(facility, emergencyPhone)
            : C.ifFoundReturn(facility),
      }}
    />
  ) : undefined;
  const conditions = C.historySub(
    hOff,
    h.conditions.length,
    "condition",
    "conditions",
    C.noneAdded,
  );
  const careOn = careModeOn();

  return (
    <>
      <MeView
        initial={(s ?? "card") as MeSection}
        tier={v2 ? held.tier : null}
        card={{
          holder: name ?? C.holderUnknown,
          number: cardNumber(id?.code ?? null),
          facility,
          age: ageWords(id?.dob ?? null, now),
          allergies: lines.allergies,
          nextOfKin: nok === null ? null : nok ? C.nokOnFile(facility) : C.nokNone,
          ifFound:
            emergencyPhone && facility
              ? C.ifFoundCall(facility, emergencyPhone)
              : C.ifFoundReturn(facility),
        }}
        cardConditions={lines.conditions}
        sex={sexLetter(id?.sex ?? null)}
        hero={{
          initials: initials(name),
          name: name ?? C.holderUnknown,
          line: [
            facility,
            ageWords(id?.dob ?? null, now),
            sexLetter(id?.sex ?? null),
            id?.code ? M.memberNo(memberNumber(id.code)) : null,
          ]
            .filter(Boolean)
            .join(" · "),
          stats: [
            {
              section: "health",
              n: hOff ? "–" : String(h.conditions.length),
              label: M.stats.conditions,
            },
            {
              section: "health",
              n: hOff ? "–" : String(h.allergies.length),
              label: M.stats.allergies,
            },
            {
              section: "people",
              n: household ? String(household.length) : "–",
              label: M.stats.people,
            },
            {
              section: "records",
              n: records ? String(records.length) : "–",
              label: M.stats.records,
            },
          ],
        }}
        subs={{
          card: M.sections.card.sub,
          health: conditions,
          records: C.recordsSub,
          people: household
            ? C.historySub(false, household.length, "person", "people", C.nobody)
            : undefined,
          places:
            places.status === "off"
              ? C.placesOff
              : places.status === "ready"
                ? C.placesSub(placesSummary(places.value))
                : C.placesFailed,
          details: C.detailsSub,
          settings: M.sections.settings.sub,
        }}
        panes={{
          card: membershipCard,
          health: (
            <HealthSection
              history={history}
              legacyConditions={id?.conditions ?? []}
              sex={id?.sex ?? null}
              medicinesSub={C.medicinesSub(meds?.meds.length ?? 0)}
            />
          ),
          ...(careOn
            ? {
                mycare: <TextLink href="/patient/care/my-care">{M.sections.mycare.title}</TextLink>,
              }
            : {}),
          records: <RecordsSection records={records} />,
          people: <PeopleSection members={household} />,
          places: <PlacesSection places={places} />,
          details: <DetailsSection onFile={onFile} hospitalName={scope.primaryHospitalName} />,
        }}
        language={C.languageSub(language)}
        smsOn={smsOn}
        version={pkg.version}
        v2={v2}
      />
    </>
  );
}

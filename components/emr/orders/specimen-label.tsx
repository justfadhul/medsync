import type { PatientIdentity } from "./model";

/**
 * The specimen label (gate-a E.8): two identifiers, age and sex, the test, the container and the
 * collection time, the requisition and priority. Print CSS only, sized for a small label roll;
 * black on white. On screen it previews at the same proportions beside a Print button.
 */
export interface LabelData {
  identity: PatientIdentity;
  /** "03 Feb 1974", when the date of birth is recorded. */
  dob: string | null;
  test: string;
  container: string | null;
  /** "12 Mar 2026 10:44" in the hospital's zone. */
  collectedAt: string;
  requisitionNo: string | null;
  priority: string | null;
  labelNo: string | null;
}

export const LABEL_CSS = `@media print {
  @page { size: 60mm 30mm; margin: 2mm; }
  body *:not(:has([data-label-root])):not([data-label-root]):not([data-label-root] *) { display: none !important; }
  body *:has([data-label-root]) { margin: 0 !important; padding: 0 !important; border: 0 !important; box-shadow: none !important; position: static !important; background: white !important; }
  [data-label-root], [data-label-root] * { color: black !important; background: white !important; }
  [data-label-root] { border: 0 !important; width: 56mm !important; padding: 0 !important; }
}`;

/** "NAKATO, Amina": the surname first and in capitals, the way labels are read at the bench. */
export function labelName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name.toUpperCase();
  const surname = parts.at(-1)!;
  return `${surname.toUpperCase()}, ${parts.slice(0, -1).join(" ")}`;
}

export function SpecimenLabel({ data }: { data: LabelData }) {
  const [age, sex] = data.identity.ageSex.split(" · ");
  return (
    <div
      data-label-root
      className="text-caption flex w-[240px] flex-col gap-0.5 rounded-sm border border-gray-300 bg-white p-2 font-mono leading-tight text-black tabular-nums"
    >
      <p className="flex flex-wrap justify-between gap-x-2 font-medium">
        <span>{labelName(data.identity.name)}</span>
        <span>{data.identity.mrn}</span>
      </p>
      <p className="flex flex-wrap gap-x-2">
        <span>{age}</span>
        <span>{sex}</span>
        {data.dob ? <span>DOB {data.dob}</span> : null}
      </p>
      <p className="flex flex-wrap gap-x-2">
        <span>{data.test}</span>
        {data.container ? <span>{data.container}</span> : null}
        <span>{data.collectedAt}</span>
      </p>
      <p className="flex flex-wrap gap-x-2">
        {data.requisitionNo ? <span>Req {data.requisitionNo}</span> : null}
        {data.priority ? <span>{data.priority}</span> : null}
        {data.labelNo ? <span>Label {data.labelNo}</span> : null}
      </p>
    </div>
  );
}

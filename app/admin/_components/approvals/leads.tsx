import { HOSPITAL_REVIEW } from "@/content/onboarding-hospital";

const L = HOSPITAL_REVIEW.leads;

export interface LeadRow {
  id: string;
  hospitalName: string;
  district: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  source: string | null;
  createdAt: Date;
}

/** Hospital leads (D15), read-only: the latest 20, under the approvals queue. Superadmin only. */
export function HospitalLeads({ leads }: { leads: readonly LeadRow[] }) {
  return (
    <section
      aria-labelledby="hospital-leads"
      className="mx-auto w-full max-w-300 px-4 pt-10 pb-12 sm:px-8"
    >
      <h2 id="hospital-leads" className="text-heading-s text-foreground">
        {L.title}
      </h2>
      <p className="text-body-s text-muted-foreground mt-1">{L.lead}</p>
      <div className="border-border bg-card mt-4 overflow-x-auto rounded-lg border">
        {leads.length === 0 ? (
          <p className="text-body-s text-muted-foreground px-4 py-6 text-center">{L.empty}</p>
        ) : (
          <table className="text-body-s w-full min-w-[40rem] text-left">
            <thead className="text-muted-foreground bg-gray-50 text-[11.5px] dark:bg-gray-900">
              <tr>
                {[L.hospital, L.district, L.contact, L.source, L.received].map((h) => (
                  <th key={h} scope="col" className="px-4 py-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id} className="border-border/60 border-t align-top">
                  <td className="text-foreground px-4 py-2.5 font-medium">{l.hospitalName}</td>
                  <td className="text-muted-foreground px-4 py-2.5">{l.district ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    <span className="text-foreground block">{l.contactName ?? "—"}</span>
                    {[l.contactPhone, l.contactEmail].filter(Boolean).map((c) => (
                      <span key={c} className="text-muted-foreground block font-mono text-[12px]">
                        {c}
                      </span>
                    ))}
                  </td>
                  <td className="text-muted-foreground px-4 py-2.5">
                    {(l.source && L.sources[l.source]) ?? l.source ?? "—"}
                  </td>
                  <td className="text-muted-foreground px-4 py-2.5 font-mono text-[12px] tabular-nums">
                    {l.createdAt.toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

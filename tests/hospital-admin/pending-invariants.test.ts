import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The Pending list is a signal about the clinic, never a patient record.
 * Source-level, like reports-invariants: the rules are about what the lib
 * may SELECT and what the dialog may do with a row, and the dev DB carries
 * no pending rows to assert against.
 */
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const LIB = "lib/hospital-admin/pending.ts";
const DIALOG = "app/hospital-admin/scheduling/_components/pending-dialog.tsx";
const PAGE = "app/hospital-admin/scheduling/page.tsx";

describe("the pending lib selects a patient's code and nothing else about them", () => {
  const src = stripComments(read(LIB));
  const select = src.slice(src.indexOf(".select({"), src.indexOf(".from(appointments)"));

  it("is server-only and scoped to one hospital's pending_approval rows", () => {
    expect(src).toMatch(/^import "server-only";/);
    expect(src).toContain("eq(appointments.hospitalId, hospitalId)");
    expect(src).toContain('eq(appointments.status, "pending_approval")');
    expect(src).toContain("asc(appointments.createdAt)");
  });

  it("names the clinician, and the patient only by code", () => {
    expect(select).toContain("clinicianName: users.fullName");
    expect(select).toContain("patientCode: patientProfiles.patientCode");
    // The only `users.` column is the clinician's; nothing else names a person.
    expect(select.match(/users\.\w+/g)).toEqual(["users.fullName"]);
    for (const needle of [
      "firstName",
      "surname",
      "lastName",
      "phone",
      "Phone",
      "reasonNote",
      "bookingCode",
      "patientUserId",
      "provisionalPatientId",
      "declaredName",
      "nok",
      "idNumber",
      "dateOfBirth",
    ]) {
      expect(select, `select list mentions ${needle}`).not.toContain(needle);
    }
  });

  it("never reaches the provisional patient's row, which is all PHI", () => {
    expect(src).not.toContain("provisionalPatients");
    expect(src).not.toMatch(/decrypt/i);
  });
});

describe("the dialog shows rows as they came, and colours only the clinic's delay", () => {
  const src = stripComments(read(DIALOG));

  it("does not sort — no column is sortable and no sort state exists", () => {
    expect(src).not.toContain("sortable");
    expect(src).not.toContain("onSortChange");
    expect(src).not.toMatch(/\.sort\(/);
  });

  it("gives a tone only to waiting time and to the appointment's priority", () => {
    const tones = [...src.matchAll(/<Pill tone="(\w+)">(\w+)<\/Pill>/g)].map(
      (m) => `${m[1]}:${m[2]}`,
    );
    expect(tones.sort()).toEqual(["critical:Urgent", "notice:Stale"]);
    // Stale is measured from createdAt — the clinic's clock, not a patient attribute.
    expect(src).toMatch(/now - r\.createdAt\.getTime\(\)/);
    expect(src).not.toMatch(/patientCode\s*[=!]==/);
  });

  it("says what waits, says who acts, and says when nothing does", () => {
    expect(src).toContain("Awaiting a clinician");
    expect(src).toContain("Nothing is waiting for a clinician.");
    expect(src).toContain("Clinicians confirm or decline these from their own schedule.");
    // Read-only: nothing in the dialog posts.
    expect(src).not.toMatch(/useActionState|<form|action=/);
  });
});

describe("the scheduling page opens the Pending stat", () => {
  const page = stripComments(read(PAGE));

  it("fetches the rows inside the scope and renders PendingDialog in the strip", () => {
    const scopeAt = page.indexOf("await requireHospitalAdminScope()");
    const fetchAt = page.indexOf("fetchPendingRequests(scope.hospitalId)");
    expect(scopeAt).toBeGreaterThan(-1);
    expect(fetchAt).toBeGreaterThan(scopeAt);
    expect(page).toMatch(
      /<PendingDialog rows=\{pending\} value=\{stats\?\.pendingApproval \?\? pending\.length\}/,
    );
    // The old static card is gone: no StatCard labelled Pending remains.
    expect(page).not.toMatch(/<StatCard\s+label="Pending"/);
  });
});

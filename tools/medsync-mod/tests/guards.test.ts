import { expect, test } from "claude-code/testing";

import * as g from "../hooks/guards";

test("emergency scan flags questions, symptoms and severity, not signposting", () => {
  const found = g.scanEmergency([
    "<Text>Are you bleeding heavily?</Text>",
    '"Chest pain, fever or fits"',
    "label: 'How bad is it, mild or severe'",
    "<Text>Call 911 or go to the nearest emergency unit now.</Text>",
    "const x = a?.b ?? c ? d : e",
  ]);
  expect(found).toHaveLength(3);
  expect(found[0]!.why).toContain("question");
  expect(found[1]!.why).toContain("symptom");
  expect(found[2]!.why).toContain("severity");
});

test("patient data: real-looking numbers, NINs and name + DOB; synthetic passes", () => {
  expect(g.findPhi("call +256 772 123 456").map((f) => f.why)).toEqual(["Ugandan phone number"]);
  expect(g.findPhi("call 0772123456")).toHaveLength(1);
  expect(g.findPhi("NIN CM92018104ABCD")).toHaveLength(1);
  expect(g.findPhi("Sarah Namubiru DOB 12/03/1990")).toHaveLength(1);
  expect(
    g.findPhi(`${g.SYNTHETIC.phone} ${g.SYNTHETIC.nin} ${g.SYNTHETIC.name} ${g.SYNTHETIC.dob}`),
  ).toHaveLength(0);
  expect(g.findPhi(g.synthesize("Sarah Namubiru 12/03/1990 +256772123456"))).toHaveLength(0);
});

test("destructive commands and git holds", () => {
  expect(g.destructive("rm -rf dist")).toBe("rm -rf");
  expect(g.destructive("rm -fr node_modules")).toBe("rm -rf");
  expect(g.destructive('psql -c "DROP TABLE patients"')).toBe("DROP/TRUNCATE");
  expect(g.destructive("supabase db reset")).toBe("migration reset");
  expect(g.destructive("git push --force origin main")).toBe("git push --force");
  expect(g.destructive("git push origin main")).toBeNull();
  expect(g.destructive("rm file.txt")).toBeNull();
  expect(g.gitOp('git commit -m "x"')).toBe("git commit");
  expect(g.gitOp("npm run db:migrate")).toBe("npm run db:migrate");
  expect(g.gitOp("git status")).toBeNull();
});

test("shell writes and installs", () => {
  expect(g.bashWriteTargets('echo hi > lib/a.ts && sed -i "" s/a/b/ lib/b.ts 2>/dev/null')).toEqual(
    ["lib/a.ts", "lib/b.ts"],
  );
  expect(g.bashWriteTargets("cat a | tee out.txt")).toEqual(["out.txt"]);
  expect(g.installedPackages("npm install lodash dayjs --save")).toEqual(["lodash", "dayjs"]);
  expect(g.depsAdded('{"dependencies":{"a":"1"}}', '{"dependencies":{"a":"1","b":"2"}}')).toEqual([
    "b",
  ]);
});

test("routing fast rules", () => {
  const clinical = /dos(e|ing)|mg\/kg|triage|emergency/i;
  expect(g.fastRoute("Change the paracetamol mg/kg dosing table", clinical)?.tier).toBe("strong");
  expect(g.fastRoute("what does proxy.ts do?", clinical)?.tier).toBe("fast");
  expect(
    g.fastRoute("Build the ward builder export with tests and a migration", clinical),
  ).toBeNull();
  expect(g.changedKeys('{"a":"x","b":"y"}', '{"a":"x2","b":"y","c":"z"}')).toEqual(["a", "c"]);
});

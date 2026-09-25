/* eslint-disable no-console -- CLI script: console output is the UI. */
// The onboarding funnel report (Onboarding v2, D16/EV). Reads public.onboarding_events — form,
// event, section, field key, error code, elapsed ms; never a value or a person.
//   node --env-file=.env.local scripts/onboarding-funnel.mjs [days=30]
import postgres from "postgres";

const days = Number(process.argv[2] ?? 30);
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
try {
  const funnel = await sql`
    select form,
           count(distinct tab_id) filter (where event = 'start')::int            as started,
           count(distinct tab_id) filter (where event = 'submit_attempt')::int   as tried,
           count(distinct tab_id) filter (where event = 'submit_ok')::int        as submitted,
           percentile_cont(0.5) within group (order by elapsed_ms)
             filter (where event = 'submit_ok')                                   as median_ms
      from public.onboarding_events
     where created_at > now() - make_interval(days => ${days})
     group by form order by form`;
  console.log(`Onboarding funnel, last ${days} days`);
  console.table(
    funnel.map((r) => ({
      form: r.form,
      started: r.started,
      "pressed submit": r.tried,
      submitted: r.submitted,
      completion: r.started ? `${Math.round((100 * r.submitted) / r.started)}%` : "—",
      "median time": r.median_ms ? `${Math.round(r.median_ms / 1000)} s` : "—",
    })),
  );
  const errors = await sql`
    select form, field_key, error_code, count(*)::int as n
      from public.onboarding_events
     where event = 'field_error' and created_at > now() - make_interval(days => ${days})
     group by 1, 2, 3 order by n desc limit 15`;
  console.log("Fields that fail most");
  console.table(errors);
  const sections = await sql`
    select form, section, count(distinct tab_id)::int as completed
      from public.onboarding_events
     where event = 'section_complete' and created_at > now() - make_interval(days => ${days})
     group by 1, 2 order by 1, 3 desc`;
  console.log("Sections completed");
  console.table(sections);
} finally {
  await sql.end();
}

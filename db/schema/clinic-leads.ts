import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/** "Register your clinic" on the Tether landing page (migration 0293, D-LP-09). Superadmin-read only. */
export const clinicLeads = pgTable(
  "clinic_leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    source: text("source").notNull().default("landing"),
    userAgentHash: text("user_agent_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("clinic_leads_created_idx").on(t.createdAt)],
);

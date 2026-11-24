/**
 * The duty rota: every visible string. The rota is what was planned, never proof that someone is present.
 * Draft wording: awaiting CSO sign-off.
 */

export const DUTY_ROTA_COPY = {
  state: {
    planned: "On the rota",
    in_post: "On duty (rostered)",
    past: "Past",
    ended_early: "Ended early",
    needs_cover: "Needs cover",
  },
  shift: {
    day: { label: "Day", hours: "08:00–17:00" },
    night: { label: "Night", hours: "17:00–08:00" },
    day24: { label: "24 hours", hours: "08:00–08:00" },
    week: { label: "Week", hours: "08:00 to 08:00, seven days" },
  },
  /** The guard's refusals, by HINT (migrations 0307 and 0309). */
  refusal: {
    rota_grade: "Their grade does not fit this post.",
    rota_leave: "They are on leave during this duty.",
    rota_double: "They already hold this post at that time.",
    rota_full: "This post is full at that time.",
    rota_cover: "A cover or swap must replace a duty on the same post.",
    rota_maker: "Only the hospital admin or the head of department makes this rota.",
    rota_locked: "This week is published. Change it through a cover or swap request.",
  },
  plannedNotPresent: "Rostered, not confirmed present.",
  off: "The duty rota is not switched on at this hospital.",
  notFound: "That post or duty is no longer open on this rota.",
  unnamed: "Name not recorded",
} as const;

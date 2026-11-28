# Tag and StatusTag

Small pills that label. `Tag` names a thing; `StatusTag` is the only part that carries state.

**Tag**

- `plain` for a category, `accent` for "New", `navy` for membership, `outline` for a place or clinic.
- `area` adds the place dot (readings, medicines, visits, team, me): a dot beside the word, never a fill behind it.
- Never carries health or workflow state.

**StatusTag**

- Always an icon and a word: the word is a required string, so state is never colour alone.
- `stable` "In your range", `caution` "Above your target", `critical` "Danger": these three are health and are owned by the Clinical Safety Officer. Use them for readings and emergencies only.
- `pending` for waiting, offline and loading (grey, never amber or red). `info` for neutral notices such as "Changed since printing".

**Don't**

- Use red, amber or green for a workflow state ("Late", "Overdue" are `pending` or `info` with their word).
- Use a StatusTag as a button.

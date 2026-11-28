# Button

The pill that does something. `Button` acts, `ButtonLink` navigates. Behaviour from Base UI Button.

**When to use which tone**

- `primary`: the main action of a form or card ("Save reading"). Navy in light, near-white in Navy.
- `accent`: lagoon, the one thing to do now on the screen ("Book a visit"). One per screen region; if two things look like the main action, one is wrong.
- `soft` and `outline`: secondary actions beside a main one ("Keep draft", "Add to calendar").
- `quiet`: a text action in a row or card ("Change", "Add").
- `danger`: only Help and "Get help now". Never for delete or cancel.

**States (Set 1.1).** Hover and press come from one state layer in the button's own text colour (8% and 14%), so every tone and both themes answer the same way; red keeps a darker red. A disabled button never presses. Inside a `Band` every tone takes its band form and the focus ring turns light. Long labels wrap. Every tone keeps an edge in high-contrast mode, and type follows the reader's text size.

**Sizes.** `l` for the main action, `m` for most others, `s` inside rows. Patient density is 52 / 44 / 36 px (the smaller two keep a 48 px hit area); desk density is 40 / 36 / 30 px. Density comes from the surface's `KitRoot`, never a prop.

**What you provide**

- The word, in sentence case, saying what happens ("Move and tell the patient"). An icon may sit before it, never alone.
- `disabledReason` instead of `disabled`: the reason shows under the button and is read with it. A button that cannot be pressed always says why.
- `busy` while the action runs: a second press is blocked at once; after 400 ms the word gives way to a spinner, and screen readers hear `busyLabel` (default "Working").
- `wide` for the main action at the foot of a phone screen: it fills the column.

**Don't**

- Colour a button with a place hue, amber or green.
- Put two `accent` buttons in one region.
- Use `danger` for destructive actions; those are `outline` with a confirming dialog.

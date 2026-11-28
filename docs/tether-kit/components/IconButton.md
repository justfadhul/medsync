# IconButton

A round button with only a glyph, for the few glyphs everyone reads: close, more, and the − and + steppers. Everything else is a `Button` with a word, because in Tide every icon carries its word.

**What you provide**

- `label` (required): what it does, read out and shown on hover ("Close", "More").
- `icon`: one Lucide outline icon with `{...ICON}`.
- `tone`: `soft` (default), `outline` or `quiet`. Never accent or danger.

**Size.** 48 px for patients, 36 px at the desk, from the surface's density.

# Field and Input

`Field` gives a control its label, hint and error; `Input` is the box. Behaviour from Base UI Field and Input, so the label names the box and the hint and error are read with it.

**Order:** label, hint, error, box. The error comes before the box (as in GOV.UK's design system), so a phone keyboard never covers it and a screen reader meets it first. It is an icon and a sentence in ink, starting "Error:" for screen readers. Never red: red, amber and green belong to health.

**What you provide**

- `label`: what to enter, as a short noun phrase. Never a placeholder instead.
- `hint` for format, range, or why it is asked ("The 9 digits after +256").
- `error` saying what to fix, with an example ("Enter the 9 digits after +256, for example 772 123 456").
- `optional` on the fields that are. Fields are required unless marked.
- On the box: `prefix` and `suffix` for fixed text (`+256`, `UGX`, `kg`; say it in the hint too), `icon` for search only, `width` (`s` for codes, `m` for names, `full` for addresses), `type="password"` for a Show and Hide word.

**States.** Hover darkens the edge; focus shows the kit's ring and a focus-coloured edge; invalid doubles the edge in ink without moving; disabled is a quiet grey; read-only is a flat box with a hairline. Autofill keeps the kit's colours. Patient boxes use 17 px type, so a phone never zooms on focus.

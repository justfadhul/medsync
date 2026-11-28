# Card and Band

The two surfaces everything sits on.

**Card** is the white object on the grey ground: a visit, a reading, a form section. 22 px corners and 20 px padding for patients, 18 px and 16 px at the desk, lifted by `shadow-card`. Use `flat` for a card inside a card (a hairline instead of a shadow). Cards do not nest more than once.

**Band** is the navy header band: the ticket, the health card, a patient's header at the desk. Text on it uses `on-band` and `on-band-2`; the one lagoon word on a band uses `on-band-accent`.

**What you provide.** The content and its own headings. The surface adds no title, border colour or accent: state shows through a `StatusTag` inside, never a coloured edge.

**Don't**

- Add a coloured left edge or a gradient.
- Put a Band inside a Card.

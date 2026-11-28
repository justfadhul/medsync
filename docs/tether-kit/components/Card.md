# Card and Band

The two surfaces everything sits on.

**Card** is the white object on the grey ground: a visit, a reading, a form section. 22 px corners and 20 px padding for patients, 18 px and 16 px at the desk, lifted by `shadow-card`. Use `flat` for a card inside a card (a hairline instead of a shadow). Cards do not nest more than once.

**Band** is the navy header band: the ticket, the health card, a patient's header at the desk. Text on it uses `on-band` and `on-band-2`; the one lagoon word on a band uses `on-band-accent`.

**CardLink and CardButton (Set 1.1)** are cards the person presses: a visit, a doctor, a clinic. `CardLink` goes somewhere, `CardButton` acts. The whole card is one target with one focus ring; the shadow lifts on hover and a faint layer deepens on press, without movement. One action per card: no second button inside.

**Inside a Band** the colour tokens point at their on-band forms, so any button, tag or focus ring placed on navy adapts by itself.

**What you provide.** The content and its own headings. The surface adds no title, border colour or accent: state shows through a `StatusTag` inside, never a coloured edge.

**Don't**

- Add a coloured left edge or a gradient.
- Put a Band inside a Card.

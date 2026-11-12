# Prescribing and protocols kit

This kit is for adding the prescribing-tool features, and the 10 protocol charts, from the 11 Nov 2026 prototype into MedSync, each where it fits.

## How to use it
1. Copy this folder into the MedSync repo as `docs/prescribing/kit/`.
2. Open Claude Code at the repo root.
3. Paste everything below the line in `PROMPT.md`.

The prompt starts with a recon step. It writes `docs/prescribing/FIT-MAP.md`, which maps every feature to its existing home in the repo (prescriber record, pharmacy queue, nursing tasks and MAR, results, vitals) or marks it "new". Only after that does it build.

| File | What it is |
|---|---|
| `PROMPT.md` | The execution prompt: sources, token discipline, hard rules ("fit, don't fork"), phases P0–P6 with exit checks, definition of done |
| `FEATURES.md` | What to add: <ul><li>§0 maps prototype functions to features</li><li>§1 features F1–F9 with "done when"</li><li>§2 rule sheets for the 10 protocols (seed values)</li><li>§3 safety rules P1–P12</li><li>§4 acceptance scenarios S1–S12</li><li>§5 defaults for open decisions</li></ul> |
| `prototype/Main.dc.html` | The working reference: Prescribe, pharmacy, nurses and Protocols, including the generic chart engine (`pcView`), DKA (`dkView`) and the 9 rule builders (`PC.*`) |
| `prototype/Flow.dc.html` | User flow: the doctor, nurse and pharmacy screens, navigation, and the 8 hand-offs |
| `prototype/Map.dc.html` | Where prescribing lives today |

## Reading the prototype
`.dc.html` files are Design-canvas components:
- The markup sits inside `<x-dc>`, with `{{holes}}`, `<sc-for>` and `<sc-if>`.
- The behaviour is in `class Component` (`renderVals()` and its methods).
- Find things by name (`rg -n "PC.mgso4|pcView\(|actFor\("`) and read the line ranges. The file is large.

To click through it, open the canvas in Claude.

## Clinical sign-off
Every dose, threshold and timing is a prototype value from UCG 2023, JBDS, the UK Kidney Association, WHO and MHRA. The build stores them as draft protocol versions. None can start for a real patient until two clinicians sign that version off. The sliding-scale bands are an example, to be replaced with the hospital's own scale.

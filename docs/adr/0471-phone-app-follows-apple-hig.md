# 0471 — The phone app follows Apple's Human Interface Guidelines

Date: 2026-11-01 · Status: accepted (owner, in chat)

## Decision

The patient phone app meets Apple's HIG as a hard floor, under the Tide design system:

- **Touch:** every control takes at least a 44 × 44 pt touch. `Press` grows its hit region around anything drawn smaller (`minHitSlop`), so no caller has to remember.
- **Type:** nothing below 11 pt, Apple's iOS minimum. Text scales with the phone's text size (no caps), and fixed-height cards that hold text (the doctor badge) take a floor instead of a fixed height.
- **Contrast:** real text is 4.5:1 on its ground in both themes. `ink4` is for placeholders and closed calendar days only.
- **Reduce Motion:** every repeating animation stops (the ECG loader now joins the presets that already did).
- **Charts:** never colour alone. Blood pressure's bottom number uses diamonds and the top uses dots; a point outside the target is a hollow ring; the legend draws the same marks. VoiceOver hears the real values with their days, the unit and the target (`chartWords`).

## Why

Apple's HIG (Accessibility, Buttons, Typography, Color, Charts, read 1 Nov 2026) states these as rules, and the owner asked for them to be followed strictly.

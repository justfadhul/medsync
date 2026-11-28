# NumberInput

A number with its unit beside it and − and + steppers (48 px wide for patients), inside a `Field`. Behaviour from Base UI NumberField: arrow keys step, Shift steps by ten, digits stay tabular.

Give the range in the Field's hint ("Between 2 and 250 kg"). Use it for amounts a person might nudge; codes and phone numbers are `Input`. Name the steppers when "Less" and "More" are unclear (`lessLabel="Fewer people"`).

## Switching the unit

Where people use more than one unit, pass `units` instead of `unit` and the unit becomes a switch: `UNITS.weight` (kg, g), `UNITS.temperature` (°C, °F), `UNITS.length` (cm, m), `UNITS.age` (years, months, weeks, days), or your own `UnitOption[]`. The first unit is the base; `min` and `max` are given in it and shown in whichever unit is chosen. `onUnitChange(unitId, value)` reports the switch.

Switching never changes what the number means. An exact conversion converts it to the new unit's precision (64 kg becomes 64,000 g; 37 °C becomes 98.6 °F). A unit with no exact conversion (a month has no fixed number of days) clears the number so it is entered again. Either way a polite announcement says what happened ("Unit: grams. 64,000 grams." or "Unit: days. Enter the number again."). The switch button is named by its unit ("Unit: kilograms. Change the unit"). Read-only and disabled fields show the unit as plain text.

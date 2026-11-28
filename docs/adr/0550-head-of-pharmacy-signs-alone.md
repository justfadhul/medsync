# ADR 0550: The head of pharmacy signs rule changes and clinical content alone

**Status:** Accepted, 28 Nov 2026. The owner (also the CSO) asked to drop the second signer where the head pharmacist
signs, keeping one for lower cadres, and chose: rules and clinical content; and the head of pharmacy as the only
signer of what a lower cadre proposes. Migration 0320 is GATED. Wording is a draft.

Builds on the in-charge-alone ruling for packs (31 Oct 2026, `signPack`, `IN_CHARGE_SIGNS`). Changes the two-signature
rule of migrations 0270/0273/0274 (rule proposals and rule groups) and the CC-2 rule of migration 0210 (clinical
content) for the head of pharmacy.

## Decision

1. **Who is the head.** The holder of `pharmacy.manage`, which comes only from a hub head assignment, never from a
   cadre. The roster's in-charge of the day is not, by that alone, the head.
2. **Rules (Set-up › Rules, Medicines' rule dialog, the roster's rule badges).** A proposal applies on the head's
   signature. A pharmacist, technician or dispenser may still propose; the head signs it (the proposer and the head are
   then two people). Nobody signs as "second signer": the app offers no such button (`signSecond: false`), and
   `private.pharmacy_rule_sign` refuses a `second` signature and an `in_charge` signature from anyone but the head. A
   whole rule group is signed by the head alone in the same way (`private.pharmacy_rule_group_sign`). Only the head
   rejects; the proposer may still withdraw.
3. **Clinical content.** When the signer is the head, one signature puts the entry in force, their own entries
   included; the signature records `HEAD_SIGNS_ALONE`, which meets migration 0210's "one signer with a recorded
   exception". A signer who is not the head keeps the old rule (reviewer-signed, or the exception in words).
4. **Unchanged.** Controlled-medicine witnesses, going live (in-charge and medical superintendent), the CSO's sign-off
   of wording, and packs (already in-charge alone).

## Consequences

- Apply 0320 before the app ships: the app no longer offers a second signature, so without 0320 a rule change could
  not apply. Existing signatures, applied rules and signed groups are unchanged; a group signed by two people stays
  signed.
- The second safety check on a rule change is now the head's review of what others propose; a change the head
  proposes has no second reader. The history keeps the proposer and the signer.

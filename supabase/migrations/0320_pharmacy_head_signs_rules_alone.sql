-- 0320 — The head of pharmacy signs a rule change alone (ADR 0550).
--
-- GATED: owner-applied (`npm run db:migrate`), after 0274. Apply it before the app that ships with it: from then on
-- the app offers no "second signer" for rules, so without this migration a change could never apply.
--
--   Owner (CSO) ruling, 28 Nov 2026: where the head of pharmacy signs, no second signer is needed; where a lower cadre
--   proposes, the head of pharmacy is the only one who signs it. So a rule proposal applies on the head's signature,
--   and a whole rule group is signed by the head alone. The head is the holder of `pharmacy.manage` (a hub head
--   assignment, never a cadre), not the roster's in-charge of the day.
--
--   1. private.pharmacy_rule_sign: the `in_charge` signature must be the head's, and it applies the proposal. A new
--      `second` signature is refused. Proposals keep their proposer, so who asked and who signed stay two names
--      where a lower cadre proposed.
--   2. private.pharmacy_rule_group_sign: the same for a group: the head signs as `in_charge`; `second` is refused.
--
-- ADDITIVE and re-runnable (CREATE OR REPLACE). Existing signatures and applied rules are unchanged.
-- Reverse: re-run the two function bodies from 0274_pharmacy_setup_tabs.sql.

CREATE OR REPLACE FUNCTION private.pharmacy_rule_sign() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE p public.pharmacy_rule_proposals;
BEGIN
  SELECT * INTO p FROM public.pharmacy_rule_proposals WHERE id = NEW.proposal_id FOR UPDATE;
  IF p.status <> 'pending' THEN
    RAISE EXCEPTION 'pharmacy_rule_signatures: the proposal is closed' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.role = 'second' THEN
    RAISE EXCEPTION 'pharmacy_rule_signatures: only the head of pharmacy signs (ADR 0550)' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT private.pharmacy_can_user(NEW.signed_by, p.hospital_id, 'pharmacy.manage') THEN
    RAISE EXCEPTION 'pharmacy_rule_signatures: only the head of pharmacy signs (ADR 0550)' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM set_config('pharmacy.rule_apply', 'on', true);
  INSERT INTO public.pharmacy_rules (hospital_id, rule_group, key, text, product_id, params, name, applies_to)
  VALUES (p.hospital_id, p.rule_group, p.key, p.new_text, p.product_id, p.params, p.name, p.applies_to)
  ON CONFLICT (hospital_id, rule_group, key)
    DO UPDATE SET text = EXCLUDED.text, params = coalesce(EXCLUDED.params, pharmacy_rules.params),
      name = coalesce(EXCLUDED.name, pharmacy_rules.name),
      applies_to = coalesce(EXCLUDED.applies_to, pharmacy_rules.applies_to), updated_at = now();
  UPDATE public.pharmacy_rule_proposals SET status = 'applied', closed_at = now() WHERE id = p.id;
  PERFORM set_config('pharmacy.rule_apply', 'off', true);
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION private.pharmacy_rule_group_sign() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.role = 'second' THEN
    RAISE EXCEPTION 'pharmacy_rule_group_signatures: only the head of pharmacy signs (ADR 0550)' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT private.pharmacy_can_user(NEW.signed_by, NEW.hospital_id, 'pharmacy.manage') THEN
    RAISE EXCEPTION 'pharmacy_rule_group_signatures: only the head of pharmacy signs (ADR 0550)' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

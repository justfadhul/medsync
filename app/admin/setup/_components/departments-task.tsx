"use client";

import type { StepState } from "../_lib/rules";
import { Fragment, useActionState, useState } from "react";
import { PlusIcon } from "lucide-react";

import { DEPARTMENT_GROUPS } from "@/app/signup/hospital/_lib/catalog";
import { Button } from "@/components/ui/button";
import { SETUP } from "@/content/onboarding";
import { CHECKLIST } from "@/content/onboarding-setup";
import { IM_CODE, startChoices } from "../_lib/rules";
import { confirmDepartmentsAction } from "../actions";
import { CheckRow, fieldClass, FormStatus, SaveButton } from "./ui";

const D = CHECKLIST.departments;
const MAX_OTHERS = 5;

export interface DepartmentsData {
  ticked: ReadonlyArray<string>;
  others: ReadonlyArray<string>;
  start: string | null;
  subspecialties: ReadonlyArray<{ id: string; name: string; checked: boolean }>;
}

/**
 * Departments and where you'll start (§5.10): the grouped checklist with IM sub-specialties nested
 * under Internal Medicine, "Other" (up to 5), and a start picker that lists only what is ticked.
 */
export function DepartmentsTask({
  hospitalId,
  hasApplication,
  data,
}: {
  hospitalId: string;
  hasApplication: boolean;
  data: DepartmentsData;
}) {
  const [state, action, pending] = useActionState<StepState, FormData>(
    confirmDepartmentsAction,
    {},
  );
  const [ticked, setTicked] = useState(() => new Set(data.ticked));
  const [others, setOthers] = useState<string[]>(() =>
    data.others.length > 0 ? [...data.others] : [""],
  );
  const [start, setStart] = useState(data.start ?? "");
  const choices = startChoices(ticked);

  const toggle = (code: string, on: boolean) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(code);
      else next.delete(code);
      return next;
    });

  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="hospital_id" value={hospitalId} />
      <p className="text-body-s text-muted-foreground">{D.lead}</p>

      {DEPARTMENT_GROUPS.map((group) => (
        <fieldset key={group.groupLabel} className="flex flex-col gap-1">
          <legend className="text-body-s text-foreground mb-1 font-medium">
            {group.groupLabel}
          </legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 sm:gap-x-4">
            {group.items.map((d) => (
              <Fragment key={d.code}>
                <CheckRow
                  name="departments"
                  value={d.code}
                  checked={ticked.has(d.code)}
                  onChange={(on) => toggle(d.code, on)}
                >
                  {d.label}
                </CheckRow>
                {d.code === IM_CODE && ticked.has(IM_CODE) && data.subspecialties.length > 0 ? (
                  <fieldset className="ease-expo-out mb-2 ml-6 flex flex-col transition-[opacity,translate] duration-150 motion-reduce:transition-none sm:col-span-2 starting:translate-y-1 starting:opacity-0">
                    <legend className="text-body-s text-muted-foreground mb-1">
                      {D.subspecialties}
                    </legend>
                    <div className="grid grid-cols-1 sm:grid-cols-2 sm:gap-x-4">
                      {data.subspecialties.map((s) => (
                        <CheckRow
                          key={s.id}
                          name="subspecialties"
                          value={s.id}
                          defaultChecked={s.checked}
                        >
                          {s.name}
                        </CheckRow>
                      ))}
                    </div>
                  </fieldset>
                ) : null}
              </Fragment>
            ))}
          </div>
        </fieldset>
      ))}

      <fieldset className="flex flex-col gap-2">
        <legend className="text-body-s text-foreground mb-1 font-medium">
          {SETUP.otherDepartments}
        </legend>
        {others.map((value, i) => (
          <input
            key={i}
            name="others"
            value={value}
            onChange={(e) => setOthers(others.map((o, j) => (j === i ? e.target.value : o)))}
            placeholder={D.otherPlaceholder}
            aria-label={`${SETUP.otherDepartments} ${i + 1}`}
            maxLength={120}
            autoCapitalize="words"
            className={fieldClass}
          />
        ))}
        {others.length < MAX_OTHERS ? (
          <div>
            <Button
              type="button"
              variant="ghost"
              size="md"
              className="min-h-11"
              onClick={() => setOthers([...others, ""])}
            >
              <PlusIcon aria-hidden className="size-3.5" /> {D.addOther}
            </Button>
          </div>
        ) : null}
      </fieldset>

      {hasApplication ? (
        <div className="flex max-w-sm flex-col gap-1.5">
          <label htmlFor="setup-start" className="text-body-s text-foreground font-medium">
            {SETUP.startDepartment}
          </label>
          <select
            id="setup-start"
            name="start"
            value={ticked.has(start) ? start : ""}
            onChange={(e) => setStart(e.target.value)}
            disabled={choices.length === 0}
            aria-describedby="setup-start-hint"
            className={fieldClass}
          >
            <option value="">{choices.length > 0 ? CHECKLIST.choose : D.startNone}</option>
            {choices.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
          <p id="setup-start-hint" className="text-body-s text-muted-foreground">
            {SETUP.startDepartmentHint}
          </p>
        </div>
      ) : null}

      <FormStatus state={state} />
      <SaveButton pending={pending} />
    </form>
  );
}

import type { PlaygroundInputs } from "@/lib/playground";

import { PHYSICS } from "@/content/sensor";

export interface ControlsProps {
  inputs: PlaygroundInputs;
  onChange: (next: Partial<PlaygroundInputs>) => void;
}

interface ToggleProps {
  id: string;
  label: string;
  effect: string;
  checked: boolean;
  onToggle: (next: boolean) => void;
}

/** A labelled switch. The effect is written beside it, never implied by colour. */
function Toggle({ id, label, effect, checked, onToggle }: ToggleProps) {
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onToggle(event.target.checked)}
        className="accent-primary mt-0.5 size-4 shrink-0"
      />
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
        <span className="text-body-s block font-medium text-gray-900">{label}</span>
        <span className="text-caption block text-gray-600">{effect}</span>
      </label>
    </div>
  );
}

interface PercentProps {
  id: string;
  label: string;
  effect: string;
  value: number;
  onChange: (next: number) => void;
}

function Percent({ id, label, effect, value, onChange }: PercentProps) {
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-body-s font-medium text-gray-900">
          {label}
        </label>
        <span className="text-caption tabular font-mono text-gray-600">{value} per cent</span>
      </div>
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="accent-primary mt-2 w-full"
      />
      <p className="text-caption mt-1 text-gray-600">{effect}</p>
    </div>
  );
}

/**
 * Everything the reader can change. Each control carries its own written effect
 * from the content file, so the screen never needs a legend to be understood.
 */
export function Controls({ inputs, onChange }: ControlsProps) {
  const { controls, glucose } = PHYSICS;

  return (
    <div className="flex flex-col gap-6">
      <div className="min-w-0">
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor="pg-glucose" className="text-body-s font-medium text-gray-900">
            {controls.glucose.label}
          </label>
          <span className="text-caption tabular font-mono text-gray-600">
            {inputs.glucose.toFixed(1)} {glucose.unit}
          </span>
        </div>
        <input
          id="pg-glucose"
          type="range"
          min={glucose.min}
          max={glucose.max}
          step={glucose.step}
          value={inputs.glucose}
          onChange={(event) => onChange({ glucose: Number(event.target.value) })}
          className="accent-primary mt-2 w-full"
        />
        <div className="text-caption tabular mt-1 flex justify-between font-mono text-gray-500">
          <span>
            {glucose.min} {glucose.unit}
          </span>
          <span>
            {glucose.max} {glucose.unit}
          </span>
        </div>
        <p className="text-caption mt-1 text-gray-600">{controls.glucose.effect}</p>
      </div>

      <div
        role="group"
        aria-labelledby="pg-fluid"
        className="min-w-0 border-t border-gray-200 pt-5"
      >
        <h3 id="pg-fluid" className="text-overline pb-3 text-gray-500 uppercase">
          What is in the fluid
        </h3>
        <div className="flex flex-col gap-4">
          <Toggle
            id="pg-mannitol"
            label={controls.mannitol.label}
            effect={controls.mannitol.effect}
            checked={inputs.mannitol}
            onToggle={(next) => onChange({ mannitol: next })}
          />
          <Toggle
            id="pg-paracetamol"
            label={controls.paracetamol.label}
            effect={controls.paracetamol.effect}
            checked={inputs.paracetamol}
            onToggle={(next) => onChange({ paracetamol: next })}
          />
          <Toggle
            id="pg-low-oxygen"
            label={controls.lowOxygen.label}
            effect={`${controls.lowOxygen.effect} Above ${PHYSICS.enzymatic.lowOxygenThresholdMmol} ${glucose.unit}.`}
            checked={inputs.lowOxygen}
            onToggle={(next) => onChange({ lowOxygen: next })}
          />
        </div>
      </div>

      <div role="group" aria-labelledby="pg-wear" className="min-w-0 border-t border-gray-200 pt-5">
        <h3 id="pg-wear" className="text-overline pb-3 text-gray-500 uppercase">
          How worn the sensors are
        </h3>
        <div className="flex flex-col gap-5">
          <Percent
            id="pg-fouling"
            label={controls.fouling.label}
            effect={`${controls.fouling.effect} Above ${PHYSICS.flags.foulingFlagPercent} per cent the hourly health check sees it.`}
            value={inputs.fouling}
            onChange={(next) => onChange({ fouling: next })}
          />
          <Percent
            id="pg-photobleaching"
            label={controls.photobleaching.label}
            effect={controls.photobleaching.effect}
            value={inputs.photobleaching}
            onChange={(next) => onChange({ photobleaching: next })}
          />
        </div>
      </div>

      <div
        role="group"
        aria-labelledby="pg-bridge"
        className="min-w-0 border-t border-gray-200 pt-5"
      >
        <h3 id="pg-bridge" className="text-overline pb-3 text-gray-500 uppercase">
          Standing in for the implant
        </h3>
        <Toggle
          id="pg-bridged"
          label="Bridge a wearable continuous glucose monitor (CGM)"
          effect="Fed through the phone at lower trust. It can lift a suspended controller to basal only, never to full."
          checked={inputs.bridged}
          onToggle={(next) => onChange({ bridged: next })}
        />
      </div>
    </div>
  );
}

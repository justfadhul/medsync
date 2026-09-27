"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { TriangleAlertIcon, Volume2Icon } from "lucide-react";

import { arrestAlarmPlaceV2 } from "@/app/nurse/resus/_v2/actions-alarm";
import { ALARM_MAX_MS, alarmTones, alarmTransition } from "@/lib/resus/arrest-alarm";
import { subscribeResusBoard } from "@/lib/resus/board-channel";

/**
 * The arrest alarm (owner, 2026-09-24): every clinical screen at the hospital
 * buzzes when an arrest is declared — a loud square-wave alarm, a red banner
 * naming the place (never the patient) and vibration on phones — until someone
 * acknowledges it on this device, the arrest ends, or 2 minutes pass (the banner
 * then stays). The desk of that episode stays quiet: its team is at the bedside.
 * Browsers only play sound after a tap on the page, and never above the device
 * volume; until the first tap the banner offers "Sound on".
 */

interface Alarm {
  episodeId: string;
  place: string | null;
  atMs: number;
  sounding: boolean;
}

type AudioCtor = typeof AudioContext;
/** One context per tab, created and resumed inside a user gesture. */
let audio: AudioContext | null = null;

function unlockAudio(): boolean {
  try {
    const Ctor: AudioCtor | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
    if (!Ctor) return false;
    audio ??= new Ctor();
    // iOS Safari: sound through the ringer switch where the browser allows it.
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (session) session.type = "playback";
    void audio.resume();
    return true;
  } catch {
    return false;
  }
}

/** The whole alarm on the audio clock, so a background tab's throttled timers cannot stall it. */
function startBuzzer(ctx: AudioContext): GainNode {
  const master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(ctx.destination);
  const t0 = ctx.currentTime + 0.05;
  for (const t of alarmTones(ALARM_MAX_MS / 1000)) {
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = t.hz;
    osc.connect(master);
    osc.start(t0 + t.atS);
    osc.stop(t0 + t.atS + t.lenS);
  }
  return master;
}

const hhmm = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const BTN =
  "tap text-body-s inline-flex min-h-11 items-center gap-1.5 rounded-md px-4 font-medium outline-none focus-visible:ring-2 focus-visible:ring-white";

export function ArrestAlarm({
  hospitalId,
  resusBase,
}: {
  hospitalId: string;
  /** Where "Open resus" goes (/nurse/resus, /doctor/resus); null where the role has no desk route. */
  resusBase: string | null;
}) {
  const pathname = usePathname();
  const pathRef = useRef(pathname);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [soundOn, setSoundOn] = useState(false);

  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);

  // Any tap or key anywhere unlocks sound for the rest of the visit.
  useEffect(() => {
    const onGesture = () => {
      if (unlockAudio()) setSoundOn(true);
    };
    window.addEventListener("pointerdown", onGesture, { capture: true });
    window.addEventListener("keydown", onGesture, { capture: true });
    return () => {
      window.removeEventListener("pointerdown", onGesture, { capture: true });
      window.removeEventListener("keydown", onGesture, { capture: true });
    };
  }, []);

  useEffect(() => {
    const seen = new Map<string, string>();
    const timerMap = timers.current;
    const clear = (id: string) => {
      clearTimeout(timerMap.get(id));
      timerMap.delete(id);
    };
    const unsubscribe = subscribeResusBoard(hospitalId, {
      onEpisode: (m) => {
        const t = alarmTransition(seen, m);
        if (t === "stop") {
          clear(m.episodeId);
          setAlarms((as) => as.filter((a) => a.episodeId !== m.episodeId));
          return;
        }
        if (t !== "start" || pathRef.current?.includes(`/resus/${m.episodeId}`)) return;
        const alarm: Alarm = {
          episodeId: m.episodeId,
          place: null,
          atMs: Date.now(),
          sounding: true,
        };
        setAlarms((as) => [...as.filter((a) => a.episodeId !== m.episodeId), alarm]);
        clear(m.episodeId);
        timerMap.set(
          m.episodeId,
          setTimeout(
            () =>
              setAlarms((as) =>
                as.map((a) => (a.episodeId === m.episodeId ? { ...a, sounding: false } : a)),
              ),
            ALARM_MAX_MS,
          ),
        );
        void arrestAlarmPlaceV2({ episodeId: m.episodeId })
          .then((r) => {
            if (!r.ok) return;
            setAlarms((as) =>
              as.map((a) => (a.episodeId === m.episodeId ? { ...a, place: r.placeLabel } : a)),
            );
          })
          .catch(() => undefined);
      },
    });
    return () => {
      unsubscribe();
      for (const t of timerMap.values()) clearTimeout(t);
      timerMap.clear();
    };
  }, [hospitalId]);

  // Sound + vibration while any alarm sounds; a newer arrest restarts the 2-minute window.
  const newest = alarms.reduce((m, a) => (a.sounding ? Math.max(m, a.atMs) : m), 0);
  useEffect(() => {
    if (!newest || !soundOn || !audio) return;
    const gain = startBuzzer(audio);
    const buzz = () => navigator.vibrate?.([400, 150, 400, 150, 400]);
    buzz();
    const vibration = setInterval(buzz, 1_800);
    return () => {
      gain.disconnect();
      clearInterval(vibration);
      navigator.vibrate?.(0);
    };
  }, [newest, soundOn]);

  const active = alarms.length > 0;
  useEffect(() => {
    if (!active) return;
    const previous = document.title;
    document.title = "CARDIAC ARREST — MedSync";
    return () => {
      document.title = previous;
    };
  }, [active]);

  if (!active) return null;
  const acknowledge = (id: string) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setAlarms((as) => as.filter((a) => a.episodeId !== id));
  };

  return (
    <div role="alert" className="fixed inset-x-0 top-0 z-[70] flex flex-col gap-px">
      {alarms.map((a) => (
        <div
          key={a.episodeId}
          className="dark:bg-status-critical-bg dark:text-status-critical-fg flex flex-wrap items-center gap-x-4 gap-y-2 bg-rose-600 px-4 py-3 text-white shadow-lg sm:px-6 dark:border-b dark:border-red-900"
        >
          <TriangleAlertIcon aria-hidden className="size-6 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-heading-s">Cardiac arrest{a.place ? ` — ${a.place}` : ""}</p>
            <p className="text-body-s">
              Declared {hhmm(a.atMs)} ·{" "}
              {!a.sounding
                ? "alarm silenced after 2 min"
                : soundOn
                  ? "alarm sounding"
                  : "sound is off on this device"}
            </p>
          </div>
          {a.sounding && !soundOn ? (
            <button
              type="button"
              onClick={() => {
                if (unlockAudio()) setSoundOn(true);
              }}
              className={`${BTN} border border-white`}
            >
              <Volume2Icon aria-hidden className="size-4" />
              Sound on
            </button>
          ) : null}
          {resusBase ? (
            <Link
              href={`${resusBase}/${a.episodeId}`}
              onClick={() => acknowledge(a.episodeId)}
              className={`${BTN} bg-white text-rose-700`}
            >
              Open resus
            </Link>
          ) : null}
          <button
            type="button"
            onClick={() => acknowledge(a.episodeId)}
            className={`${BTN} border border-white`}
          >
            Acknowledge
          </button>
        </div>
      ))}
    </div>
  );
}

"use client";

import { useState } from "react";

import { LandingToast } from "@/components/landing/tether/chrome";
import { buttonClass } from "@/components/tide/kit";
import { TICKET } from "@/content/tether-landing/copy";

export function ToastDemo() {
  const [msg, setMsg] = useState("");
  return (
    <>
      <button
        type="button"
        className={buttonClass("outline", "m")}
        onClick={() => setMsg(TICKET.toast.coming)}
      >
        Show a toast
      </button>
      {msg ? <LandingToast message={msg} onClose={() => setMsg("")} /> : null}
    </>
  );
}

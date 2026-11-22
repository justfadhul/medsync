import { redirect } from "next/navigation";

/** This page now opens as a section of Me (the owner's three-page redesign); old links land on it there. */
export default function Page() {
  redirect("/patient/me?s=records");
}

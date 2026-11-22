import { redirect } from "next/navigation";

/**
 * Book a visit lives on Today now (the owner's three-page redesign, 22 Nov 2026): the old page sends the patient
 * to the booking on Today. Come today, Something is wrong and a doctor's own days keep their steps under /book.
 */
export default function BookPage() {
  redirect("/patient#book");
}

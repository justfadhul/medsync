import { Route, Routes } from "react-router-dom";

import { Cycle } from "@/screens/Cycle";
import { Defence } from "@/screens/Defence";
import { Electrochemical } from "@/screens/Electrochemical";
import { Journey } from "@/screens/Journey";
import { Links } from "@/screens/Links";
import { NotFound } from "@/screens/NotFound";
import { Optical } from "@/screens/Optical";
import { Overview } from "@/screens/Overview";
import { Parts } from "@/screens/Parts";
import { Playground } from "@/screens/Playground";

/** The nine screens, in content order, plus the not-found route. */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Overview />} />
      <Route path="/parts" element={<Parts />} />
      <Route path="/links" element={<Links />} />
      <Route path="/optical" element={<Optical />} />
      <Route path="/electrochemical" element={<Electrochemical />} />
      <Route path="/cycle" element={<Cycle />} />
      <Route path="/playground" element={<Playground />} />
      <Route path="/defence" element={<Defence />} />
      <Route path="/journey" element={<Journey />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

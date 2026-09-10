import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

// Self-hosted variable fonts. Nothing is fetched from an external network.
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "@fontsource-variable/fraunces";

import { App } from "@/app/App";

import "@/styles/globals.css";

const container = document.getElementById("root");

if (!container) {
  throw new Error("The root element is missing from index.html.");
}

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);

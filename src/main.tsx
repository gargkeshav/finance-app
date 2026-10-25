import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import { LocalApp } from "./ui/LocalApp";
import "./ui/styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LocalApp />
  </StrictMode>,
);

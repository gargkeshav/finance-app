import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./ui/theme.css";
import { LocalApp } from "./ui/LocalApp";
import "./ui/mobile-layout.css";

const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
const syncColorScheme = () => {
  document.documentElement.classList.toggle("dark", colorScheme.matches);
};

syncColorScheme();
colorScheme.addEventListener("change", syncColorScheme);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LocalApp />
  </StrictMode>,
);

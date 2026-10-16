import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { isTauri } from "@tauri-apps/api/core";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import { App } from "./ui/App";
import "./ui/styles.css";

const synthetic =
  import.meta.env.DEV && import.meta.env.VITE_SYNTHETIC_PREVIEW === "1";
const ledger = synthetic
  ? new (await import("./adapters/synthetic-ledger")).SyntheticLedger()
  : isTauri()
    ? new (await import("./adapters/native-ledger")).NativeLedger()
    : null;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App ledger={ledger} synthetic={synthetic} />
  </StrictMode>,
);

if (
  (import.meta.env.DEV || import.meta.env.MODE === "native-smoke") &&
  import.meta.env.VITE_NATIVE_SMOKE === "1" &&
  isTauri()
) {
  void import("../tests/native/bridge-smoke").then((module) =>
    module.runNativeSmoke(),
  );
}

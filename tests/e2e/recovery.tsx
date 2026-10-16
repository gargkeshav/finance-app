import { createRoot } from "react-dom/client";
import { App } from "../../src/ui/App";
import { SyntheticLedger } from "../../src/adapters/synthetic-ledger";
import type { LedgerCommand } from "../../src/application/contracts";
import "../../src/ui/styles.css";

class UncertainLedger extends SyntheticLedger {
  private attempts = 0;
  private firstCommand = "";

  override async execute(command: LedgerCommand) {
    this.attempts += 1;
    if (this.attempts === 1) this.firstCommand = JSON.stringify(command);
    if (JSON.stringify(command) !== this.firstCommand)
      throw new Error("A retry changed the command identity.");
    const result = await super.execute(command);
    if (this.attempts === 1)
      throw new Error("Synthetic lost response after commit.");
    return result;
  }

  override async resolve(): Promise<never> {
    throw new Error("Synthetic status check unavailable.");
  }
}

createRoot(document.getElementById("root")!).render(
  <App ledger={new UncertainLedger()} synthetic />,
);

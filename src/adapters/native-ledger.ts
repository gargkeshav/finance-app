import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";
import {
  commandSchema,
  snapshotSchema,
  type Ledger,
  type LedgerCommand,
} from "../application/contracts";

export class NativeLedger implements Ledger {
  async read() {
    return snapshotSchema.parse(await invoke("read_ledger"));
  }

  async execute(command: LedgerCommand) {
    return snapshotSchema.parse(
      await invoke("execute_ledger", { command: commandSchema.parse(command) }),
    );
  }

  async resolve(command: LedgerCommand) {
    const result = await invoke("resolve_ledger", {
      command: commandSchema.parse(command),
    });
    return result === null ? null : snapshotSchema.parse(result);
  }

  async exportData() {
    return z.boolean().parse(await invoke("export_ledger"));
  }

  async restoreData(
    expectedEpoch: string,
    expectedRevision: number,
    confirmed: boolean,
  ) {
    const result = await invoke("restore_ledger", {
      expectedEpoch,
      expectedRevision,
      confirmed,
    });
    return result === null
      ? null
      : z
          .object({
            snapshot: snapshotSchema,
            safetyFile: z
              .string()
              .regex(/^recovery-safety-[a-f0-9-]+\.finance\.json$/),
          })
          .strict()
          .parse(result);
  }
}

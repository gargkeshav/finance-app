import { describe, expect, it } from "vitest";
import { nextAutosaveDelayMs } from "../src/adapters/file-store";

describe("nextAutosaveDelayMs", () => {
  it("backs off and caps retries at 30 seconds", () => {
    expect(nextAutosaveDelayMs(0)).toBe(1000);
    expect(nextAutosaveDelayMs(3)).toBe(8000);
    expect(nextAutosaveDelayMs(6)).toBe(30000);
  });
});

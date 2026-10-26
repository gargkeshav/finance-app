import { describe, expect, it } from "vitest";
import { resolveComboText } from "../src/ui/combo";

describe("resolveComboText", () => {
  const options = [{ id: "groceries", name: "Groceries" }];

  it("matches an existing name without regard to case", () => {
    expect(resolveComboText("gROCERIES", options)).toEqual({ kind: "existing", id: "groceries" });
  });

  it("returns trimmed new text", () => {
    expect(resolveComboText("  New category  ", options)).toEqual({ kind: "new", name: "New category" });
  });

  it("returns none for blank text", () => {
    expect(resolveComboText(" \t ", options)).toEqual({ kind: "none" });
  });
});
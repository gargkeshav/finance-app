import { describe, expect, it } from "vitest";
import { decodeRoute, encodeRoute } from "../src/ui/route";

const knownViews = ["Home", "Activity", "Review"];

describe("route", () => {
  it("round-trips an Activity filter", () => {
    const route = { view: "Activity", filter: { entityId: "e1" } };

    expect(decodeRoute(encodeRoute(route), knownViews)).toEqual(route);
  });

  it.each(["", "#/Nope"])("falls back to Home for %s", (hash) => {
    expect(decodeRoute(hash, knownViews)).toEqual({ view: "Home" });
  });
});
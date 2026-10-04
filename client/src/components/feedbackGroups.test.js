import { describe, expect, test } from "vitest";
import { groupFeedback } from "./feedbackGroups";

const item = (id, status) => ({ _id: id, status });

describe("groupFeedback", () => {
  test("puts planned before pending and keeps the server order within each", () => {
    const { open } = groupFeedback([
      item("p1", "pending"),
      item("pl1", "planned"),
      item("p2", "pending"),
      item("pl2", "planned"),
    ]);
    expect(open.map((i) => i._id)).toEqual(["pl1", "pl2", "p1", "p2"]);
  });

  test("separates shipped and declined items from open ones", () => {
    const groups = groupFeedback([
      item("c1", "completed"),
      item("p1", "pending"),
      item("d1", "declined"),
      item("c2", "completed"),
    ]);
    expect(groups.open.map((i) => i._id)).toEqual(["p1"]);
    expect(groups.shipped.map((i) => i._id)).toEqual(["c1", "c2"]);
    expect(groups.declined.map((i) => i._id)).toEqual(["d1"]);
  });

  test("handles a board that has not loaded yet", () => {
    expect(groupFeedback(undefined)).toEqual({ open: [], shipped: [], declined: [] });
  });
});

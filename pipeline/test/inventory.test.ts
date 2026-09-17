import { describe, expect, it } from "vitest";
import { inspectEntries } from "../src/inventory.js";

describe("inspectEntries", () => {
  it("groups base cells and updates in numeric sequence", () => {
    const result = inspectEntries([
      "ENC_ROOT/US5WI1AA.002",
      "ENC_ROOT/US5WI1AA.000",
      "ENC_ROOT/US5WI1AA.001",
      "ENC_ROOT/US4WI2BB.000",
      "ENC_ROOT/CATALOG.031",
      "README.TXT",
    ]);

    expect(result.valid).toBe(true);
    expect(result.cells).toEqual([
      { name: "US4WI2BB", base: "ENC_ROOT/US4WI2BB.000", updates: [], updateNumbers: [] },
      {
        name: "US5WI1AA",
        base: "ENC_ROOT/US5WI1AA.000",
        updates: ["ENC_ROOT/US5WI1AA.001", "ENC_ROOT/US5WI1AA.002"],
        updateNumbers: [1, 2],
      },
    ]);
  });

  it("rejects a gap in sequential updates", () => {
    const result = inspectEntries(["US5WI1AA.000", "US5WI1AA.001", "US5WI1AA.003"]);

    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual({
      code: "missing-update",
      cell: "US5WI1AA",
      updateNumber: 2,
      message: "US5WI1AA is missing sequential update 002",
    });
  });

  it("rejects updates without a base cell", () => {
    const result = inspectEntries(["nested/us5wi1aa.001"]);

    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual({
      code: "missing-base",
      cell: "US5WI1AA",
      message: "US5WI1AA has updates but no .000 base cell",
    });
  });

  it("rejects duplicate update numbers", () => {
    const result = inspectEntries(["one/US5WI1AA.000", "two/US5WI1AA.000"]);

    expect(result.valid).toBe(false);
    expect(result.issues[0]).toMatchObject({ code: "duplicate-file", cell: "US5WI1AA", updateNumber: 0 });
  });

  it("rejects an inventory containing no ENC dataset files", () => {
    const result = inspectEntries(["CATALOG.031", "README.TXT"]);

    expect(result.valid).toBe(false);
    expect(result.cells).toEqual([]);
    expect(result.issues).toEqual([
      { code: "no-dataset-files", message: "No S-57 base cells or update files were found" },
    ]);
  });
});

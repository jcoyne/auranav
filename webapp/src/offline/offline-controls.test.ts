import { describe, expect, it } from "vitest";
import { formatBytes } from "./offline-controls";

describe("offline download size labels", () => {
  it("formats byte counts for the storage panel", () => {
    expect(formatBytes(900)).toBe("900 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe("2.0 GB");
  });
});

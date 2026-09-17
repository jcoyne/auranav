import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateManifest } from "../src/manifest.js";

const pipelineRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(pipelineRoot, "..");

describe("schema-v1 package manifest examples", () => {
  it.each([
    path.join(pipelineRoot, "examples/package-manifest.v1.json"),
    path.join(repositoryRoot, "schema/example-manifest.json"),
  ])("%s conforms to the shared schema", async (manifestPath) => {
    const result = await validateManifest(manifestPath);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });
});

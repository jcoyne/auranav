import { describe, expect, it } from "vitest";
import { configuredManifestUrl, resolvePackageAssetUrl } from "./chart-package-url";

describe("configuredManifestUrl", () => {
  it("returns undefined when no package is configured", () => {
    expect(configuredManifestUrl("", "https://viewer.example/app/")).toBeUndefined();
  });

  it("resolves a query parameter relative to the page", () => {
    expect(configuredManifestUrl("?manifest=charts/manifest.json", "https://viewer.example/app/"))
      .toEqual(new URL("https://viewer.example/app/charts/manifest.json"));
  });

  it("uses the query parameter in preference to the configured stable path", () => {
    expect(configuredManifestUrl("?manifest=/preview.json", "https://viewer.example/app/", "/charts/manifest.json"))
      .toEqual(new URL("https://viewer.example/preview.json"));
  });

  it("uses a configured stable path when the query parameter is absent", () => {
    expect(configuredManifestUrl("", "https://viewer.example/app/", "/charts/manifest.json"))
      .toEqual(new URL("https://viewer.example/charts/manifest.json"));
  });
});

describe("resolvePackageAssetUrl", () => {
  it("resolves package assets relative to the manifest, not the page", () => {
    expect(resolvePackageAssetUrl("../tiles/chart.pmtiles", new URL("https://data.example/packages/v1/manifest.json")))
      .toEqual(new URL("https://data.example/packages/tiles/chart.pmtiles"));
  });
});

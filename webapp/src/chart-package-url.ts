export function configuredManifestUrl(
  search: string,
  pageUrl: string,
  configuredPath?: string,
): URL | undefined {
  const queryPath = new URLSearchParams(search).get("manifest")?.trim();
  const path = queryPath || configuredPath?.trim();
  return path ? new URL(path, pageUrl) : undefined;
}

export function resolvePackageAssetUrl(assetPath: string, manifestUrl: URL): URL {
  return new URL(assetPath, manifestUrl);
}

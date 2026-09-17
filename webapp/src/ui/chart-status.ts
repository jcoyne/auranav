import type { ChartPackageManifest } from "../chart-package";
import { resolvePackageAssetUrl } from "../chart-package-url";

export function renderChartStatus(container: HTMLElement): void {
  container.innerHTML = `
    <div class="status-heading">
      <strong>Synthetic preview</strong>
      <span class="status-pill">Demo data</span>
    </div>
    <dl>
      <div><dt>Source</dt><dd>Placeholder geometry</dd></div>
      <div><dt>Depths</dt><dd>metres</dd></div>
      <div><dt>Datum</dt><dd>Not applicable</dd></div>
      <div><dt>Scale</dt><dd>1:20,000 preview</dd></div>
    </dl>
    <p>This preview is not NOAA chart data. Future packages will show source, edition, update date, and vertical datum here.</p>
  `;
}

export function renderChartLoading(container: HTMLElement, manifestUrl: URL): void {
  container.replaceChildren();
  const heading = document.createElement("strong");
  heading.textContent = "Loading chart package…";
  const detail = document.createElement("p");
  detail.textContent = manifestUrl.href;
  container.append(heading, detail);
}

export function renderChartError(container: HTMLElement, message: string): void {
  container.replaceChildren();
  container.classList.add("is-warning");
  const heading = document.createElement("strong");
  heading.textContent = "Chart package unavailable";
  const detail = document.createElement("p");
  detail.textContent = message;
  container.append(heading, detail);
}

export function renderPackageChartStatus(
  container: HTMLElement,
  manifest: ChartPackageManifest,
  manifestUrl: URL,
): void {
  container.replaceChildren();
  container.classList.remove("is-warning");

  const heading = document.createElement("div");
  heading.className = "status-heading";
  const name = document.createElement("strong");
  name.textContent = manifest.name;
  const pill = document.createElement("span");
  pill.className = "status-pill is-noaa";
  pill.textContent = "NOAA ENC";
  heading.append(name, pill);

  const issueDates = manifest.cells.map((cell) => cell.issueDate).sort();
  const scales = [...new Set(manifest.cells.map((cell) => cell.compilationScale))]
    .sort((left, right) => left - right)
    .map((scale) => `1:${scale.toLocaleString()}`)
    .join(", ");
  const editions = manifest.cells
    .map((cell) => `${cell.name} ed. ${cell.edition}, update ${cell.updateNumber}`)
    .join("; ");
  const list = document.createElement("dl");
  addDetail(list, "Source", `${manifest.source.publisher} · ${manifest.source.product}`);
  addDetail(list, "Cells", editions);
  addDetail(list, "Issued", issueDates.at(-1) ?? "Unknown");
  addDetail(list, "Depths", displayUnitLabel(manifest.depth.displayUnit));
  addDetail(list, "Datum", manifest.depth.verticalDatums.join(", "));
  addDetail(list, "Scale", scales);

  const agreement = document.createElement("a");
  agreement.href = resolvePackageAssetUrl(manifest.source.userAgreementPath, manifestUrl).href;
  agreement.target = "_blank";
  agreement.rel = "noopener noreferrer";
  agreement.textContent = "NOAA user agreement";
  const note = document.createElement("p");
  note.append("Simplified portrayal for informational use. ", agreement);
  container.append(heading, list, note);
}

function addDetail(list: HTMLDListElement, term: string, description: string): void {
  const row = document.createElement("div");
  const dt = document.createElement("dt");
  const dd = document.createElement("dd");
  dt.textContent = term;
  dd.textContent = description;
  row.append(dt, dd);
  list.append(row);
}

function displayUnitLabel(unit: ChartPackageManifest["depth"]["displayUnit"]): string {
  if (unit === "foot") return "feet (stored in metres)";
  if (unit === "fathom") return "fathoms (stored in metres)";
  return "metres";
}

export function renderLocationStatus(container: HTMLElement, message: string, warning = false): void {
  container.textContent = message;
  container.classList.toggle("is-warning", warning);
  container.hidden = message.length === 0;
}

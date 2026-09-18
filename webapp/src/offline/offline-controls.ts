import type { ChartPackageManifest } from "../chart-package";
import {
  downloadChartPackage,
  offlinePackageFor,
  offlineAgreementUrl,
  offlineStorageSupported,
  removeOfflinePackage,
  requestPersistentStorage,
  storageEstimate,
  storageIsPersistent,
  verifyOfflinePackage,
  type DownloadProgress,
  type OfflinePackageRecord,
} from "./chart-store";

export class OfflineControls {
  private record: OfflinePackageRecord | undefined;
  private busy = false;
  private agreementObjectUrl: string | undefined;

  constructor(
    private readonly container: HTMLElement,
    private readonly manifest: ChartPackageManifest,
    private readonly manifestUrl: URL,
    private readonly appShellReady?: Promise<boolean>,
  ) {
    this.record = offlinePackageFor(manifestUrl);
  }

  async render(): Promise<void> {
    if (this.agreementObjectUrl) URL.revokeObjectURL(this.agreementObjectUrl);
    this.agreementObjectUrl = undefined;
    this.container.replaceChildren();
    const heading = document.createElement("h2");
    heading.textContent = "Offline charts";
    this.container.append(heading);

    if (!offlineStorageSupported()) {
      this.container.append(paragraph("This browser cannot store chart packages for offline use.", "offline-error"));
      return;
    }

    const intact = this.record ? await verifyOfflinePackage(this.record).catch(() => false) : false;
    const current = intact && this.record?.generatedAt === this.manifest.generatedAt;
    const status = paragraph(
      current
        ? `${formatBytes(this.record?.bytes ?? 0)} downloaded · ready offline · package ${formatDate(this.manifest.generatedAt)}`
        : this.record && intact
          ? `Downloaded package ${formatDate(this.record.generatedAt)} · update ${formatDate(this.manifest.generatedAt)} is ready.`
          : this.record
            ? "The offline package is incomplete. Download it again to repair it."
          : "Download every chart and zoom level for use without a connection.",
      current ? "offline-ready" : undefined,
    );
    this.container.append(status);
    if (this.record && intact) {
      this.agreementObjectUrl = await offlineAgreementUrl(this.record).catch(() => undefined);
      if (this.agreementObjectUrl) {
        const agreement = document.createElement("a");
        agreement.href = this.agreementObjectUrl;
        agreement.textContent = "Read saved NOAA user agreement";
        agreement.target = "_blank";
        agreement.rel = "noopener";
        this.container.append(agreement);
      }
    }

    const persistence = await storageIsPersistent().catch(() => false);
    const estimate: StorageEstimate = await storageEstimate().catch(() => ({}));
    const storageParts = [persistence ? "Persistent storage granted" : "Storage may be removed by the browser"];
    if (estimate.usage !== undefined && estimate.quota !== undefined) {
      storageParts.push(`${formatBytes(estimate.usage)} of ${formatBytes(estimate.quota)} used`);
    }
    this.container.append(paragraph(storageParts.join(" · "), "offline-storage-note"));

    const actions = document.createElement("div");
    actions.className = "offline-actions";
    const download = button(current ? "Download again" : this.record ? "Update download" : "Download charts");
    download.disabled = this.busy;
    download.addEventListener("click", () => void this.download());
    actions.append(download);
    if (this.record) {
      const remove = button("Remove", "secondary");
      remove.disabled = this.busy;
      remove.addEventListener("click", () => void this.remove());
      actions.append(remove);
    }
    this.container.append(actions);
  }

  private async download(): Promise<void> {
    this.busy = true;
    this.renderProgress({ completedFiles: 0, totalFiles: this.manifest.tileSets.filter((tileSet) => tileSet.format === "pmtiles").length + 1, completedBytes: 0, currentFile: "Preparing" });
    try {
      if (this.appShellReady && !(await this.appShellReady)) {
        throw new Error("The application shell could not be saved for offline use. Reload while online and try again.");
      }
      await requestPersistentStorage().catch(() => false);
      this.record = await downloadChartPackage(this.manifest, this.manifestUrl, (progress) => this.renderProgress(progress));
      this.busy = false;
      await this.render();
      this.container.append(paragraph("Download verified. Reload once before going offline so the map uses the saved package.", "offline-ready"));
    } catch (error) {
      this.busy = false;
      await this.render();
      this.container.append(paragraph(downloadErrorMessage(error), "offline-error"));
    } finally { this.busy = false; }
  }

  private async remove(): Promise<void> {
    if (!this.record) return;
    this.busy = true;
    try {
      await removeOfflinePackage(this.record);
      this.record = undefined;
      this.busy = false;
      await this.render();
    } catch (error) {
      this.busy = false;
      await this.render();
      this.container.append(paragraph(error instanceof Error ? error.message : "The offline charts could not be removed.", "offline-error"));
    } finally { this.busy = false; }
  }

  private renderProgress(progress: DownloadProgress): void {
    this.container.replaceChildren();
    const heading = document.createElement("h2");
    heading.textContent = "Downloading charts";
    const label = paragraph(
      `${progress.completedFiles} of ${progress.totalFiles} files · ${formatBytes(progress.completedBytes)}${progress.totalBytes === undefined ? "" : ` of ${formatBytes(progress.totalBytes)}`} · ${progress.currentFile}`,
    );
    const meter = document.createElement("progress");
    meter.max = progress.totalBytes ?? progress.totalFiles;
    meter.value = progress.totalBytes === undefined ? progress.completedFiles : progress.completedBytes;
    this.container.append(heading, label, meter);
  }
}

function paragraph(text: string, className?: string): HTMLParagraphElement {
  const element = document.createElement("p");
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

function button(label: string, className?: string): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = label;
  if (className) element.className = className;
  return element;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function downloadErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === "QuotaExceededError") {
    return "There is not enough device storage for this chart package. Free space or remove another offline download, then try again.";
  }
  return error instanceof Error ? error.message : "The chart download failed.";
}

function formatDate(dateTime: string): string {
  return new Date(dateTime).toLocaleDateString();
}

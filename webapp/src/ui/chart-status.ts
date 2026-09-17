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

export function renderLocationStatus(container: HTMLElement, message: string, warning = false): void {
  container.textContent = message;
  container.classList.toggle("is-warning", warning);
  container.hidden = message.length === 0;
}

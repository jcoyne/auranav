export type DisplaySettingsOptions = {
  showPanZoomButtons: boolean;
  onShowPanZoomButtonsChange(visible: boolean): void;
};

/** The drawer section holding map display preferences. */
export function renderDisplaySettings(container: HTMLElement, options: DisplaySettingsOptions): void {
  container.replaceChildren();

  const heading = document.createElement("h2");
  heading.textContent = "Display";

  const row = document.createElement("label");
  row.className = "settings-row";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = options.showPanZoomButtons;
  checkbox.addEventListener("change", () => options.onShowPanZoomButtonsChange(checkbox.checked));
  const text = document.createElement("span");
  text.textContent = "Pan and zoom buttons";
  row.append(checkbox, text);

  const note = document.createElement("p");
  note.textContent = "Drag or pinch the chart to pan and zoom without them. Arrow keys and +/− always work.";

  container.append(heading, row, note);
}

export interface CenterableMap {
  getZoom(): number;
  easeTo(options: { center: [number, number]; zoom: number }): unknown;
}

export function centerMapOn(map: CenterableMap, position: GeolocationPosition): void {
  const { latitude, longitude } = position.coords;
  map.easeTo({ center: [longitude, latitude], zoom: Math.max(map.getZoom(), 14) });
}

export interface MapViewportTarget {
  lat: number;
  lon: number;
  title: string;
}

export function normalizeMapViewportTarget(target: MapViewportTarget): MapViewportTarget {
  return {
    ...target,
    lat: Number(target.lat.toFixed(3)),
    lon: Number(target.lon.toFixed(3))
  };
}

export function mapViewportTargetKey(target?: Pick<MapViewportTarget, "lat" | "lon">) {
  return target ? `${target.lat.toFixed(3)}:${target.lon.toFixed(3)}` : "";
}

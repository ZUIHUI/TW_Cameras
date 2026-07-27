export const DEVICE_HEADING_MAX_AGE_MS = 2000;
export const GPS_HEADING_MIN_SPEED_METERS_PER_SECOND = 0.5;
export const HEADING_BEARING_MIN_DISTANCE_METERS = 5;
export const HEADING_UPDATE_INTERVAL_MS = 100;

const HEADING_MIN_CHANGE_DEGREES = 2;
const HEADING_SMOOTHING_WEIGHT = 0.25;

export interface DeviceHeadingSample {
  heading: number;
  timestamp: number;
}

export interface CompassDeviceOrientationEvent extends DeviceOrientationEvent {
  webkitCompassAccuracy?: number;
  webkitCompassHeading?: number;
}

export interface DeviceOrientationEventConstructorWithPermission {
  requestPermission?: (absolute?: boolean) => Promise<"denied" | "granted">;
}

export function resolveHeadingCandidate({
  calculatedHeading,
  deviceHeading,
  gpsHeading,
  gpsSpeed,
  now
}: {
  calculatedHeading?: number;
  deviceHeading?: DeviceHeadingSample;
  gpsHeading?: number | null;
  gpsSpeed?: number | null;
  now: number;
}) {
  if (
    deviceHeading &&
    now >= deviceHeading.timestamp &&
    now - deviceHeading.timestamp <= DEVICE_HEADING_MAX_AGE_MS
  ) {
    return normalizeHeading(deviceHeading.heading);
  }

  if (
    isFiniteNumber(gpsHeading) &&
    isFiniteNumber(gpsSpeed) &&
    gpsSpeed >= GPS_HEADING_MIN_SPEED_METERS_PER_SECOND
  ) {
    return normalizeHeading(gpsHeading);
  }

  return isFiniteNumber(calculatedHeading)
    ? normalizeHeading(calculatedHeading)
    : undefined;
}

export function orientationEventHeading(event: CompassDeviceOrientationEvent) {
  if (isFiniteNumber(event.webkitCompassHeading)) {
    return normalizeHeading(event.webkitCompassHeading);
  }

  if (event.absolute && isFiniteNumber(event.alpha)) {
    return normalizeHeading(360 - event.alpha);
  }

  return undefined;
}

export function smoothHeading(current: number | undefined, next: number) {
  const normalizedNext = normalizeHeading(next);
  if (!isFiniteNumber(current)) {
    return normalizedNext;
  }

  const difference = shortestHeadingDifference(current, normalizedNext);
  if (Math.abs(difference) < HEADING_MIN_CHANGE_DEGREES) {
    return normalizeHeading(current);
  }

  return normalizeHeading(current + difference * HEADING_SMOOTHING_WEIGHT);
}

export function bearingBetween(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number }
) {
  const fromLat = toRadians(from.lat);
  const toLat = toRadians(to.lat);
  const deltaLon = toRadians(to.lon - from.lon);
  const y = Math.sin(deltaLon) * Math.cos(toLat);
  const x =
    Math.cos(fromLat) * Math.sin(toLat) -
    Math.sin(fromLat) * Math.cos(toLat) * Math.cos(deltaLon);

  return normalizeHeading((Math.atan2(y, x) * 180) / Math.PI);
}

export function normalizeHeading(value: number) {
  return ((value % 360) + 360) % 360;
}

export function shortestHeadingDifference(from: number, to: number) {
  return ((normalizeHeading(to) - normalizeHeading(from) + 540) % 360) - 180;
}

export function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

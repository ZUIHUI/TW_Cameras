import type { RouteCoordinate, RouteMode, RouteOption, RouteStep, UserLocation } from "./types";

const EARTH_RADIUS_METERS = 6371000;

export const navigationThresholds: Record<
  Exclude<RouteMode, "transit">,
  { offRouteMeters: number; arrivalMeters: number }
> = {
  "two-wheeler": { offRouteMeters: 60, arrivalMeters: 30 },
  bicycle: { offRouteMeters: 35, arrivalMeters: 30 },
  walk: { offRouteMeters: 25, arrivalMeters: 20 }
};

export interface PreparedNavigationRoute {
  route: RouteOption;
  points: RouteCoordinate[];
  cumulativeMeters: number[];
  totalGeometryMeters: number;
  steps: Array<{
    step: RouteStep;
    routeStartMeters: number;
    routeEndMeters: number;
  }>;
}

export interface RouteProjection {
  coordinate: RouteCoordinate;
  distanceToRouteMeters: number;
  distanceAlongRouteMeters: number;
  bearing: number;
  segmentIndex: number;
}

export interface NavigationProgress {
  stepIndex: number;
  distanceAlongRouteMeters: number;
  distanceToRouteMeters: number;
  remainingDistanceMeters: number;
  remainingDurationSeconds: number;
  distanceToStepEndMeters: number;
  routeBearing: number;
  offRouteFixCount: number;
  lastRerouteAt: number;
  arrived: boolean;
  lastAcceptedFixAt?: number;
}

export interface NavigationAdvanceResult {
  progress: NavigationProgress;
  shouldReroute: boolean;
  accepted: boolean;
}

export function decodePolyline(encoded: string): RouteCoordinate[] {
  const coordinates: RouteCoordinate[] = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;

  while (index < encoded.length) {
    const latitudeDelta = decodeValue(encoded, index);
    index = latitudeDelta.nextIndex;
    const longitudeDelta = decodeValue(encoded, index);
    index = longitudeDelta.nextIndex;
    latitude += latitudeDelta.value;
    longitude += longitudeDelta.value;
    coordinates.push({
      lat: latitude / 1e5,
      lon: longitude / 1e5
    });
  }

  return coordinates;
}

export function prepareNavigationRoute(route: RouteOption): PreparedNavigationRoute {
  const points = decodePolyline(route.polyline);
  if (points.length < 2) {
    throw new Error("Navigation route requires at least two geometry points.");
  }

  const cumulativeMeters = [0];
  for (let index = 1; index < points.length; index += 1) {
    cumulativeMeters.push(cumulativeMeters[index - 1] + distanceMeters(points[index - 1], points[index]));
  }
  const totalGeometryMeters = cumulativeMeters[cumulativeMeters.length - 1];
  const flattenedSteps = route.legs.flatMap((leg) => leg.steps);
  const totalStepMeters = flattenedSteps.reduce((sum, step) => sum + Math.max(0, step.distanceMeters), 0);
  let accumulatedStepMeters = 0;
  const steps = flattenedSteps.map((step, index) => {
    const routeStartMeters =
      totalStepMeters > 0
        ? (accumulatedStepMeters / totalStepMeters) * totalGeometryMeters
        : (index / Math.max(1, flattenedSteps.length)) * totalGeometryMeters;
    accumulatedStepMeters += Math.max(0, step.distanceMeters);
    const routeEndMeters =
      index === flattenedSteps.length - 1
        ? totalGeometryMeters
        : totalStepMeters > 0
          ? (accumulatedStepMeters / totalStepMeters) * totalGeometryMeters
          : ((index + 1) / Math.max(1, flattenedSteps.length)) * totalGeometryMeters;
    return { step, routeStartMeters, routeEndMeters };
  });

  return {
    route,
    points,
    cumulativeMeters,
    totalGeometryMeters,
    steps
  };
}

export function projectLocationToRoute(
  location: RouteCoordinate,
  prepared: PreparedNavigationRoute
): RouteProjection {
  let best:
    | {
        coordinate: RouteCoordinate;
        distanceToRouteMeters: number;
        distanceAlongRouteMeters: number;
        bearing: number;
        segmentIndex: number;
      }
    | undefined;

  for (let index = 0; index < prepared.points.length - 1; index += 1) {
    const start = prepared.points[index];
    const end = prepared.points[index + 1];
    const projected = projectToSegment(location, start, end);
    if (!best || projected.distanceMeters < best.distanceToRouteMeters) {
      const segmentMeters = prepared.cumulativeMeters[index + 1] - prepared.cumulativeMeters[index];
      best = {
        coordinate: projected.coordinate,
        distanceToRouteMeters: projected.distanceMeters,
        distanceAlongRouteMeters: prepared.cumulativeMeters[index] + segmentMeters * projected.fraction,
        bearing: bearingBetween(start, end),
        segmentIndex: index
      };
    }
  }

  if (!best) {
    throw new Error("Navigation route geometry is empty.");
  }
  return best;
}

export function createInitialNavigationProgress(now = 0): NavigationProgress {
  return {
    stepIndex: 0,
    distanceAlongRouteMeters: 0,
    distanceToRouteMeters: 0,
    remainingDistanceMeters: 0,
    remainingDurationSeconds: 0,
    distanceToStepEndMeters: 0,
    routeBearing: 0,
    offRouteFixCount: 0,
    lastRerouteAt: now - 15000,
    arrived: false
  };
}

export function advanceNavigation(
  current: NavigationProgress,
  fix: UserLocation,
  prepared: PreparedNavigationRoute,
  mode: RouteMode,
  now = Date.now()
): NavigationAdvanceResult {
  if (fix.accuracy > 50) {
    return {
      progress: current,
      shouldReroute: false,
      accepted: false
    };
  }

  const projection = projectLocationToRoute(fix, prepared);
  const distanceAlongRouteMeters = Math.max(
    current.distanceAlongRouteMeters,
    projection.distanceAlongRouteMeters
  );
  const destination = prepared.points[prepared.points.length - 1];
  const arrivalMode = mode === "transit" ? "walk" : mode;
  const thresholds = navigationThresholds[arrivalMode];
  const arrived = distanceMeters(fix, destination) <= thresholds.arrivalMeters;
  const stepIndex = findStepIndex(distanceAlongRouteMeters, prepared.steps);
  const currentStep = prepared.steps[stepIndex];
  const isTransitVehicleStep =
    mode === "transit" && currentStep && currentStep.step.travelMode !== "WALK";
  const isOffRoute = !isTransitVehicleStep && projection.distanceToRouteMeters > thresholds.offRouteMeters;
  const offRouteFixCount = isOffRoute ? current.offRouteFixCount + 1 : 0;
  const shouldReroute =
    !arrived && offRouteFixCount >= 2 && now - current.lastRerouteAt >= 15000;
  const remainingRatio =
    prepared.totalGeometryMeters > 0
      ? Math.max(0, 1 - distanceAlongRouteMeters / prepared.totalGeometryMeters)
      : 0;
  const routeDistance = prepared.route.distanceMeters || prepared.totalGeometryMeters;
  const remainingDistanceMeters = Math.max(0, routeDistance * remainingRatio);

  return {
    progress: {
      stepIndex,
      distanceAlongRouteMeters,
      distanceToRouteMeters: projection.distanceToRouteMeters,
      remainingDistanceMeters,
      remainingDurationSeconds: Math.max(0, prepared.route.durationSeconds * remainingRatio),
      distanceToStepEndMeters: currentStep
        ? Math.max(0, currentStep.routeEndMeters - distanceAlongRouteMeters)
        : remainingDistanceMeters,
      routeBearing: projection.bearing,
      offRouteFixCount: shouldReroute ? 0 : offRouteFixCount,
      lastRerouteAt: shouldReroute ? now : current.lastRerouteAt,
      arrived,
      lastAcceptedFixAt: now
    },
    shouldReroute,
    accepted: true
  };
}

export function gpsSignalState(lastFixTimestamp: number | undefined, now = Date.now()) {
  if (!lastFixTimestamp) return "waiting" as const;
  const age = now - lastFixTimestamp;
  if (age > 30000) return "paused" as const;
  if (age > 10000) return "weak" as const;
  return "ok" as const;
}

export function distanceMeters(a: RouteCoordinate, b: RouteCoordinate) {
  const latitudeDelta = toRadians(b.lat - a.lat);
  const longitudeDelta = toRadians(b.lon - a.lon);
  const latitudeA = toRadians(a.lat);
  const latitudeB = toRadians(b.lat);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.sin(longitudeDelta / 2) ** 2 * Math.cos(latitudeA) * Math.cos(latitudeB);
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export function bearingBetween(a: RouteCoordinate, b: RouteCoordinate) {
  const latitudeA = toRadians(a.lat);
  const latitudeB = toRadians(b.lat);
  const longitudeDelta = toRadians(b.lon - a.lon);
  const y = Math.sin(longitudeDelta) * Math.cos(latitudeB);
  const x =
    Math.cos(latitudeA) * Math.sin(latitudeB) -
    Math.sin(latitudeA) * Math.cos(latitudeB) * Math.cos(longitudeDelta);
  return normalizeAngle((Math.atan2(y, x) * 180) / Math.PI);
}

export function offsetCoordinate(origin: RouteCoordinate, bearing: number, meters: number): RouteCoordinate {
  const angularDistance = meters / EARTH_RADIUS_METERS;
  const bearingRadians = toRadians(bearing);
  const latitude = toRadians(origin.lat);
  const longitude = toRadians(origin.lon);
  const targetLatitude = Math.asin(
    Math.sin(latitude) * Math.cos(angularDistance) +
      Math.cos(latitude) * Math.sin(angularDistance) * Math.cos(bearingRadians)
  );
  const targetLongitude =
    longitude +
    Math.atan2(
      Math.sin(bearingRadians) * Math.sin(angularDistance) * Math.cos(latitude),
      Math.cos(angularDistance) - Math.sin(latitude) * Math.sin(targetLatitude)
    );
  return {
    lat: (targetLatitude * 180) / Math.PI,
    lon: (targetLongitude * 180) / Math.PI
  };
}

function findStepIndex(
  distanceAlongRouteMeters: number,
  steps: PreparedNavigationRoute["steps"]
) {
  const found = steps.findIndex((step) => distanceAlongRouteMeters <= step.routeEndMeters);
  return found >= 0 ? found : Math.max(0, steps.length - 1);
}

function projectToSegment(location: RouteCoordinate, start: RouteCoordinate, end: RouteCoordinate) {
  const referenceLatitude = toRadians((start.lat + end.lat + location.lat) / 3);
  const scaleX = Math.cos(referenceLatitude) * 111320;
  const scaleY = 110540;
  const endX = (end.lon - start.lon) * scaleX;
  const endY = (end.lat - start.lat) * scaleY;
  const pointX = (location.lon - start.lon) * scaleX;
  const pointY = (location.lat - start.lat) * scaleY;
  const lengthSquared = endX * endX + endY * endY;
  const fraction =
    lengthSquared > 0 ? Math.max(0, Math.min(1, (pointX * endX + pointY * endY) / lengthSquared)) : 0;
  const coordinate = {
    lat: start.lat + (end.lat - start.lat) * fraction,
    lon: start.lon + (end.lon - start.lon) * fraction
  };
  return {
    coordinate,
    distanceMeters: Math.hypot(pointX - endX * fraction, pointY - endY * fraction),
    fraction
  };
}

function normalizeAngle(value: number) {
  return ((value % 360) + 360) % 360;
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function decodeValue(encoded: string, startIndex: number) {
  let result = 0;
  let shift = 0;
  let index = startIndex;
  let byte = 0;

  do {
    if (index >= encoded.length) {
      throw new Error("Invalid encoded polyline.");
    }
    byte = encoded.charCodeAt(index) - 63;
    index += 1;
    result |= (byte & 0x1f) << shift;
    shift += 5;
  } while (byte >= 0x20);

  return {
    value: result & 1 ? ~(result >> 1) : result >> 1,
    nextIndex: index
  };
}

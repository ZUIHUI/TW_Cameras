import { bearingBetween, distanceMeters } from "./navigationEngine";
import type { NavigationPlan, RouteCoordinate, RouteOption, RouteStep, UserLocation } from "./types";

export function createNavigationDemo() {
  const points: RouteCoordinate[] = [
    { lat: 25.033, lon: 121.565 },
    { lat: 25.036, lon: 121.565 },
    { lat: 25.036, lon: 121.57 },
    { lat: 25.033, lon: 121.57 }
  ];
  const instructions = ["向北直行", "右轉後向東直行", "右轉後向南前進至目的地"];
  const maneuvers = ["STRAIGHT", "TURN_RIGHT", "TURN_RIGHT"];
  const steps: RouteStep[] = points.slice(0, -1).map((start, index) => {
    const end = points[index + 1];
    const distance = Math.round(distanceMeters(start, end));
    return {
      id: `demo-step-${index + 1}`,
      distanceMeters: distance,
      durationSeconds: Math.max(20, Math.round(distance / 6)),
      polyline: encodePolyline([start, end]),
      start,
      end,
      instruction: instructions[index],
      maneuver: maneuvers[index],
      travelMode: "TWO_WHEELER"
    };
  });
  const distance = steps.reduce((sum, step) => sum + step.distanceMeters, 0);
  const duration = steps.reduce((sum, step) => sum + step.durationSeconds, 0);
  const route: RouteOption = {
    id: "route-1",
    labels: ["DEFAULT_ROUTE"],
    distanceMeters: distance,
    durationSeconds: duration,
    viewport: {
      south: 25.0324,
      west: 121.5644,
      north: 25.0366,
      east: 121.5706
    },
    polyline: encodePolyline(points),
    warnings: [],
    legs: [
      {
        id: "demo-leg-1",
        distanceMeters: distance,
        durationSeconds: duration,
        start: points[0],
        end: points[points.length - 1],
        steps
      }
    ]
  };
  const plan: NavigationPlan = {
    request: {
      origin: points[0],
      destination: points[points.length - 1],
      mode: "two-wheeler",
      alternatives: true
    },
    originLabel: "目前位置",
    destination: {
      id: "navigation-demo-destination",
      title: "導航測試終點",
      address: "台北市信義區",
      ...points[points.length - 1]
    }
  };

  return {
    plan,
    route,
    fixes: interpolateRoute(points, 6).map((coordinate, index, fixes) => {
      const next = fixes[Math.min(index + 1, fixes.length - 1)] || coordinate;
      return {
        ...coordinate,
        accuracy: 8,
        heading: bearingBetween(coordinate, next),
        speed: 6,
        timestamp: Date.now() + index * 900
      } satisfies UserLocation;
    })
  };
}

function interpolateRoute(points: RouteCoordinate[], pointsPerSegment: number) {
  const fixes: RouteCoordinate[] = [];
  points.slice(0, -1).forEach((start, segmentIndex) => {
    const end = points[segmentIndex + 1];
    for (let index = 0; index < pointsPerSegment; index += 1) {
      const fraction = index / pointsPerSegment;
      fixes.push({
        lat: start.lat + (end.lat - start.lat) * fraction,
        lon: start.lon + (end.lon - start.lon) * fraction
      });
    }
  });
  fixes.push(points[points.length - 1]);
  return fixes;
}

function encodePolyline(points: RouteCoordinate[]) {
  let previousLatitude = 0;
  let previousLongitude = 0;
  return points
    .map((point) => {
      const latitude = Math.round(point.lat * 1e5);
      const longitude = Math.round(point.lon * 1e5);
      const encoded =
        encodeValue(latitude - previousLatitude) +
        encodeValue(longitude - previousLongitude);
      previousLatitude = latitude;
      previousLongitude = longitude;
      return encoded;
    })
    .join("");
}

function encodeValue(value: number) {
  let shifted = value < 0 ? ~(value << 1) : value << 1;
  let output = "";
  while (shifted >= 0x20) {
    output += String.fromCharCode((0x20 | (shifted & 0x1f)) + 63);
    shifted >>= 5;
  }
  return output + String.fromCharCode(shifted + 63);
}

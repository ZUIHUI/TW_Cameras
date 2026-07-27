import { config } from "../config.js";
import { UpstreamError } from "../http.js";
import type {
  RouteCoordinate,
  RouteLeg,
  RouteMode,
  RouteOption,
  RouteRequest,
  RouteResponse,
  RouteStep,
  RouteTransitDetails,
  RouteViewport
} from "../types.js";

const ROUTES_API_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";
const REQUEST_TIMEOUT_MS = 15000;
const TAIWAN_BOUNDS = {
  south: 20,
  west: 118,
  north: 26.5,
  east: 123
};

const ROUTES_FIELD_MASK = [
  "routes.routeLabels",
  "routes.distanceMeters",
  "routes.duration",
  "routes.viewport",
  "routes.polyline.encodedPolyline",
  "routes.legs.distanceMeters",
  "routes.legs.duration",
  "routes.legs.startLocation",
  "routes.legs.endLocation",
  "routes.legs.steps.distanceMeters",
  "routes.legs.steps.staticDuration",
  "routes.legs.steps.polyline.encodedPolyline",
  "routes.legs.steps.startLocation",
  "routes.legs.steps.endLocation",
  "routes.legs.steps.navigationInstruction",
  "routes.legs.steps.travelMode",
  "routes.legs.steps.transitDetails"
].join(",");

const MODE_TO_GOOGLE: Record<RouteMode, string> = {
  "two-wheeler": "TWO_WHEELER",
  walk: "WALK",
  bicycle: "BICYCLE",
  transit: "TRANSIT"
};

const TRANSIT_MODE_TO_GOOGLE = {
  bus: "BUS",
  subway: "SUBWAY",
  train: "TRAIN",
  "light-rail": "LIGHT_RAIL",
  rail: "RAIL"
} as const;

const BETA_WARNING =
  "步行、自行車與機車路線仍為 Beta 版，實際道路狀況可能與建議路線不同，請隨時注意周遭環境。";

export type RouteRequestParseResult =
  | { ok: true; value: RouteRequest }
  | { ok: false; message: string };

interface GoogleRoutesResponse {
  routes?: GoogleRoute[];
}

interface GoogleRoute {
  routeLabels?: string[];
  distanceMeters?: number;
  duration?: string;
  viewport?: GoogleViewport;
  polyline?: GooglePolyline;
  legs?: GoogleLeg[];
}

interface GoogleViewport {
  low?: GoogleLatLng;
  high?: GoogleLatLng;
}

interface GooglePolyline {
  encodedPolyline?: string;
}

interface GoogleLocation {
  latLng?: GoogleLatLng;
}

interface GoogleLatLng {
  latitude?: number;
  longitude?: number;
}

interface GoogleLeg {
  distanceMeters?: number;
  duration?: string;
  startLocation?: GoogleLocation;
  endLocation?: GoogleLocation;
  steps?: GoogleStep[];
}

interface GoogleStep {
  distanceMeters?: number;
  staticDuration?: string;
  polyline?: GooglePolyline;
  startLocation?: GoogleLocation;
  endLocation?: GoogleLocation;
  navigationInstruction?: {
    maneuver?: string;
    instructions?: string;
  };
  travelMode?: string;
  transitDetails?: GoogleTransitDetails;
}

interface GoogleTransitDetails {
  stopDetails?: {
    arrivalStop?: GoogleTransitStop;
    arrivalTime?: string;
    departureStop?: GoogleTransitStop;
    departureTime?: string;
  };
  headsign?: string;
  headway?: string;
  stopCount?: number;
  transitLine?: {
    name?: string;
    nameShort?: string;
    color?: string;
    textColor?: string;
    vehicle?: {
      name?: { text?: string };
      type?: string;
    };
  };
  tripShortText?: string;
}

interface GoogleTransitStop {
  name?: string;
  location?: GoogleLocation;
}

export function parseRouteRequest(input: unknown): RouteRequestParseResult {
  if (!isRecord(input)) {
    return invalid("request body must be an object.");
  }

  const origin = parseCoordinate(input.origin);
  const destination = parseCoordinate(input.destination);
  if (!origin || !destination) {
    return invalid("origin and destination must be coordinates within Taiwan.");
  }

  const mode = input.mode;
  if (mode !== "two-wheeler" && mode !== "walk" && mode !== "bicycle" && mode !== "transit") {
    return invalid("mode must be two-wheeler, walk, bicycle, or transit.");
  }

  if (input.alternatives !== true) {
    return invalid("alternatives must be true.");
  }

  const request: RouteRequest = {
    origin,
    destination,
    mode,
    alternatives: true
  };

  if (input.avoid !== undefined) {
    if (mode !== "two-wheeler" || !isRecord(input.avoid)) {
      return invalid("avoid preferences are only available for two-wheeler routes.");
    }
    request.avoid = {
      tolls: Boolean(input.avoid.tolls),
      highways: Boolean(input.avoid.highways),
      ferries: Boolean(input.avoid.ferries)
    };
  }

  if (input.transit !== undefined) {
    if (mode !== "transit" || !isRecord(input.transit)) {
      return invalid("transit preferences are only available for transit routes.");
    }

    const transit = parseTransitPreferences(input.transit);
    if (!transit.ok) {
      return transit;
    }
    request.transit = transit.value;
  }

  return { ok: true, value: request };
}

export function buildGoogleRoutesRequest(request: RouteRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    origin: googleWaypoint(request.origin),
    destination: googleWaypoint(request.destination),
    travelMode: MODE_TO_GOOGLE[request.mode],
    computeAlternativeRoutes: request.alternatives,
    polylineEncoding: "ENCODED_POLYLINE",
    polylineQuality: "HIGH_QUALITY",
    languageCode: "zh-TW",
    regionCode: "TW",
    units: "METRIC"
  };

  if (request.mode === "two-wheeler") {
    body.routingPreference = "TRAFFIC_AWARE";
    body.routeModifiers = {
      avoidTolls: Boolean(request.avoid?.tolls),
      avoidHighways: Boolean(request.avoid?.highways),
      avoidFerries: Boolean(request.avoid?.ferries)
    };
  }

  if (request.mode === "transit") {
    const transit = request.transit;
    if (transit?.timeMode === "arrive-by" && transit.dateTime) {
      body.arrivalTime = transit.dateTime;
    } else if (transit?.timeMode === "depart-at" && transit.dateTime) {
      body.departureTime = transit.dateTime;
    } else {
      body.departureTime = new Date().toISOString();
    }

    const transitPreferences: Record<string, unknown> = {};
    if (transit?.preference && transit.preference !== "default") {
      transitPreferences.routingPreference =
        transit.preference === "less-walking" ? "LESS_WALKING" : "FEWER_TRANSFERS";
    }
    if (transit?.modes?.length) {
      transitPreferences.allowedTravelModes = transit.modes.map((mode) => TRANSIT_MODE_TO_GOOGLE[mode]);
    }
    if (Object.keys(transitPreferences).length) {
      body.transitPreferences = transitPreferences;
    }
  }

  return body;
}

export async function computeRoutes(
  request: RouteRequest,
  fetcher: typeof fetch = fetch,
  apiKey = config.googleRoutesApiKey
): Promise<RouteResponse> {
  if (!apiKey) {
    throw new UpstreamError("GOOGLE_ROUTES_API_KEY is not configured.", 503);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetcher(ROUTES_API_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": ROUTES_FIELD_MASK
      },
      body: JSON.stringify(buildGoogleRoutesRequest(request))
    });

    if (!response.ok) {
      throw await googleRoutesError(response);
    }

    const payload = (await response.json()) as GoogleRoutesResponse;
    return normalizeGoogleRoutes(payload, request.mode);
  } catch (error) {
    if (error instanceof UpstreamError) {
      throw error;
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new UpstreamError("Google Routes request timed out.", 504);
    }
    throw new UpstreamError(error instanceof Error ? error.message : "Google Routes request failed.");
  } finally {
    clearTimeout(timeout);
  }
}

export function normalizeGoogleRoutes(payload: GoogleRoutesResponse, mode: RouteMode): RouteResponse {
  const routes = (payload.routes || [])
    .map((route, routeIndex) => normalizeRoute(route, routeIndex, mode))
    .filter((route): route is RouteOption => Boolean(route))
    .slice(0, 3);

  if (!routes.length) {
    throw new UpstreamError("Google Routes did not return a usable route.", 422);
  }

  return { routes };
}

function normalizeRoute(route: GoogleRoute, routeIndex: number, mode: RouteMode): RouteOption | undefined {
  const polyline = route.polyline?.encodedPolyline || "";
  const viewport = normalizeViewport(route.viewport);
  const legs = (route.legs || [])
    .map((leg, legIndex) => normalizeLeg(leg, routeIndex, legIndex))
    .filter((leg): leg is RouteLeg => Boolean(leg));

  if (!polyline || !viewport || !legs.length) {
    return undefined;
  }

  return {
    id: `route-${routeIndex + 1}`,
    labels: route.routeLabels || [],
    distanceMeters: finiteNumber(route.distanceMeters),
    durationSeconds: durationSeconds(route.duration),
    viewport,
    polyline,
    legs,
    warnings: mode === "transit" ? [] : [BETA_WARNING]
  };
}

function normalizeLeg(leg: GoogleLeg, routeIndex: number, legIndex: number): RouteLeg | undefined {
  const start = normalizeCoordinate(leg.startLocation?.latLng);
  const end = normalizeCoordinate(leg.endLocation?.latLng);
  if (!start || !end) {
    return undefined;
  }

  const steps = (leg.steps || [])
    .map((step, stepIndex) => normalizeStep(step, routeIndex, legIndex, stepIndex))
    .filter((step): step is RouteStep => Boolean(step));

  return {
    id: `route-${routeIndex + 1}-leg-${legIndex + 1}`,
    distanceMeters: finiteNumber(leg.distanceMeters),
    durationSeconds: durationSeconds(leg.duration),
    start,
    end,
    steps
  };
}

function normalizeStep(
  step: GoogleStep,
  routeIndex: number,
  legIndex: number,
  stepIndex: number
): RouteStep | undefined {
  const start = normalizeCoordinate(step.startLocation?.latLng);
  const end = normalizeCoordinate(step.endLocation?.latLng);
  if (!start || !end) {
    return undefined;
  }

  return {
    id: `route-${routeIndex + 1}-leg-${legIndex + 1}-step-${stepIndex + 1}`,
    distanceMeters: finiteNumber(step.distanceMeters),
    durationSeconds: durationSeconds(step.staticDuration),
    polyline: step.polyline?.encodedPolyline || "",
    start,
    end,
    instruction: step.navigationInstruction?.instructions?.trim() || "繼續前進",
    maneuver: step.navigationInstruction?.maneuver || "MANEUVER_UNSPECIFIED",
    travelMode: step.travelMode || "TRAVEL_MODE_UNSPECIFIED",
    transit: normalizeTransitDetails(step.transitDetails)
  };
}

function normalizeTransitDetails(details: GoogleTransitDetails | undefined): RouteTransitDetails | undefined {
  if (!details) {
    return undefined;
  }

  const lineName = details.transitLine?.name?.trim();
  return {
    arrivalStop: normalizeTransitStop(details.stopDetails?.arrivalStop),
    departureStop: normalizeTransitStop(details.stopDetails?.departureStop),
    arrivalTime: details.stopDetails?.arrivalTime,
    departureTime: details.stopDetails?.departureTime,
    headsign: details.headsign,
    headwaySeconds: durationSeconds(details.headway),
    stopCount: details.stopCount,
    tripShortText: details.tripShortText,
    line: lineName
      ? {
          name: lineName,
          shortName: details.transitLine?.nameShort,
          color: details.transitLine?.color,
          textColor: details.transitLine?.textColor,
          vehicleName: details.transitLine?.vehicle?.name?.text,
          vehicleType: details.transitLine?.vehicle?.type
        }
      : undefined
  };
}

function normalizeTransitStop(stop: GoogleTransitStop | undefined) {
  const name = stop?.name?.trim();
  if (!name) {
    return undefined;
  }
  const coordinate = normalizeCoordinate(stop?.location?.latLng);
  return {
    name,
    lat: coordinate?.lat,
    lon: coordinate?.lon
  };
}

function normalizeViewport(viewport: GoogleViewport | undefined): RouteViewport | undefined {
  const low = normalizeCoordinate(viewport?.low);
  const high = normalizeCoordinate(viewport?.high);
  if (!low || !high) {
    return undefined;
  }
  return {
    south: low.lat,
    west: low.lon,
    north: high.lat,
    east: high.lon
  };
}

function parseTransitPreferences(
  input: Record<string, unknown>
): { ok: true; value: NonNullable<RouteRequest["transit"]> } | { ok: false; message: string } {
  const timeMode = input.timeMode ?? "now";
  if (timeMode !== "now" && timeMode !== "depart-at" && timeMode !== "arrive-by") {
    return invalid("transit.timeMode is invalid.");
  }

  const dateTime = typeof input.dateTime === "string" ? input.dateTime.trim() : undefined;
  if (timeMode !== "now" && (!dateTime || !Number.isFinite(Date.parse(dateTime)))) {
    return invalid("transit.dateTime must be a valid ISO date for scheduled trips.");
  }

  const preference = input.preference ?? "default";
  if (preference !== "default" && preference !== "less-walking" && preference !== "fewer-transfers") {
    return invalid("transit.preference is invalid.");
  }

  let modes: NonNullable<RouteRequest["transit"]>["modes"];
  if (input.modes !== undefined) {
    if (!Array.isArray(input.modes)) {
      return invalid("transit.modes must be an array.");
    }
    const allowed = new Set(["bus", "subway", "train", "light-rail", "rail"]);
    if (input.modes.some((mode) => typeof mode !== "string" || !allowed.has(mode))) {
      return invalid("transit.modes contains an unsupported mode.");
    }
    modes = [...new Set(input.modes)] as NonNullable<RouteRequest["transit"]>["modes"];
  }

  return {
    ok: true,
    value: {
      timeMode,
      dateTime,
      preference,
      modes
    }
  };
}

function parseCoordinate(value: unknown): RouteCoordinate | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const lat = Number(value.lat);
  const lon = Number(value.lon);
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    lat < TAIWAN_BOUNDS.south ||
    lat > TAIWAN_BOUNDS.north ||
    lon < TAIWAN_BOUNDS.west ||
    lon > TAIWAN_BOUNDS.east
  ) {
    return undefined;
  }
  return { lat, lon };
}

function normalizeCoordinate(value: GoogleLatLng | undefined): RouteCoordinate | undefined {
  const lat = value?.latitude;
  const lon = value?.longitude;
  return Number.isFinite(lat) && Number.isFinite(lon) && lat !== undefined && lon !== undefined
    ? { lat, lon }
    : undefined;
}

function googleWaypoint(coordinate: RouteCoordinate) {
  return {
    location: {
      latLng: {
        latitude: coordinate.lat,
        longitude: coordinate.lon
      }
    }
  };
}

function finiteNumber(value: number | undefined) {
  return Number.isFinite(value) && value !== undefined ? value : 0;
}

function durationSeconds(value: string | undefined) {
  const parsed = Number.parseFloat(value?.replace(/s$/, "") || "0");
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function invalid(message: string): { ok: false; message: string } {
  return { ok: false, message };
}

async function googleRoutesError(response: Response) {
  const payload = (await response.json().catch(() => undefined)) as
    | { error?: { message?: string; status?: string } }
    | undefined;
  const googleMessage = payload?.error?.message?.trim();
  const message = googleMessage
    ? `Google Routes rejected the request: ${googleMessage.slice(0, 240)}`
    : `Google Routes responded ${response.status}.`;

  if (response.status === 429) {
    return new UpstreamError(message, 503);
  }
  if (response.status >= 500) {
    return new UpstreamError(message, 502);
  }
  if (response.status === 401 || response.status === 403) {
    return new UpstreamError("Google Routes credentials are not authorized for this request.", 502);
  }
  return new UpstreamError(message, response.status);
}

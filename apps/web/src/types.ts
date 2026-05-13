export type CameraCategory = "freeway" | "highway" | "city" | "scenic";
export type StreamType = "hls" | "mjpeg" | "snapshot" | "webpage" | "unknown";
export type CameraStatus = "online" | "offline" | "unknown";
export type SourceHealthStatus = "ok" | "partial" | "unavailable";

export interface Camera {
  id: string;
  source: string;
  sourceCameraId: string;
  title: string;
  category: CameraCategory;
  county: string;
  town: string;
  roadName: string;
  lat: number;
  lon: number;
  streamUrl: string;
  streamType: StreamType;
  sourcePageUrl: string;
  attribution: string;
  status: CameraStatus;
  updatedAt: string;
}

export interface VehicleDetector {
  id: string;
  source: string;
  vdId: string;
  title: string;
  roadName: string;
  roadSection: {
    start: string;
    end: string;
  };
  lat: number;
  lon: number;
  biDirectional: number;
  detectionLinks: Array<{
    linkId: string;
    bearing: string;
    roadDirection: string;
    laneNum: number;
    actualLaneNum: number;
  }>;
  attribution: string;
  updatedAt: string;
}

export interface SourceError {
  source: string;
  endpoint: string;
  message: string;
}

export interface CameraCatalogSummary {
  cameras: {
    total: number;
    byCategory: Record<CameraCategory, number>;
    byStreamType: Record<StreamType, number>;
    byCounty: Record<string, number>;
  };
  vehicleDetectors: {
    total: number;
  };
  sourceHealth: {
    status: SourceHealthStatus;
    errorCount: number;
  };
}

export interface CameraCatalogResponse {
  cameras: Camera[];
  vehicleDetectors: VehicleDetector[];
  sourceErrors: SourceError[];
  summary: CameraCatalogSummary;
  updatedAt: string;
  cache: {
    updatedAt: string;
    stale: boolean;
    error?: string;
  };
}

export interface EnvironmentSummary {
  county: string;
  weather?: {
    county: string;
    description: string;
    minTemperature?: number;
    maxTemperature?: number;
    rainProbability?: number;
    comfort?: string;
    updatedAt?: string;
  };
  aqi?: {
    county: string;
    averageAqi?: number;
    maxAqi?: number;
    status?: string;
    dominantPollutant?: string;
    stationCount: number;
    updatedAt?: string;
  };
  waterLevel?: {
    county: string;
    stationCount: number;
    latestRecordTime?: string;
    note: string;
  };
  sourceErrors: SourceError[];
  updatedAt: string;
}

export interface RadarOverlayResponse {
  datasetId: string;
  title: string;
  imageUrl: string;
  mimeType: string;
  dateTime: string;
  bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
  imageDimension?: {
    width: number;
    height: number;
  };
  updatedAt: string;
  cache: {
    updatedAt: string;
    stale: boolean;
    error?: string;
  };
}

export interface RainfallStation {
  stationId: string;
  stationName: string;
  county: string;
  town: string;
  lat: number;
  lon: number;
  distanceMeters: number;
  obsTime: string;
  rain10Min?: number;
  rain1Hour?: number;
  rain3Hour?: number;
  rain24Hour?: number;
  updatedAt: string;
}

export interface RainfallResponse {
  origin: {
    lat: number;
    lon: number;
    radiusMeters: number;
  };
  stations: RainfallStation[];
  updatedAt: string;
  cache: {
    updatedAt: string;
    stale: boolean;
    error?: string;
  };
}

export type TourismItemType = "attraction" | "restaurant" | "activity";

export interface NearbyTourismItem {
  id: string;
  type: TourismItemType;
  title: string;
  description: string;
  address: string;
  phone: string;
  distanceMeters: number;
  lat: number;
  lon: number;
  url: string;
  imageUrl: string;
  updatedAt: string;
}

export interface GoogleRestaurantItem {
  id: string;
  type: "restaurant";
  source: "Google Places";
  title: string;
  address: string;
  distanceMeters: number;
  lat: number;
  lon: number;
  googleMapsUrl: string;
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  businessStatus?: string;
}

export interface NearbyTourismResponse {
  origin: {
    lat: number;
    lon: number;
    radiusMeters: number;
  };
  attractions: NearbyTourismItem[];
  restaurants: NearbyTourismItem[];
  activities: NearbyTourismItem[];
  sourceErrors: SourceError[];
  updatedAt: string;
  cache: {
    updatedAt: string;
    stale: boolean;
    error?: string;
  };
}

export interface UserLocation {
  lat: number;
  lon: number;
}

export interface SearchPlace {
  id: string;
  title: string;
  address: string;
  lat: number;
  lon: number;
}

export type CameraFilter = "all" | "nearby" | CameraCategory | "favorites";

export interface VisibleLayers {
  cameras: boolean;
  radar: boolean;
  vehicleDetectors: boolean;
}

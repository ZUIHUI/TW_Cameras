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

export interface CameraCatalog {
  cameras: Camera[];
  vehicleDetectors: VehicleDetector[];
  sourceErrors: SourceError[];
  summary: CameraCatalogSummary;
  updatedAt: string;
}

export interface WeatherSummary {
  county: string;
  description: string;
  minTemperature?: number;
  maxTemperature?: number;
  rainProbability?: number;
  comfort?: string;
  updatedAt?: string;
}

export interface AqiSummary {
  county: string;
  averageAqi?: number;
  maxAqi?: number;
  status?: string;
  dominantPollutant?: string;
  stationCount: number;
  updatedAt?: string;
}

export interface WaterLevelSummary {
  county: string;
  stationCount: number;
  latestRecordTime?: string;
  note: string;
}

export interface EnvironmentSummary {
  county: string;
  weather?: WeatherSummary;
  aqi?: AqiSummary;
  waterLevel?: WaterLevelSummary;
  sourceErrors: SourceError[];
  updatedAt: string;
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

export interface NearbyTourismSummary {
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
}

export interface SourceInfo {
  id: string;
  name: string;
  url: string;
  licenseUrl: string;
  cadence: string;
  notes: string;
}

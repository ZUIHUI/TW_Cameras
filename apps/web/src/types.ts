export type CameraCategory = "freeway" | "highway" | "city";
export type StreamType = "hls" | "mjpeg" | "snapshot" | "unknown";
export type CameraStatus = "online" | "offline" | "unknown";

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

export interface SourceError {
  source: string;
  endpoint: string;
  message: string;
}

export interface CameraCatalogResponse {
  cameras: Camera[];
  sourceErrors: SourceError[];
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

export interface UserLocation {
  lat: number;
  lon: number;
}

export type CategoryFilter = "all" | "nearby" | CameraCategory | "favorites";

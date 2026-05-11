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

export interface CameraCatalog {
  cameras: Camera[];
  sourceErrors: SourceError[];
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

export interface SourceInfo {
  id: string;
  name: string;
  url: string;
  licenseUrl: string;
  cadence: string;
  notes: string;
}

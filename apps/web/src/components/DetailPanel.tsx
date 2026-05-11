import { AlertCircle, ExternalLink, Heart, ShieldCheck, Video, X } from "lucide-react";
import type { Camera, EnvironmentSummary, VehicleDetector } from "../types";

interface DetailPanelProps {
  camera?: Camera;
  vehicleDetector?: VehicleDetector;
  environment?: EnvironmentSummary;
  environmentError: string;
  isFavorite: boolean;
  onClose: () => void;
  onToggleFavorite: () => void;
}

export function DetailPanel({
  camera,
  vehicleDetector,
  environment,
  environmentError,
  isFavorite,
  onClose,
  onToggleFavorite
}: DetailPanelProps) {
  const item = camera || vehicleDetector;
  if (!item) return null;

  return (
    <section className="detail-panel" aria-label="詳情">
      <div className="detail-header">
        <div>
          <span className={`badge ${camera ? camera.category : 'traffic'}`}>{itemLabel(item)}</span>
          <h2>{item.title}</h2>
          <p>
            {item.source}
          </p>
        </div>
        <div className="detail-actions">
          {camera && (
            <button className="icon-button" type="button" onClick={onToggleFavorite} title="切換收藏">
              <Heart size={19} fill={isFavorite ? "currentColor" : "none"} />
            </button>
          )}
          <button className="icon-button" type="button" onClick={onClose} title="關閉詳情">
            <X size={19} />
          </button>
        </div>
      </div>

      {camera && <StreamPreview camera={camera} />}
      {vehicleDetector && <VehicleDetectorInfo vd={vehicleDetector} />}

      <div className="fact-grid">
        <div>
          <span>座標</span>
          <strong>
            {item.lat.toFixed(5)}, {item.lon.toFixed(5)}
          </strong>
        </div>
        {camera && (
          <>
            <div>
              <span>串流</span>
              <strong>{camera.streamType.toUpperCase()}</strong>
            </div>
            <div>
              <span>最後更新</span>
              <strong>{formatDate(camera.updatedAt)}</strong>
            </div>
            <div>
              <span>來源</span>
              <strong>{camera.attribution}</strong>
            </div>
          </>
        )}
        {vehicleDetector && (
          <>
            <div>
              <span>最後更新</span>
              <strong>{formatDate(vehicleDetector.updatedAt)}</strong>
            </div>
            <div>
              <span>來源</span>
              <strong>{vehicleDetector.attribution}</strong>
            </div>
          </>
        )}
      </div>

      {camera && <EnvironmentBlock environment={environment} error={environmentError} />}

      <div className="detail-footer">
        {camera && (
          <a href={camera.sourcePageUrl || camera.streamUrl} rel="noreferrer" target="_blank">
            <ExternalLink size={16} />
            開啟來源
          </a>
        )}
        <span>
          <ShieldCheck size={15} />
          不轉存、不錄製影像
        </span>
      </div>
    </section>
  );
}

function StreamPreview({ camera }: { camera: Camera }) {
  if (camera.streamType === "snapshot") {
    return (
      <div className="stream-frame">
        <img alt={`${camera.title} 即時影像`} src={camera.streamUrl} />
      </div>
    );
  }

  if (camera.streamType === "mjpeg" || camera.streamType === "unknown") {
    return (
      <div className="stream-frame">
        <img
          alt={`${camera.title} 即時影像`}
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
          src={camera.streamUrl}
        />
        <div className="stream-fallback">
          <Video size={28} />
          <span>若瀏覽器無法直接播放，請開啟來源檢視。</span>
        </div>
      </div>
    );
  }

  return (
    <div className="stream-frame">
      <video controls muted playsInline preload="metadata" src={camera.streamUrl} />
      <div className="stream-fallback">
        <Video size={28} />
        <span>此瀏覽器可能不支援 HLS，Safari 或 iOS 上通常可直接播放。</span>
      </div>
    </div>
  );
}

function EnvironmentBlock({ environment, error }: { environment?: EnvironmentSummary; error: string }) {
  if (error) {
    return (
      <div className="environment-block">
        <div className="status-message warning">
          <AlertCircle size={17} />
          <span>環境資訊暫時無法取得：{error}</span>
        </div>
      </div>
    );
  }

  if (!environment) {
    return (
      <div className="environment-block">
        <h3>附近環境</h3>
        <p className="muted">讀取天氣、AQI 與水位摘要中。</p>
      </div>
    );
  }

  return (
    <div className="environment-block">
      <h3>附近環境</h3>
      <div className="environment-grid">
        <div>
          <span>天氣</span>
          <strong>{environment.weather?.description || "無資料"}</strong>
          <small>{temperatureText(environment)}</small>
        </div>
        <div>
          <span>AQI</span>
          <strong>{environment.aqi?.averageAqi ?? "無資料"}</strong>
          <small>{environment.aqi?.status || `${environment.aqi?.stationCount ?? 0} 個測站`}</small>
        </div>
        <div>
          <span>水位</span>
          <strong>{environment.waterLevel?.stationCount ?? 0} 站</strong>
          <small>{environment.waterLevel?.latestRecordTime || "原始資料摘要"}</small>
        </div>
      </div>
      {environment.waterLevel?.note && <p className="muted">{environment.waterLevel.note}</p>}
    </div>
  );
}

function temperatureText(environment: EnvironmentSummary) {
  const weather = environment.weather;
  if (!weather) return "";
  const range =
    weather.minTemperature !== undefined && weather.maxTemperature !== undefined
      ? `${weather.minTemperature}-${weather.maxTemperature}°C`
      : "";
  const rain = weather.rainProbability !== undefined ? `降雨 ${weather.rainProbability}%` : "";
  return [range, rain].filter(Boolean).join(" · ");
}

function VehicleDetectorInfo({ vd }: { vd: VehicleDetector }) {
  return (
    <div className="vd-info">
      <h3>交通偵測器資訊</h3>
      <div className="vd-details">
        <div>
          <span>道路</span>
          <strong>{vd.roadName}</strong>
        </div>
        <div>
          <span>路段</span>
          <strong>{vd.roadSection.start} - {vd.roadSection.end}</strong>
        </div>
        <div>
          <span>車道數</span>
          <strong>{vd.detectionLinks.length} 個偵測區段</strong>
        </div>
        <div>
          <span>雙向</span>
          <strong>{vd.biDirectional ? '是' : '否'}</strong>
        </div>
      </div>
    </div>
  );
}

function itemLabel(item: Camera | VehicleDetector): string {
  if ('category' in item) {
    return categoryLabel(item.category);
  } else {
    return '交通流量';
  }
}

function categoryLabel(category: Camera["category"]) {
  return {
    freeway: "國道",
    highway: "省道/公路",
    city: "市區"
  }[category];
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-TW", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

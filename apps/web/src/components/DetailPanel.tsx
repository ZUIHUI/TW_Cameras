import { AlertCircle, ExternalLink, Heart, ShieldCheck, Video, X } from "lucide-react";
import type { Camera, EnvironmentSummary } from "../types";

interface DetailPanelProps {
  camera?: Camera;
  environment?: EnvironmentSummary;
  environmentError: string;
  isFavorite: boolean;
  onClose: () => void;
  onToggleFavorite: () => void;
}

export function DetailPanel({
  camera,
  environment,
  environmentError,
  isFavorite,
  onClose,
  onToggleFavorite
}: DetailPanelProps) {
  if (!camera) return null;

  return (
    <section className="detail-panel" aria-label="詳情">
      <div className="detail-header">
        <div>
          <span className={`badge ${camera.category}`}>{categoryLabel(camera.category)}</span>
          <h2>{camera.title}</h2>
          <p>
            {camera.source}
          </p>
        </div>
        <div className="detail-actions">
          <button className="icon-button" type="button" onClick={onToggleFavorite} title="切換收藏">
            <Heart size={19} fill={isFavorite ? "currentColor" : "none"} />
          </button>
          <button className="icon-button" type="button" onClick={onClose} title="關閉詳情">
            <X size={19} />
          </button>
        </div>
      </div>

      <StreamPreview camera={camera} />

      <div className="fact-grid">
        <div>
          <span>座標</span>
          <strong>
            {camera.lat.toFixed(5)}, {camera.lon.toFixed(5)}
          </strong>
        </div>
        <div>
          <span>行政區</span>
          <strong>{formatCountyTown(camera)}</strong>
        </div>
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
      </div>

      <EnvironmentBlock environment={environment} error={environmentError} />

      <div className="detail-footer">
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
      <div className="stream-preview">
        <div className="stream-frame">
          <img alt={`${camera.title} 即時影像`} src={camera.streamUrl} />
        </div>
        <SourceLink camera={camera} />
      </div>
    );
  }

  if (camera.streamType === "mjpeg" || camera.streamType === "unknown") {
    return (
      <div className="stream-preview">
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
        <SourceLink camera={camera} />
      </div>
    );
  }

  if (camera.streamType === "webpage") {
    return (
      <div className="stream-preview">
        <div className="stream-frame webpage">
          <iframe
            allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
            allowFullScreen
            referrerPolicy="no-referrer"
            sandbox="allow-forms allow-same-origin allow-scripts allow-presentation"
            src={camera.streamUrl}
            title={`${camera.title} 即時影像播放頁`}
          />
        </div>
        <SourceLink camera={camera} />
      </div>
    );
  }

  return (
    <div className="stream-preview">
      <div className="stream-frame">
        <video controls muted playsInline preload="metadata" src={camera.streamUrl} />
        <div className="stream-fallback">
          <Video size={28} />
          <span>此瀏覽器可能不支援 HLS，Safari 或 iOS 上通常可直接播放。</span>
        </div>
      </div>
      <SourceLink camera={camera} />
    </div>
  );
}

function SourceLink({ camera }: { camera: Camera }) {
  return (
    <a className="stream-source-link" href={camera.sourcePageUrl || camera.streamUrl} rel="noreferrer" target="_blank">
      <ExternalLink size={16} />
      開啟來源
    </a>
  );
}

function formatCountyTown(camera: Camera) {
  return [camera.county, camera.town].filter(Boolean).join(" ") || "未標示縣市";
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
function categoryLabel(category: Camera["category"]) {
  return {
    freeway: "國道",
    highway: "省道/公路",
    city: "市區",
    scenic: "風景區"
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

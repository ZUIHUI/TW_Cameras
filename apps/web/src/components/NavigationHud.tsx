import {
  ArrowUp,
  Clock3,
  Map,
  Navigation,
  RotateCcw,
  Signal,
  Volume2,
  VolumeX,
  X
} from "lucide-react";
import type { NavigationPhase, RouteMode, RouteStep } from "../types";
import type { NavigationProgress } from "../navigationEngine";

interface NavigationHudProps {
  phase: NavigationPhase;
  mode: RouteMode;
  progress: NavigationProgress;
  step?: RouteStep;
  muted: boolean;
  overview: boolean;
  signal: "waiting" | "ok" | "weak" | "paused";
  statusMessage?: string;
  onToggleMute: () => void;
  onToggleOverview: () => void;
  onReplan: () => void;
  onStop: () => void;
}

export function NavigationHud({
  phase,
  mode,
  progress,
  step,
  muted,
  overview,
  signal,
  statusMessage,
  onToggleMute,
  onToggleOverview,
  onReplan,
  onStop
}: NavigationHudProps) {
  const arrivalTime = new Date(Date.now() + progress.remainingDurationSeconds * 1000);
  const transit = step?.transit;

  return (
    <section className="navigation-hud" aria-label="導航資訊">
      <div className="navigation-maneuver-card">
        <span className="navigation-maneuver-icon" aria-hidden="true">
          {phase === "arrived" ? <Navigation size={29} fill="currentColor" /> : <ArrowUp size={32} />}
        </span>
        <span className="navigation-maneuver-copy">
          <small>
            {phase === "rerouting"
              ? "正在重新規劃"
              : phase === "arrived"
                ? "目的地"
                : formatDistance(progress.distanceToStepEndMeters)}
          </small>
          <strong>{phase === "arrived" ? "已抵達目的地" : step?.instruction || "沿路線繼續前進"}</strong>
          {transit && (
            <span>
              {[transit.line?.shortName || transit.line?.name, transit.headsign && `往 ${transit.headsign}`]
                .filter(Boolean)
                .join(" · ")}
            </span>
          )}
        </span>
      </div>

      {(signal === "weak" || signal === "paused" || statusMessage) && (
        <div className={signal === "paused" ? "navigation-signal paused" : "navigation-signal"} role="status">
          <Signal size={16} />
          <span>
            {statusMessage ||
              (signal === "paused" ? "GPS 已超過 30 秒未更新，暫停步驟與鏡頭推進。" : "GPS 訊號較弱，等待新定位。")}
          </span>
        </div>
      )}

      {transit && (
        <div className="navigation-transit-leg">
          <strong>{transit.departureStop?.name || "上車站"}</strong>
          <span>{transit.stopCount !== undefined ? `${transit.stopCount} 站` : "依行程前進"}</span>
          <strong>{transit.arrivalStop?.name || "下車站"}</strong>
        </div>
      )}

      <div className="navigation-trip-card">
        <div className="navigation-trip-summary">
          <span>
            <strong>{formatDuration(progress.remainingDurationSeconds)}</strong>
            <small>剩餘時間</small>
          </span>
          <span>
            <strong>{formatDistance(progress.remainingDistanceMeters)}</strong>
            <small>剩餘里程</small>
          </span>
          <span>
            <strong>{arrivalTime.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}</strong>
            <small>預計抵達</small>
          </span>
        </div>
        <div className="navigation-hud-actions">
          <button type="button" onClick={onToggleMute} aria-pressed={muted}>
            {muted ? <VolumeX size={19} /> : <Volume2 size={19} />}
            <span>{muted ? "開啟語音" : "靜音"}</span>
          </button>
          <button type="button" onClick={onToggleOverview} aria-pressed={overview}>
            <Map size={19} />
            <span>{overview ? "返回導航" : "總覽"}</span>
          </button>
          {mode === "transit" && (
            <button type="button" onClick={onReplan}>
              <RotateCcw size={19} />
              <span>重規劃</span>
            </button>
          )}
          <button className="navigation-end-button" type="button" onClick={onStop}>
            <X size={19} />
            <span>結束</span>
          </button>
        </div>
        <div className="navigation-foreground-note">
          <Clock3 size={14} />
          <span>請保持此頁面在前景，鎖屏或切到背景可能中斷導航。</span>
        </div>
      </div>
    </section>
  );
}

function formatDistance(meters: number) {
  if (meters >= 1000) return `${(meters / 1000).toFixed(meters >= 10000 ? 0 : 1)} 公里`;
  return `${Math.max(0, Math.round(meters))} 公尺`;
}

function formatDuration(seconds: number) {
  const minutes = Math.max(0, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} 分`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} 小時 ${remainder} 分` : `${hours} 小時`;
}

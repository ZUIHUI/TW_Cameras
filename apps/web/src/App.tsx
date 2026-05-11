import {
  Activity,
  AlertCircle,
  ExternalLink,
  Heart,
  Layers,
  LocateFixed,
  RefreshCw,
  Search,
  Star,
  Video,
  X
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getCameras, getEnvironment } from "./api";
import { CameraMap } from "./components/CameraMap";
import { DetailPanel } from "./components/DetailPanel";
import type {
  Camera,
  CameraCatalogResponse,
  CameraFilter,
  EnvironmentSummary,
  UserLocation,
  VehicleDetector,
  VisibleLayers
} from "./types";

const cameraFilterOptions: Array<{ id: CameraFilter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "nearby", label: "附近" },
  { id: "freeway", label: "國道" },
  { id: "highway", label: "省道/公路" },
  { id: "city", label: "市區" },
  { id: "favorites", label: "收藏" }
];

const favoriteStorageKey = "taiwan-live-cam:favorites";

export default function App() {
  const [catalog, setCatalog] = useState<CameraCatalogResponse | undefined>();
  const [selectedCamera, setSelectedCamera] = useState<Camera | undefined>();
  const [selectedVehicleDetector, setSelectedVehicleDetector] = useState<VehicleDetector | undefined>();
  const [environment, setEnvironment] = useState<EnvironmentSummary | undefined>();
  const [query, setQuery] = useState("");
  const [cameraFilter, setCameraFilter] = useState<CameraFilter>("all");
  const [visibleLayers, setVisibleLayers] = useState<VisibleLayers>({
    cameras: true,
    vehicleDetectors: true
  });
  const [favorites, setFavorites] = useState<Set<string>>(() => loadFavorites());
  const [userLocation, setUserLocation] = useState<UserLocation | undefined>();
  const [visibleCount, setVisibleCount] = useState(80);
  const [loading, setLoading] = useState(true);
  const [loadingLocation, setLoadingLocation] = useState(false);
  const [error, setError] = useState("");
  const [environmentError, setEnvironmentError] = useState("");

  const summary = catalog?.summary;

  useEffect(() => {
    loadCameras();
  }, []);

  useEffect(() => {
    localStorage.setItem(favoriteStorageKey, JSON.stringify([...favorites]));
  }, [favorites]);

  useEffect(() => {
    const county = selectedCamera?.county;
    setEnvironment(undefined);
    setEnvironmentError("");

    if (!county) {
      return;
    }

    let active = true;
    getEnvironment(county)
      .then((value) => {
        if (active) setEnvironment(value);
      })
      .catch((err: unknown) => {
        if (active) setEnvironmentError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      active = false;
    };
  }, [selectedCamera?.county]);

  useEffect(() => {
    setVisibleCount(80);
  }, [cameraFilter, query, visibleLayers.cameras, visibleLayers.vehicleDetectors]);

  async function loadCameras() {
    setLoading(true);
    setError("");
    try {
      const nextCatalog = await getCameras();
      setCatalog(nextCatalog);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  function requestLocation() {
    if (!navigator.geolocation) {
      setError("此瀏覽器不支援定位。");
      return;
    }

    setLoadingLocation(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserLocation({
          lat: position.coords.latitude,
          lon: position.coords.longitude
        });
        setCameraFilter("nearby");
        setLoadingLocation(false);
      },
      () => {
        setError("無法取得定位，請確認瀏覽器權限後再試。");
        setLoadingLocation(false);
      },
      {
        enableHighAccuracy: false,
        maximumAge: 5 * 60 * 1000,
        timeout: 8000
      }
    );
  }

  function toggleFavorite(cameraId: string) {
    setFavorites((current) => {
      const next = new Set(current);
      if (next.has(cameraId)) {
        next.delete(cameraId);
      } else {
        next.add(cameraId);
      }
      return next;
    });
  }

  function toggleLayer(layer: keyof VisibleLayers) {
    setVisibleLayers((current) => {
      const next = {
        ...current,
        [layer]: !current[layer]
      };

      if (layer === "cameras" && current.cameras) {
        setSelectedCamera(undefined);
      }
      if (layer === "vehicleDetectors" && current.vehicleDetectors) {
        setSelectedVehicleDetector(undefined);
      }

      return next;
    });
  }

  function selectCamera(camera: Camera) {
    setSelectedCamera(camera);
    setSelectedVehicleDetector(undefined);
  }

  function selectVehicleDetector(vehicleDetector: VehicleDetector) {
    setSelectedVehicleDetector(vehicleDetector);
    setSelectedCamera(undefined);
  }

  const filteredCameras = useMemo(() => {
    if (!visibleLayers.cameras) {
      return [];
    }

    const allCameras = catalog?.cameras ?? [];
    const normalizedQuery = normalize(query);

    const filtered = allCameras.filter((camera) => {
      const matchesFilter =
        cameraFilter === "all" ||
        cameraFilter === "nearby" ||
        (cameraFilter === "favorites" && favorites.has(camera.id)) ||
        camera.category === cameraFilter;

      if (!matchesFilter) return false;
      if (!normalizedQuery) return true;

      return normalize([camera.title, camera.county, camera.town, camera.roadName, camera.source].join(" ")).includes(
        normalizedQuery
      );
    });

    if (cameraFilter === "nearby" && userLocation) {
      return [...filtered]
        .sort((a, b) => distanceKm(userLocation, a) - distanceKm(userLocation, b))
        .slice(0, 160);
    }

    return filtered;
  }, [catalog?.cameras, cameraFilter, favorites, query, userLocation, visibleLayers.cameras]);

  const filteredVehicleDetectors = useMemo(() => {
    if (!visibleLayers.vehicleDetectors) {
      return [];
    }

    const normalizedQuery = normalize(query);
    const allVehicleDetectors = catalog?.vehicleDetectors ?? [];
    const filtered = allVehicleDetectors.filter((vd) => {
      if (!normalizedQuery) return true;

      return normalize([vd.title, vd.roadName, vd.roadSection.start, vd.roadSection.end, vd.source].join(" ")).includes(
        normalizedQuery
      );
    });

    if (cameraFilter === "nearby" && userLocation) {
      return [...filtered]
        .sort((a, b) => distanceKm(userLocation, a) - distanceKm(userLocation, b))
        .slice(0, 160);
    }

    return filtered;
  }, [cameraFilter, catalog?.vehicleDetectors, query, userLocation, visibleLayers.vehicleDetectors]);

  useEffect(() => {
    if (selectedCamera && !filteredCameras.some((camera) => camera.id === selectedCamera.id)) {
      setSelectedCamera(undefined);
      return;
    }

    if (
      selectedVehicleDetector &&
      !filteredVehicleDetectors.some((vehicleDetector) => vehicleDetector.id === selectedVehicleDetector.id)
    ) {
      setSelectedVehicleDetector(undefined);
      return;
    }

  }, [filteredCameras, filteredVehicleDetectors, selectedCamera, selectedVehicleDetector]);

  const favoriteCount = favorites.size;
  const selectedIsFavorite = selectedCamera ? favorites.has(selectedCamera.id) : false;
  const visibleCameras = filteredCameras.slice(0, visibleCount);
  const vehicleDetectorLimit = visibleLayers.cameras ? Math.min(40, visibleCount) : visibleCount;
  const visibleVehicleDetectors = filteredVehicleDetectors.slice(0, vehicleDetectorLimit);
  const shownItemCount = visibleCameras.length + visibleVehicleDetectors.length;
  const totalFilteredCount = filteredCameras.length + filteredVehicleDetectors.length;
  const canLoadMore = filteredCameras.length > visibleCameras.length || filteredVehicleDetectors.length > visibleVehicleDetectors.length;
  const sourceHealth = summary?.sourceHealth.status ?? "unavailable";
  const sourceIssueText = sourceHealthText(sourceHealth, summary?.sourceHealth.errorCount ?? 0);

  return (
    <main className="app-shell">
      <CameraMap
        cameras={filteredCameras}
        vehicleDetectors={filteredVehicleDetectors}
        selectedCamera={selectedCamera}
        selectedVehicleDetector={selectedVehicleDetector}
        userLocation={userLocation}
        onSelectCamera={selectCamera}
        onSelectVehicleDetector={selectVehicleDetector}
      />

      <aside className="control-panel" aria-label="即時影像控制面板">
        <div className="brand-row">
          <div>
            <p className="eyebrow">Taiwan Live Cam</p>
            <h1>台灣即時影像</h1>
          </div>
          <button className="icon-button" type="button" onClick={loadCameras} title="重新整理">
            <RefreshCw size={18} />
          </button>
        </div>

        <label className="search-box">
          <Search size={18} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜尋縣市、行政區、道路、攝影機"
            type="search"
          />
          {query && (
            <button className="clear-button" type="button" onClick={() => setQuery("")} title="清除搜尋">
              <X size={16} />
            </button>
          )}
        </label>

        <SummaryStrip
          cameras={summary?.cameras.total ?? 0}
          sourceHealth={sourceHealth}
          updatedAt={catalog?.updatedAt}
          vehicleDetectors={summary?.vehicleDetectors.total ?? 0}
        />

        <div className="quick-actions">
          <button className="action-button" type="button" onClick={requestLocation}>
            <LocateFixed size={17} />
            {loadingLocation ? "定位中" : "附近影像"}
          </button>
          <button
            className="action-button"
            type="button"
            onClick={() => {
              setVisibleLayers((current) => ({ ...current, cameras: true }));
              setCameraFilter("favorites");
            }}
          >
            <Star size={17} />
            收藏 {favoriteCount}
          </button>
        </div>

        <div className="category-row" aria-label="CCTV 分類">
          {cameraFilterOptions.map((option) => (
            <button
              className={option.id === cameraFilter ? "chip active" : "chip"}
              key={option.id}
              onClick={() => setCameraFilter(option.id)}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>

        <section className="layer-panel" aria-label="圖層與來源">
          <div className="panel-title">
            <Layers size={17} />
            <h3>圖層與來源</h3>
          </div>
          <div className="layer-grid">
            <LayerToggle
              checked={visibleLayers.cameras}
              count={summary?.cameras.total ?? 0}
              label="閉路電視攝影機"
              onToggle={() => toggleLayer("cameras")}
            />
            <LayerToggle
              checked={visibleLayers.vehicleDetectors}
              count={summary?.vehicleDetectors.total ?? 0}
              label="車輛偵測器"
              onToggle={() => toggleLayer("vehicleDetectors")}
            />
          </div>
          <div className="category-stats" aria-label="CCTV 統計">
            <span>國道 {formatNumber(summary?.cameras.byCategory.freeway ?? 0)}</span>
            <span>公路 {formatNumber(summary?.cameras.byCategory.highway ?? 0)}</span>
            <span>市區 {formatNumber(summary?.cameras.byCategory.city ?? 0)}</span>
          </div>
          {catalog?.sourceErrors.length ? (
            <div className={`source-health ${sourceHealth}`}>
              <AlertCircle size={16} />
              <span>{sourceIssueText}</span>
            </div>
          ) : null}
        </section>

        {error && (
          <div className="status-message error">
            <AlertCircle size={17} />
            <span>{error}</span>
          </div>
        )}

        {catalog?.cache.stale && (
          <div className="status-message warning">
            <AlertCircle size={17} />
            <span>官方 API 暫時無法更新，目前顯示最後成功資料。</span>
          </div>
        )}

        <div className="meta-row">
          <span>{loading ? "載入真實資料中" : `${shownItemCount.toLocaleString()} / ${totalFilteredCount.toLocaleString()} 個點位`}</span>
          {catalog?.updatedAt && <span>{formatRelativeTime(catalog.updatedAt)}</span>}
        </div>

        <div className="camera-list" aria-label="點位清單">
          {visibleLayers.cameras && visibleCameras.map((camera) => (
            <button
              className={camera.id === selectedCamera?.id ? "camera-item active" : "camera-item"}
              key={camera.id}
              onClick={() => selectCamera(camera)}
              type="button"
            >
              <span className={`camera-dot ${camera.category}`} />
              <span className="camera-copy">
                <strong>{camera.title}</strong>
                <small>
                  {formatCountyTown(camera)} · {categoryLabel(camera.category)} · {camera.streamType.toUpperCase()}
                </small>
              </span>
              {favorites.has(camera.id) && <Heart className="favorite-mark" size={16} fill="currentColor" />}
            </button>
          ))}

          {visibleLayers.vehicleDetectors && visibleVehicleDetectors.length > 0 && (
            <section className="vd-list-section" aria-label="交通點位">
              <div className="section-label">
                <Activity size={15} />
                <span>交通點位</span>
                <strong>{filteredVehicleDetectors.length.toLocaleString()}</strong>
              </div>
              {visibleVehicleDetectors.map((vehicleDetector) => (
                <button
                  className={vehicleDetector.id === selectedVehicleDetector?.id ? "camera-item traffic active" : "camera-item traffic"}
                  key={vehicleDetector.id}
                  onClick={() => selectVehicleDetector(vehicleDetector)}
                  type="button"
                >
                  <span className="camera-dot traffic" />
                  <span className="camera-copy">
                    <strong>{vehicleDetector.title}</strong>
                    <small>{vehicleDetector.roadName || "未標示道路"} · VD</small>
                  </span>
                </button>
              ))}
            </section>
          )}

          {!loading && !shownItemCount && (
            <div className="empty-state">
              <Video size={22} />
              <span>{visibleLayers.cameras || visibleLayers.vehicleDetectors ? "沒有符合條件的點位。" : "請先開啟至少一個圖層。"}</span>
            </div>
          )}

          {canLoadMore && (
            <div className="load-more-row">
              <button className="action-button" type="button" onClick={() => setVisibleCount((count) => count + 80)}>
                顯示更多點位
              </button>
            </div>
          )}
        </div>
      </aside>

      {(selectedCamera || selectedVehicleDetector) && (
        <DetailPanel
          camera={selectedCamera}
          vehicleDetector={selectedVehicleDetector}
          environment={selectedCamera ? environment : undefined}
          environmentError={selectedCamera ? environmentError : ""}
          isFavorite={selectedCamera ? selectedIsFavorite : false}
          onClose={() => {
            setSelectedCamera(undefined);
            setSelectedVehicleDetector(undefined);
          }}
          onToggleFavorite={() => selectedCamera && toggleFavorite(selectedCamera.id)}
        />
      )}

      <MapLegend />

      <a className="source-link" href="https://tdx.transportdata.tw/" rel="noreferrer" target="_blank">
        <ExternalLink size={14} />
        公開資料來源
      </a>
    </main>
  );
}

function SummaryStrip({
  cameras,
  sourceHealth,
  updatedAt,
  vehicleDetectors
}: {
  cameras: number;
  sourceHealth: "ok" | "partial" | "unavailable";
  updatedAt?: string;
  vehicleDetectors: number;
}) {
  return (
    <div className="summary-strip" aria-label="即時摘要">
      <div>
        <span>CCTV</span>
        <strong>{formatNumber(cameras)}</strong>
      </div>
      <div>
        <span>VD</span>
        <strong>{formatNumber(vehicleDetectors)}</strong>
      </div>
      <div>
        <span>來源</span>
        <strong>{sourceHealthLabel(sourceHealth)}</strong>
      </div>
      <div>
        <span>更新</span>
        <strong>{updatedAt ? formatRelativeTime(updatedAt) : "尚未載入"}</strong>
      </div>
    </div>
  );
}

function LayerToggle({
  checked,
  count,
  label,
  onToggle
}: {
  checked: boolean;
  count: number;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button aria-pressed={checked} className={checked ? "layer-toggle active" : "layer-toggle"} onClick={onToggle} type="button">
      <span className="toggle-indicator" aria-hidden="true" />
      <span>
        <strong>{label}</strong>
        <small>{formatNumber(count)} 點</small>
      </span>
    </button>
  );
}

function MapLegend() {
  return (
    <div className="map-legend" aria-label="地圖圖例">
      <span>
        <i className="legend-dot freeway" />
        國道
      </span>
      <span>
        <i className="legend-dot highway" />
        公路
      </span>
      <span>
        <i className="legend-dot city" />
        市區
      </span>
      <span>
        <i className="legend-dot traffic" />
        VD
      </span>
    </div>
  );
}

function loadFavorites(): Set<string> {
  try {
    const raw = localStorage.getItem(favoriteStorageKey);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

function normalize(value: string) {
  return value.toLowerCase().replaceAll("台", "臺").trim();
}

function formatCountyTown(camera: Camera) {
  return [camera.county, camera.town].filter(Boolean).join(" ") || "未標示縣市";
}

function distanceKm(location: UserLocation, item: { lat: number; lon: number }) {
  const earthRadiusKm = 6371;
  const dLat = toRad(item.lat - location.lat);
  const dLon = toRad(item.lon - location.lon);
  const lat1 = toRad(location.lat);
  const lat2 = toRad(item.lat);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(value: number) {
  return (value * Math.PI) / 180;
}

function categoryLabel(category: Camera["category"]) {
  return {
    freeway: "國道",
    highway: "省道/公路",
    city: "市區"
  }[category];
}

function formatRelativeTime(value: string) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "";
  const minutes = Math.max(0, Math.round((Date.now() - time) / 60000));
  if (minutes < 1) return "剛剛更新";
  if (minutes < 60) return `${minutes} 分鐘前`;
  return `${Math.round(minutes / 60)} 小時前`;
}

function formatNumber(value: number) {
  return value.toLocaleString("zh-TW");
}

function sourceHealthLabel(status: "ok" | "partial" | "unavailable") {
  return {
    ok: "正常",
    partial: "部分",
    unavailable: "等待"
  }[status];
}

function sourceHealthText(status: "ok" | "partial" | "unavailable", errorCount: number) {
  if (status === "partial") {
    return `部分來源暫時無法取得，已保留成功載入資料（${errorCount} 個來源警示）。`;
  }

  if (status === "unavailable") {
    return "等待 TDX 憑證或官方來源恢復，部署本身仍可正常開啟。";
  }

  return "來源正常。";
}

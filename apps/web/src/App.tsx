import {
  AlertCircle,
  ExternalLink,
  Heart,
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
import type { Camera, CameraCatalogResponse, CategoryFilter, EnvironmentSummary, UserLocation } from "./types";

const categoryOptions: Array<{ id: CategoryFilter; label: string }> = [
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
  const [environment, setEnvironment] = useState<EnvironmentSummary | undefined>();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [favorites, setFavorites] = useState<Set<string>>(() => loadFavorites());
  const [userLocation, setUserLocation] = useState<UserLocation | undefined>();
  const [visibleCount, setVisibleCount] = useState(80);
  const [loading, setLoading] = useState(true);
  const [loadingLocation, setLoadingLocation] = useState(false);
  const [error, setError] = useState("");
  const [environmentError, setEnvironmentError] = useState("");

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
  }, [category, query]);

  async function loadCameras() {
    setLoading(true);
    setError("");
    try {
      const nextCatalog = await getCameras();
      setCatalog(nextCatalog);
      setSelectedCamera((current) => current ?? nextCatalog.cameras[0]);
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
        setCategory("nearby");
        setLoadingLocation(false);
      },
      () => {
        setError("無法取得定位；你仍然可以用搜尋或地圖瀏覽。");
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

  const filteredCameras = useMemo(() => {
    const allCameras = catalog?.cameras ?? [];
    const normalizedQuery = normalize(query);

    const filtered = allCameras.filter((camera) => {
      const matchesCategory =
        category === "all" ||
        category === "nearby" ||
        (category === "favorites" && favorites.has(camera.id)) ||
        camera.category === category;

      if (!matchesCategory) return false;
      if (!normalizedQuery) return true;

      return normalize([camera.title, camera.county, camera.town, camera.roadName, camera.source].join(" ")).includes(
        normalizedQuery
      );
    });

    if (category === "nearby" && userLocation) {
      return [...filtered]
        .sort((a, b) => distanceKm(userLocation, a) - distanceKm(userLocation, b))
        .slice(0, 160);
    }

    return filtered;
  }, [catalog?.cameras, category, favorites, query, userLocation]);

  useEffect(() => {
    if (!filteredCameras.length) {
      return;
    }

    if (!selectedCamera || !filteredCameras.some((camera) => camera.id === selectedCamera.id)) {
      setSelectedCamera(filteredCameras[0]);
    }
  }, [filteredCameras, selectedCamera]);

  const favoriteCount = favorites.size;
  const selectedIsFavorite = selectedCamera ? favorites.has(selectedCamera.id) : false;
  const visibleCameras = filteredCameras.slice(0, visibleCount);

  return (
    <main className="app-shell">
      <CameraMap cameras={filteredCameras} selectedCamera={selectedCamera} onSelectCamera={setSelectedCamera} />

      <aside className="control-panel" aria-label="攝影機搜尋與列表">
        <div className="brand-row">
          <div>
            <p className="eyebrow">Taiwan Live Cam</p>
            <h1>台灣即時影像</h1>
          </div>
          <button className="icon-button" type="button" onClick={loadCameras} title="重新整理攝影機">
            <RefreshCw size={18} />
          </button>
        </div>

        <label className="search-box">
          <Search size={18} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜尋縣市、道路、地名"
            type="search"
          />
          {query && (
            <button className="clear-button" type="button" onClick={() => setQuery("")} title="清除搜尋">
              <X size={16} />
            </button>
          )}
        </label>

        <div className="quick-actions">
          <button className="action-button" type="button" onClick={requestLocation}>
            <LocateFixed size={17} />
            {loadingLocation ? "定位中" : "附近影像"}
          </button>
          <button className="action-button" type="button" onClick={() => setCategory("favorites")}>
            <Star size={17} />
            收藏 {favoriteCount}
          </button>
        </div>

        <div className="category-row" aria-label="分類">
          {categoryOptions.map((option) => (
            <button
              className={option.id === category ? "chip active" : "chip"}
              key={option.id}
              onClick={() => setCategory(option.id)}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>

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
          <span>
            {loading
              ? "載入真實資料中"
              : `${Math.min(filteredCameras.length, visibleCount).toLocaleString()} / ${filteredCameras.length.toLocaleString()} 支攝影機`}
          </span>
          {catalog?.updatedAt && <span>{formatRelativeTime(catalog.updatedAt)}</span>}
        </div>

        <div className="camera-list" aria-label="攝影機清單">
          {visibleCameras.map((camera) => (
            <button
              className={camera.id === selectedCamera?.id ? "camera-item active" : "camera-item"}
              key={camera.id}
              onClick={() => setSelectedCamera(camera)}
              type="button"
            >
              <span className={`camera-dot ${camera.category}`} />
              <span className="camera-copy">
                <strong>{camera.title}</strong>
                <small>
                  {camera.county || "未標示縣市"} · {categoryLabel(camera.category)} · {camera.streamType.toUpperCase()}
                </small>
              </span>
              {favorites.has(camera.id) && <Heart className="favorite-mark" size={16} fill="currentColor" />}
            </button>
          ))}

          {!loading && !filteredCameras.length && (
            <div className="empty-state">
              <Video size={22} />
              <span>沒有符合條件的影像。</span>
            </div>
          )}

          {filteredCameras.length > visibleCount && (
            <div className="load-more-row">
              <button className="action-button" type="button" onClick={() => setVisibleCount((count) => count + 80)}>
                顯示更多攝影機 ({filteredCameras.length - visibleCount} 則更多)
              </button>
            </div>
          )}
        </div>
      </aside>

      {selectedCamera && (
        <DetailPanel
          camera={selectedCamera}
          environment={environment}
          environmentError={environmentError}
          isFavorite={selectedIsFavorite}
          onClose={() => setSelectedCamera(undefined)}
          onToggleFavorite={() => toggleFavorite(selectedCamera.id)}
        />
      )}

      <a className="source-link" href="https://tdx.transportdata.tw/" rel="noreferrer" target="_blank">
        <ExternalLink size={14} />
        公開資料來源
      </a>
    </main>
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

function distanceKm(location: UserLocation, camera: Camera) {
  const earthRadiusKm = 6371;
  const dLat = toRad(camera.lat - location.lat);
  const dLon = toRad(camera.lon - location.lon);
  const lat1 = toRad(location.lat);
  const lat2 = toRad(camera.lat);
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

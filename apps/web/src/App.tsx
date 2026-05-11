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
import { useEffect, useMemo, useRef, useState } from "react";
import { getCameras, getEnvironment } from "./api";
import { CameraMap } from "./components/CameraMap";
import { DetailPanel } from "./components/DetailPanel";
import { GOOGLE_MAPS_API_KEY, loadGooglePlaces } from "./googleMaps";
import type {
  Camera,
  CameraCatalogResponse,
  CameraFilter,
  EnvironmentSummary,
  SearchPlace,
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
  { id: "scenic", label: "風景區" },
  { id: "favorites", label: "收藏" }
];

const favoriteStorageKey = "taiwan-live-cam:favorites";
type ForegroundListMode = Extract<CameraFilter, "scenic" | "favorites">;
let startupLocationRequested = false;

export default function App() {
  const [catalog, setCatalog] = useState<CameraCatalogResponse | undefined>();
  const [selectedCamera, setSelectedCamera] = useState<Camera | undefined>();
  const [selectedVehicleDetector, setSelectedVehicleDetector] = useState<VehicleDetector | undefined>();
  const [searchPlace, setSearchPlace] = useState<SearchPlace | undefined>();
  const [placePredictions, setPlacePredictions] = useState<google.maps.places.AutocompletePrediction[]>([]);
  const [placesError, setPlacesError] = useState("");
  const [environment, setEnvironment] = useState<EnvironmentSummary | undefined>();
  const [query, setQuery] = useState("");
  const [cameraFilter, setCameraFilter] = useState<CameraFilter>("all");
  const [foregroundListMode, setForegroundListMode] = useState<ForegroundListMode | undefined>();
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
  const locationRequestInFlight = useRef(false);
  const filterBeforePlaceSearch = useRef<CameraFilter>("all");

  const summary = catalog?.summary;

  useEffect(() => {
    loadCameras();
  }, []);

  useEffect(() => {
    if (startupLocationRequested) {
      return;
    }

    startupLocationRequested = true;
    requestLocation({ silent: true });
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

  useEffect(() => {
    const keyword = query.trim();
    setPlacesError("");

    if (!GOOGLE_MAPS_API_KEY || keyword.length < 2) {
      setPlacePredictions([]);
      return;
    }

    let active = true;
    const timeout = window.setTimeout(() => {
      loadGooglePlaces()
        .then(() => getPlacePredictions(keyword))
        .then((predictions) => {
          if (active) setPlacePredictions(predictions.slice(0, 5));
        })
        .catch((err: unknown) => {
          if (active) {
            setPlacePredictions([]);
            setPlacesError(err instanceof Error ? err.message : String(err));
          }
        });
    }, 260);

    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [query]);

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

  function requestLocation(options: { silent?: boolean } = {}) {
    if (locationRequestInFlight.current) {
      return;
    }

    setForegroundListMode(undefined);

    if (!navigator.geolocation) {
      if (!options.silent) setError("此瀏覽器不支援定位。");
      return;
    }

    locationRequestInFlight.current = true;
    setLoadingLocation(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserLocation({
          lat: position.coords.latitude,
          lon: position.coords.longitude
        });
        setCameraFilter("nearby");
        setLoadingLocation(false);
        locationRequestInFlight.current = false;
      },
      () => {
        if (!options.silent) setError("無法取得定位，請確認瀏覽器權限後再試。");
        setLoadingLocation(false);
        locationRequestInFlight.current = false;
      },
      {
        enableHighAccuracy: true,
        maximumAge: 60 * 1000,
        timeout: 10000
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
        setForegroundListMode(undefined);
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

  function selectCameraFilter(filter: CameraFilter) {
    setCameraFilter(filter);

    if (filter === "scenic" || filter === "favorites") {
      setVisibleLayers((current) => ({ ...current, cameras: true }));
      setSelectedCamera(undefined);
      setSelectedVehicleDetector(undefined);
      setSearchPlace(undefined);
      setPlacePredictions([]);
      setPlacesError("");
      setQuery("");
      setForegroundListMode(filter);
      return;
    }

    setForegroundListMode(undefined);
  }

  const filteredCameras = useMemo(() => {
    if (!visibleLayers.cameras) {
      return [];
    }

    const allCameras = catalog?.cameras ?? [];
    const normalizedQuery = normalize(query);
    const activeLocation = searchPlace || userLocation;
    const shouldFilterText = Boolean(normalizedQuery && !searchPlace);

    const filtered = allCameras.filter((camera) => {
      const matchesFilter =
        cameraFilter === "all" ||
        cameraFilter === "nearby" ||
        (cameraFilter === "favorites" && favorites.has(camera.id)) ||
        camera.category === cameraFilter;

      if (!matchesFilter) return false;
      if (!shouldFilterText) return true;

      return normalize([camera.title, camera.county, camera.town, camera.roadName, camera.source].join(" ")).includes(
        normalizedQuery
      );
    });

    if (cameraFilter === "nearby" && activeLocation) {
      return [...filtered]
        .sort((a, b) => distanceKm(activeLocation, a) - distanceKm(activeLocation, b))
        .slice(0, 160);
    }

    return filtered;
  }, [catalog?.cameras, cameraFilter, favorites, query, searchPlace, userLocation, visibleLayers.cameras]);

  const filteredVehicleDetectors = useMemo(() => {
    if (!visibleLayers.vehicleDetectors) {
      return [];
    }

    const normalizedQuery = normalize(query);
    const allVehicleDetectors = catalog?.vehicleDetectors ?? [];
    const activeLocation = searchPlace || userLocation;
    const shouldFilterText = Boolean(normalizedQuery && !searchPlace);
    const filtered = allVehicleDetectors.filter((vd) => {
      if (!shouldFilterText) return true;

      return normalize([vd.title, vd.roadName, vd.roadSection.start, vd.roadSection.end, vd.source].join(" ")).includes(
        normalizedQuery
      );
    });

    if (cameraFilter === "nearby" && activeLocation) {
      return [...filtered]
        .sort((a, b) => distanceKm(activeLocation, a) - distanceKm(activeLocation, b))
        .slice(0, 160);
    }

    return filtered;
  }, [cameraFilter, catalog?.vehicleDetectors, query, searchPlace, userLocation, visibleLayers.vehicleDetectors]);

  const localSearchMatches = useMemo(() => {
    const normalizedQuery = normalize(query);
    if (!normalizedQuery || searchPlace) {
      return [];
    }

    const cameraMatches = (catalog?.cameras ?? [])
      .filter((camera) =>
        normalize([camera.title, camera.county, camera.town, camera.roadName, camera.source].join(" ")).includes(
          normalizedQuery
        )
      )
      .slice(0, 8)
      .map((camera) => ({ id: camera.id, kind: "camera" as const, title: camera.title, subtitle: formatCountyTown(camera), item: camera }));
    const vdMatches = (catalog?.vehicleDetectors ?? [])
      .filter((vd) => normalize([vd.title, vd.roadName, vd.roadSection.start, vd.roadSection.end, vd.source].join(" ")).includes(normalizedQuery))
      .slice(0, Math.max(0, 8 - cameraMatches.length))
      .map((vd) => ({ id: vd.id, kind: "vd" as const, title: vd.title, subtitle: vd.roadName || "VD", item: vd }));

    return [...cameraMatches, ...vdMatches].slice(0, 8);
  }, [catalog?.cameras, catalog?.vehicleDetectors, query, searchPlace]);

  const showSearchResults = Boolean(query.trim()) && (localSearchMatches.length > 0 || placePredictions.length > 0 || placesError);

  function clearSearch() {
    setQuery("");
    setSearchPlace(undefined);
    setPlacePredictions([]);
    setPlacesError("");
    setCameraFilter(filterBeforePlaceSearch.current);
    setForegroundListMode(undefined);
  }

  function activatePlaceSearch(place: SearchPlace) {
    if (!searchPlace) {
      filterBeforePlaceSearch.current = cameraFilter;
    }

    setSearchPlace(place);
    setSelectedCamera(undefined);
    setSelectedVehicleDetector(undefined);
    setQuery(place.title);
    setPlacePredictions([]);
    setForegroundListMode(undefined);
    setVisibleLayers((current) => ({ ...current, cameras: true, vehicleDetectors: true }));
    setCameraFilter("nearby");
  }

  async function selectPlacePrediction(prediction: google.maps.places.AutocompletePrediction) {
    try {
      const place = await getPlaceDetails(prediction.place_id);
      activatePlaceSearch(place);
    } catch (err) {
      setPlacesError(err instanceof Error ? err.message : String(err));
    }
  }

  async function submitSearch() {
    const firstLocal = localSearchMatches[0];
    if (firstLocal?.kind === "camera") {
      selectCamera(firstLocal.item);
      return;
    }
    if (firstLocal?.kind === "vd") {
      selectVehicleDetector(firstLocal.item);
      return;
    }

    const firstPrediction = placePredictions[0];
    if (firstPrediction) {
      await selectPlacePrediction(firstPrediction);
      return;
    }

    const keyword = query.trim();
    if (!keyword) return;

    try {
      const prediction = (await getPlacePredictions(keyword))[0];
      if (prediction) {
        await selectPlacePrediction(prediction);
      }
    } catch (err) {
      setPlacesError(err instanceof Error ? err.message : String(err));
    }
  }

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
  const isForegroundList = Boolean(foregroundListMode);
  const visibleCameras = filteredCameras.slice(0, visibleCount);
  const vehicleDetectorLimit = visibleLayers.cameras ? Math.min(40, visibleCount) : visibleCount;
  const visibleVehicleDetectors = filteredVehicleDetectors.slice(0, vehicleDetectorLimit);
  const shownItemCount = visibleCameras.length + (isForegroundList ? 0 : visibleVehicleDetectors.length);
  const totalFilteredCount = filteredCameras.length + (isForegroundList ? 0 : filteredVehicleDetectors.length);
  const canLoadMore =
    filteredCameras.length > visibleCameras.length ||
    (!isForegroundList && filteredVehicleDetectors.length > visibleVehicleDetectors.length);
  const foregroundListLabel = foregroundListMode ? cameraFilterLabel(foregroundListMode) : "";
  const sourceHealth = summary?.sourceHealth.status ?? "unavailable";
  const sourceIssueText = sourceHealthText(sourceHealth, summary?.sourceHealth.errorCount ?? 0);

  return (
    <main className="app-shell">
      <CameraMap
        cameras={filteredCameras}
        vehicleDetectors={isForegroundList ? [] : filteredVehicleDetectors}
        selectedCamera={selectedCamera}
        selectedVehicleDetector={selectedVehicleDetector}
        searchPlace={searchPlace}
        userLocation={userLocation}
        focusCameras={foregroundListMode ? filteredCameras : undefined}
        onSelectCamera={selectCamera}
        onSelectVehicleDetector={selectVehicleDetector}
      />

      <aside className={isForegroundList ? "control-panel foreground-list-mode" : "control-panel"} aria-label="即時影像控制面板">
        <div className="brand-row">
          <div>
            <p className="eyebrow">Taiwan Live Cam</p>
            <h1>台灣即時影像</h1>
          </div>
          <button className="icon-button" type="button" onClick={loadCameras} title="重新整理">
            <RefreshCw size={18} />
          </button>
        </div>

        <div className="search-block">
          <label className="search-box">
            <Search size={18} />
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                if (searchPlace) setSearchPlace(undefined);
                if (foregroundListMode) setForegroundListMode(undefined);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void submitSearch();
                }
              }}
              placeholder="搜尋地點、商家、縣市、道路、攝影機"
              type="search"
            />
            {query && (
              <button className="clear-button" type="button" onClick={clearSearch} title="清除搜尋">
                <X size={16} />
              </button>
            )}
          </label>
          {showSearchResults && (
            <div className="search-results" aria-label="搜尋結果">
              {localSearchMatches.map((match) => (
                <button
                  className="search-result-item"
                  key={`${match.kind}:${match.id}`}
                  onClick={() => (match.kind === "camera" ? selectCamera(match.item) : selectVehicleDetector(match.item))}
                  type="button"
                >
                  <strong>{match.title}</strong>
                  <small>{match.subtitle} · {match.kind === "camera" ? "即時影像" : "交通點位"}</small>
                </button>
              ))}
              {placePredictions.map((prediction) => (
                <button
                  className="search-result-item place"
                  key={prediction.place_id}
                  onClick={() => void selectPlacePrediction(prediction)}
                  type="button"
                >
                  <strong>{prediction.structured_formatting.main_text}</strong>
                  <small>{prediction.structured_formatting.secondary_text || "Google 地點"}</small>
                </button>
              ))}
              {placesError && <div className="search-result-note">{placesError}</div>}
            </div>
          )}
        </div>

        <SummaryStrip
          cameras={summary?.cameras.total ?? 0}
          sourceHealth={sourceHealth}
          updatedAt={catalog?.updatedAt}
          vehicleDetectors={summary?.vehicleDetectors.total ?? 0}
        />

        <div className="quick-actions">
          <button className="action-button" type="button" onClick={() => requestLocation()}>
            <LocateFixed size={17} />
            {loadingLocation ? "定位中" : "附近影像"}
          </button>
          <button
            className="action-button"
            type="button"
            onClick={() => {
              setVisibleLayers((current) => ({ ...current, cameras: true }));
              selectCameraFilter("favorites");
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
              onClick={() => selectCameraFilter(option.id)}
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
            <span>風景 {formatNumber(summary?.cameras.byCategory.scenic ?? 0)}</span>
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
        {foregroundListMode && (
          <div className="foreground-list-heading">
            <div>
              <span>前景列表</span>
              <strong>{foregroundListLabel}</strong>
            </div>
            <small>{filteredCameras.length.toLocaleString()} 個影像</small>
          </div>
        )}
        {searchPlace && !shownItemCount && (
          <div className="status-message warning">
            <AlertCircle size={17} />
            <span>已移到「{searchPlace.title}」，附近暫無攝影機。</span>
          </div>
        )}

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

          {!isForegroundList && visibleLayers.vehicleDetectors && visibleVehicleDetectors.length > 0 && (
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
        <i className="legend-dot scenic" />
        風景區
      </span>
      <span>
        <i className="legend-dot traffic" />
        VD
      </span>
    </div>
  );
}

async function getPlacePredictions(input: string): Promise<google.maps.places.AutocompletePrediction[]> {
  if (!GOOGLE_MAPS_API_KEY) {
    return [];
  }

  await loadGooglePlaces();
  const service = new google.maps.places.AutocompleteService();

  return new Promise((resolve, reject) => {
    service.getPlacePredictions(
      {
        componentRestrictions: { country: "tw" },
        input,
        language: "zh-TW"
      },
      (predictions, status) => {
        if (status === google.maps.places.PlacesServiceStatus.OK && predictions) {
          resolve(predictions);
          return;
        }

        if (status === google.maps.places.PlacesServiceStatus.ZERO_RESULTS) {
          resolve([]);
          return;
        }

        reject(new Error(`Google Places search failed: ${status}`));
      }
    );
  });
}

async function getPlaceDetails(placeId: string): Promise<SearchPlace> {
  await loadGooglePlaces();
  const host = document.createElement("div");
  const service = new google.maps.places.PlacesService(host);

  return new Promise((resolve, reject) => {
    service.getDetails(
      {
        fields: ["formatted_address", "geometry", "name", "place_id"],
        language: "zh-TW",
        placeId
      },
      (place, status) => {
        const location = place?.geometry?.location;
        if (status === google.maps.places.PlacesServiceStatus.OK && place && location) {
          resolve({
            id: place.place_id || placeId,
            title: place.name || place.formatted_address || "Google 地點",
            address: place.formatted_address || "",
            lat: location.lat(),
            lon: location.lng()
          });
          return;
        }

        reject(new Error(`Google place details failed: ${status}`));
      }
    );
  });
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

function cameraFilterLabel(filter: CameraFilter) {
  if (filter === "favorites") return "收藏";
  if (filter === "nearby") return "附近";
  if (filter === "all") return "全部";
  return categoryLabel(filter);
}

function categoryLabel(category: Camera["category"]) {
  return {
    freeway: "國道",
    highway: "省道/公路",
    city: "市區",
    scenic: "風景區"
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

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
import { type CSSProperties, type KeyboardEvent, type PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { getCameras, getEnvironment, getNearbyTourism } from "./api";
import { CameraMap } from "./components/CameraMap";
import { DetailPanel } from "./components/DetailPanel";
import { NearbyTourismBlock } from "./components/NearbyTourismBlock";
import { GOOGLE_MAPS_API_KEY, loadGooglePlaces, searchGoogleNearbyRestaurants } from "./googleMaps";
import type {
  Camera,
  CameraCatalogResponse,
  CameraFilter,
  EnvironmentSummary,
  GoogleRestaurantItem,
  NearbyTourismResponse,
  SearchPlace,
  UserLocation,
  VehicleDetector,
  VisibleLayers
} from "./types";

const cameraFilterOptions: Array<{ id: CameraFilter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "freeway", label: "國道" },
  { id: "highway", label: "省道/公路" },
  { id: "city", label: "市區" },
  { id: "scenic", label: "風景區" }
];

const favoriteStorageKey = "taiwan-live-cam:favorites";
type FocusedListFilter = Extract<CameraFilter, "scenic" | "favorites">;
type ControlPanelSnap = "hidden" | "half" | "full";
let startupLocationRequested = false;

export default function App() {
  const [catalog, setCatalog] = useState<CameraCatalogResponse | undefined>();
  const [selectedCamera, setSelectedCamera] = useState<Camera | undefined>();
  const [selectedVehicleDetector, setSelectedVehicleDetector] = useState<VehicleDetector | undefined>();
  const [searchPlace, setSearchPlace] = useState<SearchPlace | undefined>();
  const [placePredictions, setPlacePredictions] = useState<google.maps.places.AutocompletePrediction[]>([]);
  const [placesError, setPlacesError] = useState("");
  const [environment, setEnvironment] = useState<EnvironmentSummary | undefined>();
  const [nearbyTourism, setNearbyTourism] = useState<NearbyTourismResponse | undefined>();
  const [query, setQuery] = useState("");
  const [cameraFilter, setCameraFilter] = useState<CameraFilter>("all");
  const [focusedListFilter, setFocusedListFilter] = useState<FocusedListFilter | undefined>();
  const [visibleLayers, setVisibleLayers] = useState<VisibleLayers>({
    cameras: true,
    vehicleDetectors: true
  });
  const [favorites, setFavorites] = useState<Set<string>>(() => loadFavorites());
  const [userLocation, setUserLocation] = useState<UserLocation | undefined>();
  const [userLocationFocusRequest, setUserLocationFocusRequest] = useState(0);
  const [visibleCount, setVisibleCount] = useState(80);
  const [loading, setLoading] = useState(true);
  const [loadingLocation, setLoadingLocation] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [environmentError, setEnvironmentError] = useState("");
  const [nearbyTourismError, setNearbyTourismError] = useState("");
  const [nearbyTourismLoading, setNearbyTourismLoading] = useState(false);
  const [googleRestaurants, setGoogleRestaurants] = useState<GoogleRestaurantItem[]>([]);
  const [googleRestaurantsLoading, setGoogleRestaurantsLoading] = useState(false);
  const [googleRestaurantsError, setGoogleRestaurantsError] = useState("");
  const [showSourceDetails, setShowSourceDetails] = useState(false);
  const [controlPanelSnap, setControlPanelSnap] = useState<ControlPanelSnap>("half");
  const [controlPanelDragOffset, setControlPanelDragOffset] = useState(0);
  const locationRequestInFlight = useRef(false);
  const filterBeforePlaceSearch = useRef<CameraFilter>("all");
  const controlPanelDrag = useRef<{ startY: number; moved: boolean } | undefined>(undefined);
  const suppressPanelHandleClick = useRef(false);

  const summary = catalog?.summary;
  const nearbyTourismTarget = useMemo(() => {
    if (selectedCamera) {
      return { lat: selectedCamera.lat, lon: selectedCamera.lon, title: selectedCamera.title, placement: "detail" as const };
    }
    if (selectedVehicleDetector) {
      return undefined;
    }
    if (searchPlace) {
      return { lat: searchPlace.lat, lon: searchPlace.lon, title: searchPlace.title, placement: "panel" as const };
    }
    if (cameraFilter === "nearby" && userLocation) {
      return { lat: userLocation.lat, lon: userLocation.lon, title: "目前位置", placement: "panel" as const };
    }
    return undefined;
  }, [cameraFilter, searchPlace, selectedCamera, selectedVehicleDetector, userLocation]);

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
    setNearbyTourism(undefined);
    setNearbyTourismError("");

    if (!nearbyTourismTarget) {
      setNearbyTourismLoading(false);
      return;
    }

    let active = true;
    setNearbyTourismLoading(true);
    getNearbyTourism(nearbyTourismTarget.lat, nearbyTourismTarget.lon)
      .then((value) => {
        if (active) setNearbyTourism(value);
      })
      .catch((err: unknown) => {
        if (active) setNearbyTourismError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (active) setNearbyTourismLoading(false);
      });

    return () => {
      active = false;
    };
  }, [nearbyTourismTarget]);

  useEffect(() => {
    setGoogleRestaurants([]);
    setGoogleRestaurantsError("");

    if (!nearbyTourismTarget || !GOOGLE_MAPS_API_KEY) {
      setGoogleRestaurantsLoading(false);
      return;
    }

    let active = true;
    setGoogleRestaurantsLoading(true);
    searchGoogleNearbyRestaurants({ lat: nearbyTourismTarget.lat, lon: nearbyTourismTarget.lon })
      .then((items) => {
        if (active) setGoogleRestaurants(items);
      })
      .catch(() => {
        if (active) setGoogleRestaurantsError("Google 餐廳推薦暫時無法取得，已顯示可用餐飲資料。");
      })
      .finally(() => {
        if (active) setGoogleRestaurantsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [nearbyTourismTarget]);

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
      const message = err instanceof Error ? err.message : String(err);
      setError(catalog ? `來源暫時不穩，已保留可用資料。${message}` : message);
    } finally {
      setLoading(false);
    }
  }

  function requestLocation(options: { silent?: boolean } = {}) {
    if (locationRequestInFlight.current) {
      return;
    }

    setFocusedListFilter(undefined);

    if (!navigator.geolocation) {
      if (!options.silent) setError("此瀏覽器不支援定位。");
      return;
    }

    if (!options.silent) {
      setError("");
    }

    locationRequestInFlight.current = true;
    setLoadingLocation(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (!options.silent) {
          setSelectedCamera(undefined);
          setSelectedVehicleDetector(undefined);
          setSearchPlace(undefined);
          setPlacePredictions([]);
          setPlacesError("");
          setQuery("");
        }
        setUserLocation({
          lat: position.coords.latitude,
          lon: position.coords.longitude
        });
        setCameraFilter("nearby");
        if (!options.silent) {
          setUserLocationFocusRequest((request) => request + 1);
        }
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
        setFocusedListFilter(undefined);
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
      setFocusedListFilter(filter);
      return;
    }

    setFocusedListFilter(undefined);
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

  const showSearchResults =
    Boolean(query.trim()) && (localSearchMatches.length > 0 || placePredictions.length > 0 || placesError || searching);

  function clearSearch() {
    setQuery("");
    setSearchPlace(undefined);
    setPlacePredictions([]);
    setPlacesError("");
    setCameraFilter(filterBeforePlaceSearch.current);
    setFocusedListFilter(undefined);
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
    setFocusedListFilter(undefined);
    setVisibleLayers((current) => ({ ...current, cameras: true, vehicleDetectors: true }));
    setCameraFilter("nearby");
  }

  async function selectPlacePrediction(prediction: google.maps.places.AutocompletePrediction) {
    setSearching(true);
    try {
      const place = await getPlaceDetails(prediction.place_id);
      activatePlaceSearch(place);
    } catch (err) {
      setPlacesError(err instanceof Error ? err.message : String(err));
    } finally {
      setSearching(false);
    }
  }

  async function submitSearch() {
    if (searching) return;
    setSearching(true);
    try {
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
        const place = await getPlaceDetails(firstPrediction.place_id);
        activatePlaceSearch(place);
        return;
      }

      const keyword = query.trim();
      if (!keyword) return;

      const prediction = (await getPlacePredictions(keyword))[0];
      if (prediction) {
        const place = await getPlaceDetails(prediction.place_id);
        activatePlaceSearch(place);
      }
    } catch (err) {
      setPlacesError(err instanceof Error ? err.message : String(err));
    } finally {
      setSearching(false);
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
  const isLocationMode = cameraFilter === "nearby" && Boolean(userLocation) && !searchPlace;
  const isFocusedList = Boolean(focusedListFilter);
  const listDistanceOrigin = searchPlace ?? (cameraFilter === "nearby" ? userLocation : undefined);
  const visibleCameras = filteredCameras.slice(0, visibleCount);
  const vehicleDetectorLimit = visibleLayers.cameras ? Math.min(40, visibleCount) : visibleCount;
  const visibleVehicleDetectors = filteredVehicleDetectors.slice(0, vehicleDetectorLimit);
  const shownItemCount = visibleCameras.length + (isFocusedList ? 0 : visibleVehicleDetectors.length);
  const totalFilteredCount = filteredCameras.length + (isFocusedList ? 0 : filteredVehicleDetectors.length);
  const canLoadMore =
    filteredCameras.length > visibleCameras.length ||
    (!isFocusedList && filteredVehicleDetectors.length > visibleVehicleDetectors.length);
  const emptyStateText = getEmptyStateText({
    cameraFilter,
    favoriteCount,
    hasVisibleLayer: visibleLayers.cameras || visibleLayers.vehicleDetectors
  });
  const sourceHealth = summary?.sourceHealth.status ?? "unavailable";
  const sourceIssueText = sourceHealthText(sourceHealth, summary?.sourceHealth.errorCount ?? 0);
  const controlPanelStyle =
    controlPanelDragOffset !== 0
      ? ({ "--panel-drag-offset": `${controlPanelDragOffset}px` } as CSSProperties)
      : undefined;

  function beginControlPanelDrag(event: PointerEvent<HTMLButtonElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    controlPanelDrag.current = { startY: event.clientY, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
    setControlPanelDragOffset(0);
  }

  function moveControlPanelDrag(event: PointerEvent<HTMLButtonElement>) {
    const drag = controlPanelDrag.current;
    if (!drag) {
      return;
    }

    const offset = clamp(event.clientY - drag.startY, -window.innerHeight * 0.55, window.innerHeight * 0.72);
    drag.moved = drag.moved || Math.abs(offset) > 6;
    setControlPanelDragOffset(offset);
  }

  function endControlPanelDrag(event: PointerEvent<HTMLButtonElement>) {
    const drag = controlPanelDrag.current;
    if (!drag) {
      return;
    }

    const offset = event.clientY - drag.startY;
    suppressPanelHandleClick.current = drag.moved;
    setControlPanelSnap(resolveControlPanelSnap(controlPanelSnap, offset));
    setControlPanelDragOffset(0);
    controlPanelDrag.current = undefined;

    window.setTimeout(() => {
      suppressPanelHandleClick.current = false;
    }, 0);
  }

  function cancelControlPanelDrag() {
    controlPanelDrag.current = undefined;
    setControlPanelDragOffset(0);
  }

  function toggleControlPanelSnap() {
    if (suppressPanelHandleClick.current) {
      return;
    }
    setControlPanelSnap(nextControlPanelSnap(controlPanelSnap));
  }

  function handleControlPanelKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setControlPanelSnap("full");
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setControlPanelSnap(controlPanelSnap === "full" ? "half" : "hidden");
    }
  }

  return (
    <main className="app-shell">
      <CameraMap
        cameras={filteredCameras}
        vehicleDetectors={isFocusedList ? [] : filteredVehicleDetectors}
        selectedCamera={selectedCamera}
        selectedVehicleDetector={selectedVehicleDetector}
        searchPlace={searchPlace}
        userLocation={userLocation}
        userLocationFocusRequest={userLocationFocusRequest}
        focusCameras={focusedListFilter ? filteredCameras : undefined}
        onSelectCamera={selectCamera}
        onSelectVehicleDetector={selectVehicleDetector}
      />

      <aside
        className={`control-panel snap-${controlPanelSnap}${controlPanelDragOffset ? " dragging" : ""}`}
        style={controlPanelStyle}
        aria-label="即時影像控制面板"
      >
        <button
          className="control-panel-handle"
          type="button"
          aria-expanded={controlPanelSnap !== "hidden"}
          aria-label="調整控制面板高度"
          onClick={toggleControlPanelSnap}
          onKeyDown={handleControlPanelKeyDown}
          onPointerCancel={cancelControlPanelDrag}
          onPointerDown={beginControlPanelDrag}
          onPointerMove={moveControlPanelDrag}
          onPointerUp={endControlPanelDrag}
        />
        <div className="brand-row">
          <div>
            <p className="eyebrow">Taiwan Live Cam</p>
            <h1>台灣即時影像</h1>
          </div>
          <button className="icon-button" type="button" onClick={loadCameras} title="重新整理" disabled={loading}>
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
                if (focusedListFilter) setFocusedListFilter(undefined);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void submitSearch();
                }
              }}
              disabled={searching}
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
                  disabled={searching}
                  type="button"
                >
                  <strong>{prediction.structured_formatting.main_text}</strong>
                  <small>{prediction.structured_formatting.secondary_text || "Google 地點"}</small>
                </button>
              ))}
              {placesError && <div className="search-result-note">{placesError}</div>}
              {searching && <div className="search-result-note">搜尋中...</div>}
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
          <button
            className={isLocationMode ? "action-button active" : "action-button"}
            type="button"
            onClick={() => requestLocation()}
            disabled={loadingLocation}
          >
            <LocateFixed size={17} />
            {loadingLocation ? "定位中" : "附近影像"}
          </button>
          <button
            className={cameraFilter === "favorites" ? "action-button active" : "action-button"}
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
              <div className="source-health-content">
                <div className="source-health-row">
                  <span>{sourceIssueText}</span>
                  <button
                    className="source-health-toggle"
                    type="button"
                    onClick={() => setShowSourceDetails((current) => !current)}
                  >
                    {showSourceDetails ? "收合來源" : "查看來源"}
                  </button>
                </div>
                {showSourceDetails && (
                  <ul className="source-error-list">
                    {catalog.sourceErrors.map((sourceError, index) => (
                      <li key={`${sourceError.source}-${sourceError.endpoint}-${index}`}>
                        <strong>{sourceError.source}</strong>
                        <span>{sourceError.endpoint}</span>
                        <small>{sourceError.message}</small>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
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
            <span>官方 API 暫時無法更新，目前使用最後成功資料。</span>
          </div>
        )}

        <div className="meta-row">
          <span>{loading ? "載入真實資料中" : `${shownItemCount.toLocaleString()} / ${totalFilteredCount.toLocaleString()} 個點位`}</span>
          {catalog?.updatedAt && <span>{formatRelativeTime(catalog.updatedAt)}</span>}
        </div>
        {searchPlace && !shownItemCount && (
          <div className="status-message warning">
            <AlertCircle size={17} />
            <span>已移到「{searchPlace.title}」，附近暫無攝影機。</span>
          </div>
        )}

        {nearbyTourismTarget?.placement === "panel" && (
          <NearbyTourismBlock
            compact
            tourism={nearbyTourism}
            loading={nearbyTourismLoading}
            error={nearbyTourismError}
            googleRestaurants={googleRestaurants}
            googleRestaurantsLoading={googleRestaurantsLoading}
            googleRestaurantsError={googleRestaurantsError}
            title={`${nearbyTourismTarget.title}附近玩樂`}
          />
        )}

        <div className="camera-list" aria-label="點位清單">
          {visibleLayers.cameras && visibleCameras.map((camera) => {
            const distanceText = formatListDistance(listDistanceOrigin, camera);

            return (
              <button
                className={camera.id === selectedCamera?.id ? "camera-item active" : "camera-item"}
                key={camera.id}
                onClick={() => selectCamera(camera)}
                type="button"
              >
                <span className={`camera-dot ${camera.category}`} />
                <span className="camera-copy">
                  <strong>{camera.title}</strong>
                  <span className="camera-meta">
                    <small>
                      {formatCountyTown(camera)} · {categoryLabel(camera.category)} · {camera.streamType.toUpperCase()}
                    </small>
                    {distanceText && <span className="camera-distance">{distanceText}</span>}
                  </span>
                </span>
                {favorites.has(camera.id) && <Heart className="favorite-mark" size={16} fill="currentColor" />}
              </button>
            );
          })}

          {!isFocusedList && visibleLayers.vehicleDetectors && visibleVehicleDetectors.length > 0 && (
            <section className="vd-list-section" aria-label="交通點位">
              <div className="section-label">
                <Activity size={15} />
                <span>交通點位</span>
                <strong>{filteredVehicleDetectors.length.toLocaleString()}</strong>
              </div>
              {visibleVehicleDetectors.map((vehicleDetector) => {
                const distanceText = formatListDistance(listDistanceOrigin, vehicleDetector);

                return (
                  <button
                    className={vehicleDetector.id === selectedVehicleDetector?.id ? "camera-item traffic active" : "camera-item traffic"}
                    key={vehicleDetector.id}
                    onClick={() => selectVehicleDetector(vehicleDetector)}
                    type="button"
                  >
                    <span className="camera-dot traffic" />
                    <span className="camera-copy">
                      <strong>{vehicleDetector.title}</strong>
                      <span className="camera-meta">
                        <small>{vehicleDetector.roadName || "未標示道路"} · VD</small>
                        {distanceText && <span className="camera-distance">{distanceText}</span>}
                      </span>
                    </span>
                  </button>
                );
              })}
            </section>
          )}

          {!loading && !shownItemCount && (
            <div className="empty-state">
              <Video size={22} />
              <span>{emptyStateText}</span>
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
          nearbyTourism={selectedCamera ? nearbyTourism : undefined}
          nearbyTourismError={selectedCamera ? nearbyTourismError : ""}
          nearbyTourismLoading={selectedCamera ? nearbyTourismLoading : false}
          googleRestaurants={selectedCamera ? googleRestaurants : []}
          googleRestaurantsError={selectedCamera ? googleRestaurantsError : ""}
          googleRestaurantsLoading={selectedCamera ? googleRestaurantsLoading : false}
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

function getEmptyStateText({
  cameraFilter,
  favoriteCount,
  hasVisibleLayer
}: {
  cameraFilter: CameraFilter;
  favoriteCount: number;
  hasVisibleLayer: boolean;
}) {
  if (!hasVisibleLayer) {
    return "請先開啟至少一個圖層。";
  }

  if (cameraFilter === "favorites") {
    return favoriteCount
      ? "收藏清單目前沒有可顯示的攝影機。"
      : "尚未收藏攝影機。開啟任一攝影機後可按愛心加入收藏。";
  }

  return "沒有符合條件的點位。";
}

function normalize(value: string) {
  return value.toLowerCase().replaceAll("台", "臺").trim();
}

function formatCountyTown(camera: Camera) {
  return [camera.county, camera.town].filter(Boolean).join(" ") || "未標示縣市";
}

function formatListDistance(origin: { lat: number; lon: number } | undefined, item: { lat: number; lon: number }) {
  if (!origin) {
    return "";
  }

  const km = distanceKm(origin, item);
  if (km < 1) {
    return `距離 ${Math.max(1, Math.round(km * 1000))} 公尺`;
  }
  if (km < 10) {
    return `距離 ${km.toFixed(1)} 公里`;
  }
  return `距離 ${Math.round(km)} 公里`;
}

function distanceKm(location: { lat: number; lon: number }, item: { lat: number; lon: number }) {
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

function resolveControlPanelSnap(current: ControlPanelSnap, offset: number): ControlPanelSnap {
  if (offset < -140) return "full";
  if (offset < -42) return current === "hidden" ? "half" : "full";
  if (offset > 140) return "hidden";
  if (offset > 42) return current === "full" ? "half" : "hidden";
  return current;
}

function nextControlPanelSnap(current: ControlPanelSnap): ControlPanelSnap {
  if (current === "hidden") return "half";
  if (current === "half") return "full";
  return "half";
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
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
    return `部分資料來源延遲，畫面仍可正常使用（${errorCount} 個來源警示）。`;
  }

  if (status === "unavailable") {
    return `目前主要資料來源無法取得（${errorCount} 個來源警示）。`;
  }

  return "來源正常。";
}

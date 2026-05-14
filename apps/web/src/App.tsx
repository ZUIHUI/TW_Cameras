import {
  Activity,
  AlertCircle,
  ArrowUp,
  CloudSun,
  CloudRain,
  Heart,
  Layers,
  LocateFixed,
  MapPin,
  RefreshCw,
  Search,
  Sun,
  Star,
  Video,
  X
} from "lucide-react";
import { type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode, type UIEvent, useEffect, useMemo, useRef, useState } from "react";
import { getCameras, getEnvironment, getEnvironmentByCoordinate, getNearbyTourism, getRadarOverlay, getRainfallNearby } from "./api";
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
  RadarOverlayResponse,
  RainfallResponse,
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
type MobileSheet = "search" | "layers" | "rain" | "nearby" | "favorites" | "detail";
type ObservationTarget = { lat: number; lon: number; title: string };
let startupLocationRequested = false;

export default function App() {
  const [catalog, setCatalog] = useState<CameraCatalogResponse | undefined>();
  const [selectedCamera, setSelectedCamera] = useState<Camera | undefined>();
  const [selectedVehicleDetector, setSelectedVehicleDetector] = useState<VehicleDetector | undefined>();
  const [searchPlace, setSearchPlace] = useState<SearchPlace | undefined>();
  const [placePredictions, setPlacePredictions] = useState<google.maps.places.AutocompletePrediction[]>([]);
  const [placesError, setPlacesError] = useState("");
  const [environment, setEnvironment] = useState<EnvironmentSummary | undefined>();
  const [mapEnvironment, setMapEnvironment] = useState<EnvironmentSummary | undefined>();
  const [nearbyTourism, setNearbyTourism] = useState<NearbyTourismResponse | undefined>();
  const [query, setQuery] = useState("");
  const [cameraFilter, setCameraFilter] = useState<CameraFilter>("all");
  const [focusedListFilter, setFocusedListFilter] = useState<FocusedListFilter | undefined>();
  const [visibleLayers, setVisibleLayers] = useState<VisibleLayers>({
    cameras: true,
    radar: false,
    vehicleDetectors: true
  });
  const [rainModeActive, setRainModeActive] = useState(false);
  const [radarOpacity, setRadarOpacity] = useState(0.68);
  const [favorites, setFavorites] = useState<Set<string>>(() => loadFavorites());
  const [userLocation, setUserLocation] = useState<UserLocation | undefined>();
  const [userLocationFocusRequest, setUserLocationFocusRequest] = useState(0);
  const [visibleCount, setVisibleCount] = useState(80);
  const [loading, setLoading] = useState(true);
  const [loadingLocation, setLoadingLocation] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [environmentError, setEnvironmentError] = useState("");
  const [mapEnvironmentError, setMapEnvironmentError] = useState("");
  const [mapEnvironmentLoading, setMapEnvironmentLoading] = useState(false);
  const [nearbyTourismError, setNearbyTourismError] = useState("");
  const [nearbyTourismLoading, setNearbyTourismLoading] = useState(false);
  const [radarOverlay, setRadarOverlay] = useState<RadarOverlayResponse | undefined>();
  const [radarOverlayError, setRadarOverlayError] = useState("");
  const [radarOverlayLoading, setRadarOverlayLoading] = useState(false);
  const [rainfall, setRainfall] = useState<RainfallResponse | undefined>();
  const [rainfallError, setRainfallError] = useState("");
  const [rainfallLoading, setRainfallLoading] = useState(false);
  const [rainEnvironment, setRainEnvironment] = useState<EnvironmentSummary | undefined>();
  const [rainEnvironmentError, setRainEnvironmentError] = useState("");
  const [googleRestaurants, setGoogleRestaurants] = useState<GoogleRestaurantItem[]>([]);
  const [googleRestaurantsLoading, setGoogleRestaurantsLoading] = useState(false);
  const [googleRestaurantsError, setGoogleRestaurantsError] = useState("");
  const [showSourceDetails, setShowSourceDetails] = useState(false);
  const [controlPanelSnap, setControlPanelSnap] = useState<ControlPanelSnap>("half");
  const [controlPanelDragOffset, setControlPanelDragOffset] = useState(0);
  const [activeMobileSheet, setActiveMobileSheet] = useState<MobileSheet | undefined>();
  const [mobileSheetSnap, setMobileSheetSnap] = useState<ControlPanelSnap>("half");
  const [mobileSheetDragOffset, setMobileSheetDragOffset] = useState(0);
  const [mapViewportTarget, setMapViewportTarget] = useState<ObservationTarget | undefined>();
  const [mapDataTarget, setMapDataTarget] = useState<ObservationTarget | undefined>();
  const [showPanelTopButton, setShowPanelTopButton] = useState(false);
  const [manualRefreshKey, setManualRefreshKey] = useState(0);
  const locationRequestInFlight = useRef(false);
  const filterBeforePlaceSearch = useRef<CameraFilter>("all");
  const radarBeforeRainMode = useRef(false);
  const controlPanelDrag = useRef<{ startY: number; moved: boolean } | undefined>(undefined);
  const mobileSheetDrag = useRef<{ startY: number; moved: boolean } | undefined>(undefined);
  const suppressPanelHandleClick = useRef(false);
  const suppressMobileSheetHandleClick = useRef(false);
  const controlPanelContentRef = useRef<HTMLDivElement>(null);

  const summary = catalog?.summary;
  const nearbyTourismTarget = useMemo<ObservationTarget | undefined>(() => {
    return mapDataTarget;
  }, [mapDataTarget]);

  const rainObservationTarget = useMemo<ObservationTarget | undefined>(() => {
    if (selectedCamera) {
      return { lat: selectedCamera.lat, lon: selectedCamera.lon, title: selectedCamera.title };
    }
    if (searchPlace) {
      return { lat: searchPlace.lat, lon: searchPlace.lon, title: searchPlace.title };
    }
    if (userLocation) {
      return { lat: userLocation.lat, lon: userLocation.lon, title: "目前位置" };
    }
    return undefined;
  }, [searchPlace, selectedCamera, userLocation]);
  const mapViewportTargetKey = mapViewportTarget ? coordinateBucket(mapViewportTarget) : "";

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
    if (!mapViewportTarget) {
      setMapDataTarget(undefined);
      return;
    }

    const nextTarget = roundedObservationTarget(mapViewportTarget);
    const timeout = window.setTimeout(() => {
      setMapDataTarget((current) => (coordinateBucket(current) === coordinateBucket(nextTarget) ? current : nextTarget));
    }, 450);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [mapViewportTargetKey]);

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
  }, [manualRefreshKey, selectedCamera?.county]);

  useEffect(() => {
    setMapEnvironment(undefined);
    setMapEnvironmentError("");

    if (!mapDataTarget) {
      setMapEnvironmentLoading(false);
      return;
    }

    let active = true;
    setMapEnvironmentLoading(true);
    getEnvironmentByCoordinate(mapDataTarget.lat, mapDataTarget.lon)
      .then((value) => {
        if (active) setMapEnvironment(value);
      })
      .catch((err: unknown) => {
        if (active) setMapEnvironmentError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (active) setMapEnvironmentLoading(false);
      });

    return () => {
      active = false;
    };
  }, [manualRefreshKey, mapDataTarget]);

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
  }, [manualRefreshKey, nearbyTourismTarget]);

  useEffect(() => {
    setRadarOverlayError("");

    if (!visibleLayers.radar) {
      setRadarOverlay(undefined);
      setRadarOverlayLoading(false);
      return;
    }

    let active = true;
    setRadarOverlayLoading(true);
    getRadarOverlay()
      .then((value) => {
        if (active) setRadarOverlay(value);
      })
      .catch((err: unknown) => {
        if (active) {
          setRadarOverlay(undefined);
          setRadarOverlayError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (active) setRadarOverlayLoading(false);
      });

    return () => {
      active = false;
    };
  }, [manualRefreshKey, visibleLayers.radar]);

  useEffect(() => {
    setRainfall(undefined);
    setRainfallError("");

    if (!rainModeActive || !rainObservationTarget) {
      setRainfallLoading(false);
      return;
    }

    let active = true;
    setRainfallLoading(true);
    getRainfallNearby(rainObservationTarget.lat, rainObservationTarget.lon)
      .then((value) => {
        if (active) setRainfall(value);
      })
      .catch((err: unknown) => {
        if (active) setRainfallError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (active) setRainfallLoading(false);
      });

    return () => {
      active = false;
    };
  }, [manualRefreshKey, rainModeActive, rainObservationTarget]);

  useEffect(() => {
    setRainEnvironment(undefined);
    setRainEnvironmentError("");

    if (!rainModeActive) {
      return;
    }

    const county = selectedCamera?.county || rainfall?.stations[0]?.county;
    if (!county) {
      return;
    }

    let active = true;
    getEnvironment(county)
      .then((value) => {
        if (active) setRainEnvironment(value);
      })
      .catch((err: unknown) => {
        if (active) setRainEnvironmentError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      active = false;
    };
  }, [manualRefreshKey, rainModeActive, rainfall?.stations[0]?.county, selectedCamera?.county]);

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
  }, [manualRefreshKey, nearbyTourismTarget]);

  useEffect(() => {
    setVisibleCount(80);
  }, [cameraFilter, query, rainModeActive, rainObservationTarget, visibleLayers.cameras, visibleLayers.vehicleDetectors]);

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

  async function refreshCurrentView() {
    await loadCameras();
    setManualRefreshKey((key) => key + 1);
  }

  function requestLocation(options: { afterSuccess?: () => void; silent?: boolean; preserveFilter?: boolean } = {}) {
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
        if (!options.preserveFilter) {
          setCameraFilter("nearby");
        }
        if (!options.silent) {
          setUserLocationFocusRequest((request) => request + 1);
        }
        options.afterSuccess?.();
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

  function toggleRainMode() {
    setRainModeActive((current) => {
      const next = !current;

      if (next) {
        radarBeforeRainMode.current = visibleLayers.radar;
        setVisibleLayers((layers) => ({
          ...layers,
          cameras: true,
          radar: true,
          vehicleDetectors: true
        }));
        setFocusedListFilter(undefined);

        if (!rainObservationTarget && !locationRequestInFlight.current) {
          requestLocation({ preserveFilter: true });
        }
      }

      if (!next) {
        setVisibleLayers((layers) => ({
          ...layers,
          radar: radarBeforeRainMode.current
        }));
      }

      return next;
    });
  }

  function selectCamera(camera: Camera) {
    setSelectedCamera(camera);
    setSelectedVehicleDetector(undefined);
    setActiveMobileSheet("detail");
  }

  function selectVehicleDetector(vehicleDetector: VehicleDetector) {
    setSelectedVehicleDetector(vehicleDetector);
    setSelectedCamera(undefined);
    setActiveMobileSheet("detail");
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
    const rainSortLocation = rainModeActive ? rainObservationTarget : undefined;
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

    const sortLocation = rainSortLocation || (cameraFilter === "nearby" ? activeLocation : undefined);
    if (sortLocation) {
      return [...filtered]
        .sort((a, b) => distanceKm(sortLocation, a) - distanceKm(sortLocation, b))
        .slice(0, 160);
    }

    return filtered;
  }, [catalog?.cameras, cameraFilter, favorites, query, rainModeActive, rainObservationTarget, searchPlace, userLocation, visibleLayers.cameras]);

  const filteredVehicleDetectors = useMemo(() => {
    if (!visibleLayers.vehicleDetectors) {
      return [];
    }

    const normalizedQuery = normalize(query);
    const allVehicleDetectors = catalog?.vehicleDetectors ?? [];
    const activeLocation = searchPlace || userLocation;
    const rainSortLocation = rainModeActive ? rainObservationTarget : undefined;
    const shouldFilterText = Boolean(normalizedQuery && !searchPlace);
    const filtered = allVehicleDetectors.filter((vd) => {
      if (!shouldFilterText) return true;

      return normalize([vd.title, vd.roadName, vd.roadSection.start, vd.roadSection.end, vd.source].join(" ")).includes(
        normalizedQuery
      );
    });

    const sortLocation = rainSortLocation || (cameraFilter === "nearby" ? activeLocation : undefined);
    if (sortLocation) {
      return [...filtered]
        .sort((a, b) => distanceKm(sortLocation, a) - distanceKm(sortLocation, b))
        .slice(0, 160);
    }

    return filtered;
  }, [cameraFilter, catalog?.vehicleDetectors, query, rainModeActive, rainObservationTarget, searchPlace, userLocation, visibleLayers.vehicleDetectors]);

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
    setActiveMobileSheet("search");
    setMobileSheetSnap("half");
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
  const listDistanceOrigin = rainModeActive ? rainObservationTarget : searchPlace ?? (cameraFilter === "nearby" ? userLocation : undefined);
  const rainWeather = selectedCamera ? environment : rainEnvironment;
  const rainWeatherError = selectedCamera ? environmentError : rainEnvironmentError;
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
  const mobileSheetStyle =
    mobileSheetDragOffset !== 0
      ? ({ "--mobile-sheet-drag-offset": `${mobileSheetDragOffset}px` } as CSSProperties)
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

  function handleControlPanelScroll(event: UIEvent<HTMLDivElement>) {
    const shouldShow = event.currentTarget.scrollTop > 220;
    setShowPanelTopButton((current) => (current === shouldShow ? current : shouldShow));
  }

  function scrollControlPanelToTop() {
    controlPanelContentRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openMobileSheet(sheet: Exclude<MobileSheet, "detail">) {
    setSelectedCamera(undefined);
    setSelectedVehicleDetector(undefined);
    setActiveMobileSheet(sheet);
    setMobileSheetSnap("half");
  }

  function closeMobileSheet() {
    setActiveMobileSheet(undefined);
    setMobileSheetDragOffset(0);
    setMobileSheetSnap("half");
  }

  function beginMobileSheetDrag(event: PointerEvent<HTMLButtonElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    mobileSheetDrag.current = { startY: event.clientY, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
    setMobileSheetDragOffset(0);
  }

  function moveMobileSheetDrag(event: PointerEvent<HTMLButtonElement>) {
    const drag = mobileSheetDrag.current;
    if (!drag) {
      return;
    }

    const offset = clamp(event.clientY - drag.startY, -window.innerHeight * 0.55, window.innerHeight * 0.72);
    drag.moved = drag.moved || Math.abs(offset) > 6;
    setMobileSheetDragOffset(offset);
  }

  function endMobileSheetDrag(event: PointerEvent<HTMLButtonElement>) {
    const drag = mobileSheetDrag.current;
    if (!drag) {
      return;
    }

    const offset = event.clientY - drag.startY;
    const nextSnap = resolveControlPanelSnap(mobileSheetSnap, offset);
    suppressMobileSheetHandleClick.current = drag.moved;
    mobileSheetDrag.current = undefined;
    setMobileSheetDragOffset(0);

    if (nextSnap === "hidden") {
      closeMobileSheet();
    } else {
      setMobileSheetSnap(nextSnap);
    }

    window.setTimeout(() => {
      suppressMobileSheetHandleClick.current = false;
    }, 0);
  }

  function cancelMobileSheetDrag() {
    mobileSheetDrag.current = undefined;
    setMobileSheetDragOffset(0);
  }

  function toggleMobileSheetSnap() {
    if (suppressMobileSheetHandleClick.current) {
      return;
    }
    setMobileSheetSnap((current) => (current === "full" ? "half" : "full"));
  }

  function handleMobileSheetKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setMobileSheetSnap("full");
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setMobileSheetSnap(mobileSheetSnap === "full" ? "half" : "hidden");
      if (mobileSheetSnap !== "full") {
        closeMobileSheet();
      }
    }
  }

  function openMobileLocationSearch() {
    requestLocation();
  }

  function openMobileFavorites() {
    setVisibleLayers((current) => ({ ...current, cameras: true }));
    selectCameraFilter("favorites");
    openMobileSheet("favorites");
  }

  function mobileSheetTitle(sheet: Exclude<MobileSheet, "detail">) {
    return {
      search: "搜尋與點位",
      layers: "圖層與來源",
      rain: "雨天路況",
      nearby: "地圖推薦",
      favorites: "收藏點位"
    }[sheet];
  }

  function mobileSheetIcon(sheet: Exclude<MobileSheet, "detail">) {
    return {
      search: <Search size={18} />,
      layers: <Layers size={18} />,
      rain: <CloudRain size={18} />,
      nearby: <MapPin size={18} />,
      favorites: <Star size={18} />
    }[sheet];
  }

  function renderMobileSearchBlock() {
    return (
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
            placeholder="搜尋地點、道路或攝影機"
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
    );
  }

  function renderMobileNearbySheet() {
    if (!nearbyTourismTarget) {
      return (
        <div className="mobile-sheet-stack">
          <div className="status-message warning">
            <AlertCircle size={17} />
            <span>請先移動或載入地圖，才能查看目前地圖位置的景點與餐飲推薦。</span>
          </div>
        </div>
      );
    }

    return (
      <div className="mobile-sheet-stack">
        <NearbyTourismBlock
          compact
          tourism={nearbyTourism}
          loading={nearbyTourismLoading}
          error={nearbyTourismError}
          googleRestaurants={googleRestaurants}
          googleRestaurantsLoading={googleRestaurantsLoading}
          googleRestaurantsError={googleRestaurantsError}
          title={formatMapRecommendationTitle(nearbyTourismTarget)}
        />
      </div>
    );
  }

  function renderMobilePointList(options: { includeVehicleDetectors?: boolean } = {}) {
    const includeVehicleDetectors = options.includeVehicleDetectors ?? true;
    const showVehicleDetectorList = includeVehicleDetectors && !isFocusedList && visibleLayers.vehicleDetectors && visibleVehicleDetectors.length > 0;
    const mobileShownItemCount = visibleCameras.length + (showVehicleDetectorList ? visibleVehicleDetectors.length : 0);
    const mobileTotalFilteredCount = filteredCameras.length + (includeVehicleDetectors && !isFocusedList ? filteredVehicleDetectors.length : 0);
    const mobileCanLoadMore =
      filteredCameras.length > visibleCameras.length ||
      (includeVehicleDetectors && !isFocusedList && filteredVehicleDetectors.length > visibleVehicleDetectors.length);

    return (
      <>
        <div className="meta-row">
          <span>{loading ? "載入點位中" : `${mobileShownItemCount.toLocaleString()} / ${mobileTotalFilteredCount.toLocaleString()} 個點位`}</span>
          {catalog?.updatedAt && <span>{formatRelativeTime(catalog.updatedAt)}</span>}
        </div>
        <div className="camera-list mobile-point-list" aria-label="點位清單">
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

          {showVehicleDetectorList && (
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
                        <small>{vehicleDetector.roadName || "未命名道路"} · VD</small>
                        {distanceText && <span className="camera-distance">{distanceText}</span>}
                      </span>
                    </span>
                  </button>
                );
              })}
            </section>
          )}

          {!loading && !mobileShownItemCount && (
            <div className="empty-state">
              <Video size={22} />
              <span>{emptyStateText}</span>
            </div>
          )}

          {mobileCanLoadMore && (
            <div className="load-more-row">
              <button className="action-button" type="button" onClick={() => setVisibleCount((count) => count + 80)}>
                載入更多點位
              </button>
            </div>
          )}
        </div>
      </>
    );
  }

  function renderMobileSearchSheet() {
    return (
      <div className="mobile-sheet-stack">
        {renderMobileSearchBlock()}
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
        {searchPlace && !shownItemCount && (
          <div className="status-message warning">
            <AlertCircle size={17} />
            <span>找不到 {searchPlace.title} 附近的點位</span>
          </div>
        )}
        {renderMobilePointList()}
      </div>
    );
  }

  function renderMobileLayerSheet() {
    return (
      <div className="mobile-sheet-stack">
        <div className="layer-grid">
          <LayerToggle
            checked={visibleLayers.cameras}
            count={summary?.cameras.total ?? 0}
            label="即時影像"
            onToggle={() => toggleLayer("cameras")}
          />
          <LayerToggle
            checked={visibleLayers.vehicleDetectors}
            count={summary?.vehicleDetectors.total ?? 0}
            label="交通偵測"
            onToggle={() => toggleLayer("vehicleDetectors")}
          />
          <LayerToggle
            checked={visibleLayers.radar}
            detail={radarLayerDetail(radarOverlay, radarOverlayLoading, radarOverlayError)}
            icon={<CloudRain size={16} />}
            label="雷達回波"
            onToggle={() => toggleLayer("radar")}
          />
        </div>
        {visibleLayers.radar && radarOverlayError && (
          <div className="radar-status warning">
            <AlertCircle size={15} />
            <span>雷達回波暫時無法取得：{radarOverlayError}</span>
          </div>
        )}
        {visibleLayers.radar && radarOverlay && !radarOverlayError && (
          <div className={radarOverlay.cache.stale ? "radar-status warning" : "radar-status"}>
            <CloudRain size={15} />
            <span>
              雷達時間 {formatRadarTime(radarOverlay.dateTime)}
              {radarOverlay.cache.stale ? "，顯示暫存資料" : ""}
            </span>
          </div>
        )}
        {visibleLayers.radar && (
          <div className="radar-controls">
            <label className="radar-opacity-control">
              <span>透明度</span>
              <input
                aria-label="雷達回波透明度"
                max="0.9"
                min="0.25"
                onChange={(event) => setRadarOpacity(Number(event.target.value))}
                step="0.05"
                type="range"
                value={radarOpacity}
              />
              <strong>{Math.round(radarOpacity * 100)}%</strong>
            </label>
            <div className="radar-legend" aria-label="雷達回波圖例">
              <span>弱</span>
              <span className="radar-legend-track" />
              <span>強</span>
            </div>
          </div>
        )}
        <div className="category-stats" aria-label="CCTV 統計">
          <span>國道 {formatNumber(summary?.cameras.byCategory.freeway ?? 0)}</span>
          <span>省道 {formatNumber(summary?.cameras.byCategory.highway ?? 0)}</span>
          <span>市區 {formatNumber(summary?.cameras.byCategory.city ?? 0)}</span>
          <span>景點 {formatNumber(summary?.cameras.byCategory.scenic ?? 0)}</span>
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
      </div>
    );
  }

  function renderMobileRainSheet() {
    return (
      <div className="mobile-sheet-stack">
        <button
          className={rainModeActive ? "action-button active rain mobile-mode-button" : "action-button rain mobile-mode-button"}
          type="button"
          onClick={toggleRainMode}
        >
          <CloudRain size={17} />
          {rainModeActive ? "雨天模式已開啟" : "開啟雨天模式"}
        </button>
        {rainModeActive ? (
          <RainStatusBlock
            environment={rainWeather}
            environmentError={rainWeatherError}
            loadingLocation={loadingLocation}
            rainfall={rainfall}
            rainfallError={rainfallError}
            rainfallLoading={rainfallLoading}
            radar={radarOverlay}
            radarError={radarOverlayError}
            radarLoading={radarOverlayLoading}
            target={rainObservationTarget}
          />
        ) : (
          <div className="status-message warning">
            <AlertCircle size={17} />
            <span>開啟後會顯示雷達、最近雨量站與降雨摘要。</span>
          </div>
        )}
        {visibleLayers.radar && (
          <div className="radar-controls">
            <label className="radar-opacity-control">
              <span>雷達透明度</span>
              <input
                aria-label="雷達回波透明度"
                max="0.9"
                min="0.25"
                onChange={(event) => setRadarOpacity(Number(event.target.value))}
                step="0.05"
                type="range"
                value={radarOpacity}
              />
              <strong>{Math.round(radarOpacity * 100)}%</strong>
            </label>
          </div>
        )}
      </div>
    );
  }

  function renderMobileFavoritesSheet() {
    return (
      <div className="mobile-sheet-stack">
        <div className="mobile-favorites-summary">
          <Star size={18} />
          <span>已收藏 {favoriteCount.toLocaleString("zh-TW")} 個攝影機</span>
        </div>
        {renderMobilePointList({ includeVehicleDetectors: false })}
      </div>
    );
  }

  const activeMobileContextSheet = activeMobileSheet && activeMobileSheet !== "detail" ? activeMobileSheet : undefined;

  return (
    <main className="app-shell">
      <CameraMap
        cameras={filteredCameras}
        vehicleDetectors={isFocusedList ? [] : filteredVehicleDetectors}
        selectedCamera={selectedCamera}
        selectedVehicleDetector={selectedVehicleDetector}
        radarOverlay={visibleLayers.radar ? radarOverlay : undefined}
        radarOpacity={radarOpacity}
        searchPlace={searchPlace}
        userLocation={userLocation}
        userLocationFocusRequest={userLocationFocusRequest}
        focusCameras={focusedListFilter ? filteredCameras : undefined}
        onSelectCamera={selectCamera}
        onSelectVehicleDetector={selectVehicleDetector}
        onViewportTargetChange={setMapViewportTarget}
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
        <div className="control-panel-content" ref={controlPanelContentRef} onScroll={handleControlPanelScroll}>
        <div className="brand-row">
          <div>
            <p className="eyebrow">Taiwan Live Cam</p>
            <h1>台灣即時影像</h1>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={refreshCurrentView}
            title="重新整理目前資料"
            aria-label="重新整理目前資料"
            disabled={loading}
          >
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
            className={rainModeActive ? "action-button active rain" : "action-button rain"}
            type="button"
            onClick={toggleRainMode}
          >
            <CloudRain size={17} />
            雨天路況
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
            <LayerToggle
              checked={visibleLayers.radar}
              detail={radarLayerDetail(radarOverlay, radarOverlayLoading, radarOverlayError)}
              icon={<CloudRain size={16} />}
              label="雷達回波"
              onToggle={() => toggleLayer("radar")}
            />
          </div>
          {visibleLayers.radar && radarOverlayError && (
            <div className="radar-status warning">
              <AlertCircle size={15} />
              <span>雷達回波暫時無法取得：{radarOverlayError}</span>
            </div>
          )}
          {visibleLayers.radar && radarOverlay && !radarOverlayError && (
            <div className={radarOverlay.cache.stale ? "radar-status warning" : "radar-status"}>
              <CloudRain size={15} />
              <span>
                雷達時間 {formatRadarTime(radarOverlay.dateTime)}
                {radarOverlay.cache.stale ? "，顯示暫存資料" : ""}
              </span>
            </div>
          )}
          {visibleLayers.radar && (
            <div className="radar-controls">
              <label className="radar-opacity-control">
                <span>透明度</span>
                <input
                  aria-label="雷達回波透明度"
                  max="0.9"
                  min="0.25"
                  onChange={(event) => setRadarOpacity(Number(event.target.value))}
                  step="0.05"
                  type="range"
                  value={radarOpacity}
                />
                <strong>{Math.round(radarOpacity * 100)}%</strong>
              </label>
              <div className="radar-legend" aria-label="雷達回波圖例">
                <span>弱</span>
                <span className="radar-legend-track" />
                <span>強</span>
              </div>
            </div>
          )}
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

        {rainModeActive && (
          <RainStatusBlock
            environment={rainWeather}
            environmentError={rainWeatherError}
            loadingLocation={loadingLocation}
            rainfall={rainfall}
            rainfallError={rainfallError}
            rainfallLoading={rainfallLoading}
            radar={radarOverlay}
            radarError={radarOverlayError}
            radarLoading={radarOverlayLoading}
            target={rainObservationTarget}
          />
        )}

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

        {cameraFilter === "nearby" && nearbyTourismTarget && (
          <NearbyTourismBlock
            compact
            tourism={nearbyTourism}
            loading={nearbyTourismLoading}
            error={nearbyTourismError}
            googleRestaurants={googleRestaurants}
            googleRestaurantsLoading={googleRestaurantsLoading}
            googleRestaurantsError={googleRestaurantsError}
            title={formatMapRecommendationTitle(nearbyTourismTarget)}
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
        </div>
        {showPanelTopButton && (
          <button
            className="panel-top-button"
            type="button"
            onClick={scrollControlPanelToTop}
            aria-label="回到最上方"
            title="回到最上方"
          >
            <ArrowUp size={20} />
          </button>
        )}
      </aside>

      <nav className="mobile-bottom-nav" aria-label="手機快捷操作">
        <button
          className={activeMobileSheet === "search" ? "mobile-nav-button active" : "mobile-nav-button"}
          type="button"
          onClick={() => openMobileSheet("search")}
        >
          <Search size={19} />
          <span>搜尋</span>
        </button>
        <button
          className={isLocationMode ? "mobile-nav-button active" : "mobile-nav-button"}
          type="button"
          onClick={openMobileLocationSearch}
          disabled={loadingLocation}
        >
          <LocateFixed size={19} />
          <span>定位</span>
        </button>
        <button
          className={rainModeActive || activeMobileSheet === "rain" ? "mobile-nav-button active rain" : "mobile-nav-button"}
          type="button"
          onClick={() => {
            setActiveMobileSheet("rain");
            setMobileSheetSnap("half");
            setSelectedCamera(undefined);
            setSelectedVehicleDetector(undefined);
          }}
        >
          <CloudRain size={19} />
          <span>雨天</span>
        </button>
        <button
          className={activeMobileSheet === "layers" ? "mobile-nav-button active" : "mobile-nav-button"}
          type="button"
          onClick={() => openMobileSheet("layers")}
        >
          <Layers size={19} />
          <span>圖層</span>
        </button>
        <button
          className={activeMobileSheet === "nearby" ? "mobile-nav-button active" : "mobile-nav-button"}
          type="button"
          onClick={() => openMobileSheet("nearby")}
        >
          <MapPin size={19} />
          <span>推薦</span>
        </button>
        <button
          className={activeMobileSheet === "favorites" || (!activeMobileSheet && cameraFilter === "favorites") ? "mobile-nav-button active" : "mobile-nav-button"}
          type="button"
          onClick={openMobileFavorites}
        >
          <Star size={19} />
          <span>收藏</span>
        </button>
      </nav>

      {activeMobileContextSheet && (
        <MobileContextSheet
          title={mobileSheetTitle(activeMobileContextSheet)}
          icon={mobileSheetIcon(activeMobileContextSheet)}
          snap={mobileSheetSnap}
          dragging={mobileSheetDragOffset !== 0}
          style={mobileSheetStyle}
          onClose={closeMobileSheet}
          onToggleSnap={toggleMobileSheetSnap}
          onKeyDown={handleMobileSheetKeyDown}
          onPointerCancel={cancelMobileSheetDrag}
          onPointerDown={beginMobileSheetDrag}
          onPointerMove={moveMobileSheetDrag}
          onPointerUp={endMobileSheetDrag}
        >
          {activeMobileContextSheet === "search" && renderMobileSearchSheet()}
          {activeMobileContextSheet === "layers" && renderMobileLayerSheet()}
          {activeMobileContextSheet === "rain" && renderMobileRainSheet()}
          {activeMobileContextSheet === "nearby" && renderMobileNearbySheet()}
          {activeMobileContextSheet === "favorites" && renderMobileFavoritesSheet()}
        </MobileContextSheet>
      )}

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
            setActiveMobileSheet(undefined);
          }}
          onToggleFavorite={() => selectedCamera && toggleFavorite(selectedCamera.id)}
        />
      )}

      <MapHud
        environment={mapEnvironment}
        error={mapEnvironmentError}
        loading={mapEnvironmentLoading}
        target={mapDataTarget}
      />
    </main>
  );
}

function MobileContextSheet({
  children,
  dragging,
  icon,
  onClose,
  onKeyDown,
  onPointerCancel,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onToggleSnap,
  snap,
  style,
  title
}: {
  children: ReactNode;
  dragging: boolean;
  icon: ReactNode;
  onClose: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLButtonElement>) => void;
  onToggleSnap: () => void;
  snap: ControlPanelSnap;
  style?: CSSProperties;
  title: string;
}) {
  return (
    <section className={`mobile-context-sheet snap-${snap}${dragging ? " dragging" : ""}`} style={style} aria-label={title}>
      <button
        className="mobile-sheet-handle"
        type="button"
        aria-expanded={snap !== "hidden"}
        aria-label="調整底部頁高度"
        onClick={onToggleSnap}
        onKeyDown={onKeyDown}
        onPointerCancel={onPointerCancel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
      <div className="mobile-sheet-header">
        <div>
          {icon}
          <h2>{title}</h2>
        </div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="關閉底部頁" title="關閉底部頁">
          <X size={18} />
        </button>
      </div>
      <div className="mobile-sheet-content">{children}</div>
    </section>
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
      <div title="影像清單由伺服器整理，約每 20 分鐘更新一次">
        <span>清單更新</span>
        <strong>{updatedAt ? formatRelativeTime(updatedAt) : "尚未載入"}</strong>
      </div>
    </div>
  );
}

function LayerToggle({
  checked,
  count,
  detail,
  icon,
  label,
  onToggle
}: {
  checked: boolean;
  count?: number;
  detail?: string;
  icon?: ReactNode;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button aria-pressed={checked} className={checked ? "layer-toggle active" : "layer-toggle"} onClick={onToggle} type="button">
      <span className="toggle-indicator" aria-hidden="true">
        {icon}
      </span>
      <span>
        <strong>{label}</strong>
        <small>{detail || `${formatNumber(count ?? 0)} 點`}</small>
      </span>
    </button>
  );
}

function RainStatusBlock({
  environment,
  environmentError,
  loadingLocation,
  rainfall,
  rainfallError,
  rainfallLoading,
  radar,
  radarError,
  radarLoading,
  target
}: {
  environment?: EnvironmentSummary;
  environmentError: string;
  loadingLocation: boolean;
  rainfall?: RainfallResponse;
  rainfallError: string;
  rainfallLoading: boolean;
  radar?: RadarOverlayResponse;
  radarError: string;
  radarLoading: boolean;
  target?: ObservationTarget;
}) {
  const nearestStation = rainfall?.stations[0];
  const rainProbability = environment?.weather?.rainProbability;
  const statusText = [
    radar?.cache.stale ? "雷達暫存" : radar ? "雷達正常" : radarLoading ? "雷達讀取中" : "雷達待命",
    rainfall?.cache.stale ? "雨量暫存" : rainfall ? "雨量正常" : rainfallLoading ? "雨量讀取中" : "雨量待命"
  ].join(" · ");
  const hasWarning = Boolean(radarError || rainfallError || environmentError || radar?.cache.stale || rainfall?.cache.stale);

  return (
    <section className="rain-status-panel" aria-label="雨天狀態">
      <div className="panel-title">
        <CloudRain size={17} />
        <h3>雨天狀態</h3>
        {target && <span className="rain-target-label">{target.title}</span>}
      </div>

      {!target && (
        <div className="status-message warning">
          <AlertCircle size={17} />
          <span>{loadingLocation ? "正在取得目前位置。" : "尚未取得觀察位置。"}</span>
        </div>
      )}

      {target && (
        <>
          <div className="rain-status-grid">
            <div>
              <span>雷達</span>
              <strong>{radar ? formatRadarTime(radar.dateTime) : radarLoading ? "讀取中" : "不可用"}</strong>
              <small>{radar?.cache.updatedAt ? `更新 ${formatRelativeTime(radar.cache.updatedAt)}` : "中央氣象署"}</small>
            </div>
            <div>
              <span>最近雨量站</span>
              <strong>{nearestStation ? nearestStation.stationName : rainfallLoading ? "讀取中" : "無資料"}</strong>
              <small>{nearestStation ? formatListDistance(target, nearestStation) : formatDistanceMeters(rainfall?.origin.radiusMeters)}</small>
            </div>
            <div>
              <span>1 小時雨量</span>
              <strong>{formatRainAmount(nearestStation?.rain1Hour)}</strong>
              <small>10 分 {formatRainAmount(nearestStation?.rain10Min)} · 3 小時 {formatRainAmount(nearestStation?.rain3Hour)}</small>
            </div>
            <div>
              <span>降雨機率</span>
              <strong>{rainProbability !== undefined ? `${rainProbability}%` : "未提供"}</strong>
              <small>{environment?.weather?.description || "預報待更新"}</small>
            </div>
          </div>

          {nearestStation && (
            <div className="rainfall-station-strip" aria-label="雨量站摘要">
              <span>{nearestStation.county}{nearestStation.town}</span>
              <span>24 小時 {formatRainAmount(nearestStation.rain24Hour)}</span>
              <span>{formatRadarTime(nearestStation.obsTime)}</span>
            </div>
          )}

          <div className={hasWarning ? "rain-data-health warning" : "rain-data-health"}>
            <span>{statusText}</span>
            {(radarError || rainfallError || environmentError) && (
              <small>{[radarError, rainfallError, environmentError].filter(Boolean).join(" · ")}</small>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function MapHud({
  environment,
  error,
  loading,
  target
}: {
  environment?: EnvironmentSummary;
  error: string;
  loading: boolean;
  target?: ObservationTarget;
}) {
  const [expanded, setExpanded] = useState(false);
  const [interactive, setInteractive] = useState(false);
  const legendId = "map-hud-legend";
  const className = ["map-hud", expanded ? "expanded" : "", target ? "" : "no-weather"].filter(Boolean).join(" ");

  useEffect(() => {
    const query = window.matchMedia("(max-width: 980px)");
    const syncInteractive = () => setInteractive(query.matches);

    syncInteractive();
    query.addEventListener("change", syncInteractive);
    return () => query.removeEventListener("change", syncInteractive);
  }, []);

  return (
    <div className={className} aria-label="地圖資訊">
      <MapWeatherChip
        environment={environment}
        error={error}
        expanded={expanded}
        interactive={interactive}
        legendId={legendId}
        loading={loading}
        onToggle={() => interactive && setExpanded((current) => !current)}
        target={target}
      />
      <div className="map-hud-legend" id={legendId}>
        <MapLegend />
      </div>
    </div>
  );
}

function MapWeatherChip({
  environment,
  error,
  expanded,
  interactive,
  legendId,
  loading,
  onToggle,
  target
}: {
  environment?: EnvironmentSummary;
  error: string;
  expanded: boolean;
  interactive: boolean;
  legendId: string;
  loading: boolean;
  onToggle: () => void;
  target?: ObservationTarget;
}) {
  if (!target) {
    return null;
  }

  const weather = environment?.weather;
  const hasWarning = Boolean(error);
  const aqiBadge = formatMapAqi(environment);
  const className = hasWarning ? "map-weather-chip warning" : "map-weather-chip";
  const title = weather?.description || error || target.title;
  const content = (
    <>
      {weatherIcon(weather)}
      <span>{loading ? "天氣更新中" : environment?.county || target.title}</span>
      <strong>{loading ? "..." : formatWeatherTemperature(weather)}</strong>
      <small>{hasWarning ? "天氣暫停" : formatWeatherRain(weather)}</small>
      {aqiBadge && (
        <b className={`map-aqi-badge ${aqiBadge.level}`} title={aqiBadge.title}>
          {aqiBadge.label}
        </b>
      )}
      {interactive && <i className="map-weather-caret" aria-hidden="true" />}
    </>
  );

  if (!interactive) {
    return (
      <div className={className} title={title}>
        {content}
      </div>
    );
  }

  return (
    <button
      className={className}
      type="button"
      aria-controls={legendId}
      aria-expanded={expanded}
      onClick={onToggle}
      title={title}
    >
      {content}
    </button>
  );
}

function weatherIcon(weather?: EnvironmentSummary["weather"]) {
  const description = weather?.description ?? "";
  const rainProbability = weather?.rainProbability ?? 0;
  if (rainProbability >= 50 || description.includes("雨")) {
    return <CloudRain size={16} />;
  }
  if (description.includes("晴")) {
    return <Sun size={16} />;
  }
  return <CloudSun size={16} />;
}

function formatWeatherTemperature(weather?: EnvironmentSummary["weather"]) {
  const min = weather?.minTemperature;
  const max = weather?.maxTemperature;
  if (min !== undefined && max !== undefined) {
    return min === max ? `${min}°C` : `${min}-${max}°C`;
  }
  if (min !== undefined || max !== undefined) {
    return `${min ?? max}°C`;
  }
  return "--°C";
}

function formatWeatherRain(weather?: EnvironmentSummary["weather"]) {
  return weather?.rainProbability !== undefined ? `降雨 ${weather.rainProbability}%` : "降雨 --";
}

function formatMapAqi(environment?: EnvironmentSummary) {
  const averageAqi = environment?.aqi?.averageAqi;
  if (averageAqi === undefined) {
    return undefined;
  }

  const value = Math.round(averageAqi);
  const status = environment?.aqi?.status;
  const pollutant = environment?.aqi?.dominantPollutant;
  const details = [status, pollutant ? `主要污染物 ${pollutant}` : ""].filter(Boolean).join(" · ");

  return {
    label: `AQI ${value}`,
    level: aqiLevelClass(value),
    title: details ? `AQI ${value} · ${details}` : `AQI ${value}`
  };
}

function aqiLevelClass(value: number) {
  if (value <= 50) return "good";
  if (value <= 100) return "moderate";
  if (value <= 150) return "sensitive";
  return "unhealthy";
}

function formatMapRecommendationTitle(target: ObservationTarget) {
  return `${target.title}的景點與餐飲`;
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

function roundedObservationTarget(target: ObservationTarget): ObservationTarget {
  return {
    ...target,
    lat: Number(target.lat.toFixed(3)),
    lon: Number(target.lon.toFixed(3))
  };
}

function coordinateBucket(target?: Pick<ObservationTarget, "lat" | "lon">) {
  return target ? `${target.lat.toFixed(3)}:${target.lon.toFixed(3)}` : "";
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

function formatDistanceMeters(value: number | undefined) {
  if (value === undefined) {
    return "";
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)} 公里內`;
  }
  return `${Math.round(value)} 公尺內`;
}

function formatRainAmount(value: number | undefined) {
  if (value === undefined) {
    return "未提供";
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} mm`;
}

function radarLayerDetail(radar: RadarOverlayResponse | undefined, loading: boolean, error: string) {
  if (loading) return "讀取中";
  if (error) return "暫不可用";
  if (radar?.cache.stale) return "暫存回波";
  if (radar) return formatRadarTime(radar.dateTime);
  return "最新回波";
}

function formatRadarTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value || "時間未標示";
  }

  return new Intl.DateTimeFormat("zh-TW", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
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

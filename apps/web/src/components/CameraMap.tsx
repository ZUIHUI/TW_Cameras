import { MarkerClusterer, SuperClusterViewportAlgorithm } from "@googlemaps/markerclusterer";
import { useEffect, useRef, useState } from "react";
import { GOOGLE_MAPS_API_KEY, loadGoogleMaps } from "../googleMaps";
import { isFiniteNumber, normalizeHeading } from "../locationHeading";
import { decodePolyline } from "../navigationEngine";
import type { TimeTheme } from "../timeTheme";
import type { Camera, RadarOverlayResponse, RouteOption, SearchPlace, UserLocation } from "../types";

const TAIWAN_CENTER = { lat: 23.75, lng: 121 };
const VIEWPORT_PADDING_RATIO = 0.35;

const markerColors: Record<Camera["category"], string> = {
  freeway: "#0e6b52",
  highway: "#2b6fb0",
  city: "#b25d17",
  scenic: "#0f9f9a"
};

interface CameraMapProps {
  cameras: Camera[];
  selectedCamera?: Camera;
  radarOverlay?: RadarOverlayResponse;
  radarOpacity?: number;
  searchPlace?: SearchPlace;
  userLocation?: UserLocation;
  userLocationFocusRequest?: number;
  followUserLocation?: boolean;
  headingUpActive?: boolean;
  navigationRoutes?: RouteOption[];
  selectedNavigationRouteId?: string;
  navigationPreviewActive?: boolean;
  theme: TimeTheme;
  focusCameras?: Camera[];
  onSelectCamera: (camera: Camera) => void;
  onHeadingUpChange?: (active: boolean) => void;
  onSelectNavigationRoute?: (routeId: string) => void;
  onUserMapGesture?: () => void;
  onViewportTargetChange?: (target: { lat: number; lon: number; title: string }) => void;
}

interface MarkerEntry {
  marker: google.maps.Marker;
}

type MarkerData = { item: Camera };

interface MapCameraState {
  center: google.maps.LatLngLiteral;
  heading: number;
  zoom: number;
}

export function CameraMap({
  cameras,
  selectedCamera,
  radarOverlay,
  radarOpacity = 0.68,
  searchPlace,
  userLocation,
  userLocationFocusRequest,
  followUserLocation = false,
  headingUpActive = false,
  navigationRoutes = [],
  selectedNavigationRouteId,
  navigationPreviewActive = false,
  theme,
  focusCameras,
  onSelectCamera,
  onHeadingUpChange,
  onSelectNavigationRoute,
  onUserMapGesture,
  onViewportTargetChange
}: CameraMapProps) {
  const mapElementRef = useRef<HTMLDivElement>(null);
  const clustererRef = useRef<MarkerClusterer | undefined>(undefined);
  const markerCacheRef = useRef<Map<string, MarkerEntry>>(new Map());
  const markerDataRef = useRef<Map<string, MarkerData>>(new Map());
  const renderedMarkerKeysRef = useRef<Set<string>>(new Set());
  const accuracyCircleRef = useRef<google.maps.Circle | undefined>(undefined);
  const userLocationMarkerRef = useRef<google.maps.Marker | undefined>(undefined);
  const userHeadingMarkerRef = useRef<google.maps.Marker | undefined>(undefined);
  const radarOverlayRef = useRef<google.maps.GroundOverlay | undefined>(undefined);
  const searchMarkerRef = useRef<google.maps.Marker | undefined>(undefined);
  const navigationPolylineRefs = useRef<google.maps.Polyline[]>([]);
  const navigationEndpointMarkerRefs = useRef<google.maps.Marker[]>([]);
  const mapCameraStateRef = useRef<MapCameraState | undefined>(undefined);
  const onSelectCameraRef = useRef(onSelectCamera);
  const onHeadingUpChangeRef = useRef(onHeadingUpChange);
  const onSelectNavigationRouteRef = useRef(onSelectNavigationRoute);
  const onUserMapGestureRef = useRef(onUserMapGesture);
  const onViewportTargetChangeRef = useRef(onViewportTargetChange);
  const lastUserLocationFocusRequestRef = useRef(userLocationFocusRequest);
  const [map, setMap] = useState<google.maps.Map | undefined>();
  const [mapHeading, setMapHeading] = useState(0);
  const [viewportBounds, setViewportBounds] = useState<google.maps.LatLngBoundsLiteral | undefined>();
  const [loadError, setLoadError] = useState("");

  onSelectCameraRef.current = onSelectCamera;
  onHeadingUpChangeRef.current = onHeadingUpChange;
  onSelectNavigationRouteRef.current = onSelectNavigationRoute;
  onUserMapGestureRef.current = onUserMapGesture;
  onViewportTargetChangeRef.current = onViewportTargetChange;
  const followedHeading =
    headingUpActive && isFiniteNumber(userLocation?.heading)
      ? normalizeHeading(userLocation.heading)
      : 0;

  function ensureMarker({
    color,
    key,
    item,
    selected,
    title
  }: {
    color: string;
    key: string;
    item: { lat: number; lon: number };
    selected: boolean;
    title: string;
  }): MarkerEntry {
    const cached = markerCacheRef.current.get(key);
    if (cached) {
      cached.marker.setIcon(markerIcon(color, selected));
      cached.marker.setPosition({ lat: item.lat, lng: item.lon });
      cached.marker.setTitle(title);
      cached.marker.setZIndex(selected ? google.maps.Marker.MAX_ZINDEX + 1 : undefined);
      return cached;
    }

    const marker = new google.maps.Marker({
      icon: markerIcon(color, selected),
      optimized: true,
      position: { lat: item.lat, lng: item.lon },
      title,
      zIndex: selected ? google.maps.Marker.MAX_ZINDEX + 1 : undefined
    });

    marker.addListener("click", () => {
      const markerData = markerDataRef.current.get(key);
      if (!markerData) return;

      onSelectCameraRef.current(markerData.item);
    });

    const entry = { marker };
    markerCacheRef.current.set(key, entry);
    return entry;
  }

  useEffect(() => {
    if (!GOOGLE_MAPS_API_KEY) {
      return;
    }

    let cancelled = false;
    let nextMap: google.maps.Map | undefined;
    setLoadError("");
    loadGoogleMaps()
      .then(async ({ Map, RenderingType }) => {
        const { ColorScheme } = await google.maps.importLibrary("core");
        if (cancelled || !mapElementRef.current) return;

        const initialCamera = mapCameraStateRef.current;
        nextMap = new Map(mapElementRef.current, {
          backgroundColor: mapBackgroundColor(theme),
          cameraControl: false,
          center: initialCamera?.center ?? TAIWAN_CENTER,
          clickableIcons: false,
          colorScheme: theme === "night" ? ColorScheme.DARK : ColorScheme.LIGHT,
          fullscreenControl: false,
          gestureHandling: "greedy",
          heading: initialCamera?.heading ?? 0,
          headingInteractionEnabled: true,
          isFractionalZoomEnabled: true,
          mapTypeControl: false,
          maxZoom: 18,
          minZoom: 6,
          renderingType: RenderingType.VECTOR,
          rotateControl: false,
          streetViewControl: false,
          tilt: 0,
          tiltInteractionEnabled: false,
          zoom: initialCamera?.zoom ?? 7,
          zoomControl: true
        });

        setMap(nextMap);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : String(error));
        }
      });

    return () => {
      cancelled = true;
      if (nextMap) {
        const center = nextMap.getCenter();
        mapCameraStateRef.current = center
          ? {
              center: center.toJSON(),
              heading: normalizeHeading(nextMap.getHeading() || 0),
              zoom: nextMap.getZoom() || 7
            }
          : mapCameraStateRef.current;
        google.maps.event.clearInstanceListeners(nextMap);
      }
      setMap((current) => (current === nextMap ? undefined : current));
    };
  }, [theme]);

  useEffect(() => {
    if (!map) return;

    clustererRef.current = new MarkerClusterer({
      map,
      markers: [],
      algorithm: new SuperClusterViewportAlgorithm({
        maxZoom: 17,
        radius: 84,
        viewportPadding: 120
      }),
      renderer: {
        render: ({ count, position }) =>
          new google.maps.Marker({
            icon: {
              fillColor: "#183c35",
              fillOpacity: 0.92,
              path: google.maps.SymbolPath.CIRCLE,
              scale: Math.min(24, 12 + String(count).length * 3),
              strokeColor: "#ffffff",
              strokeWeight: 2
            },
            label: {
              color: "#ffffff",
              fontSize: "12px",
              fontWeight: "700",
              text: String(count)
            },
            position,
            zIndex: google.maps.Marker.MAX_ZINDEX + count
          })
      }
    });

    return () => {
      clustererRef.current?.clearMarkers();
      markerCacheRef.current.forEach(({ marker }) => marker.setMap(null));
      markerCacheRef.current.clear();
      markerDataRef.current.clear();
      renderedMarkerKeysRef.current.clear();
      clustererRef.current = undefined;
    };
  }, [map]);

  useEffect(() => {
    if (!map) return;

    const syncHeading = () => {
      const nextHeading = normalizeHeading(map.getHeading() || 0);
      setMapHeading((current) => (current === nextHeading ? current : nextHeading));
    };

    const listener = map.addListener("heading_changed", syncHeading);
    syncHeading();

    return () => {
      listener.remove();
    };
  }, [map]);

  useEffect(() => {
    if (!map) return;

    const syncViewportBounds = () => {
      const nextBounds = map.getBounds();
      const nextCenter = map.getCenter();
      if (!nextBounds || !nextCenter) return;

      mapCameraStateRef.current = {
        center: nextCenter.toJSON(),
        heading: normalizeHeading(map.getHeading() || 0),
        zoom: map.getZoom() || 7
      };
      setViewportBounds(boundsToLiteral(nextBounds));
      onViewportTargetChangeRef.current?.({
        lat: nextCenter.lat(),
        lon: nextCenter.lng(),
        title: "目前地圖位置"
      });
    };

    const listener = map.addListener("idle", syncViewportBounds);
    syncViewportBounds();

    return () => {
      listener.remove();
    };
  }, [map]);

  useEffect(() => {
    if (!map) return;

    const listener = map.addListener("dragstart", () => {
      onHeadingUpChangeRef.current?.(false);
      onUserMapGestureRef.current?.();
    });

    return () => {
      listener.remove();
    };
  }, [map]);

  useEffect(() => {
    if (!map || !clustererRef.current || !viewportBounds) return;

    const paddedBounds = padBounds(viewportBounds, VIEWPORT_PADDING_RATIO);
    const selectedCameraKey = selectedCamera ? cameraMarkerKey(selectedCamera.id) : "";
    const nextKeys = new Set<string>();
    const validKeys = new Set<string>();
    const markersToAdd: google.maps.Marker[] = [];
    const markersToRemove: google.maps.Marker[] = [];

    cameras.forEach((camera) => {
      const key = cameraMarkerKey(camera.id);
      validKeys.add(key);
      markerDataRef.current.set(key, { item: camera });

      if (!isWithinBounds(camera, paddedBounds) && key !== selectedCameraKey) {
        return;
      }

      nextKeys.add(key);
      const entry = ensureMarker({
        key,
        color: markerColors[camera.category],
        item: camera,
        selected: key === selectedCameraKey,
        title: camera.title
      });

      if (!renderedMarkerKeysRef.current.has(key)) {
        markersToAdd.push(entry.marker);
      }
    });

    markerCacheRef.current.forEach((entry, key) => {
      if (!validKeys.has(key)) {
        if (renderedMarkerKeysRef.current.has(key)) {
          markersToRemove.push(entry.marker);
        }
        entry.marker.setMap(null);
        markerCacheRef.current.delete(key);
        markerDataRef.current.delete(key);
        renderedMarkerKeysRef.current.delete(key);
      }
    });

    renderedMarkerKeysRef.current.forEach((key) => {
      if (!nextKeys.has(key)) {
        const entry = markerCacheRef.current.get(key);
        if (entry) {
          markersToRemove.push(entry.marker);
          entry.marker.setMap(null);
        }
      }
    });

    if (markersToRemove.length) {
      clustererRef.current.removeMarkers(markersToRemove, true);
    }
    if (markersToAdd.length) {
      clustererRef.current.addMarkers(markersToAdd, true);
    }
    if (markersToRemove.length || markersToAdd.length || selectedCameraKey) {
      clustererRef.current.render();
    }

    renderedMarkerKeysRef.current = nextKeys;
  }, [
    cameras,
    map,
    selectedCamera?.id,
    viewportBounds
  ]);

  useEffect(() => {
    if (!map) return;

    radarOverlayRef.current?.setMap(null);
    radarOverlayRef.current = undefined;
    if (!radarOverlay) {
      return;
    }

    radarOverlayRef.current = new google.maps.GroundOverlay(
      radarOverlay.imageUrl,
      {
        east: radarOverlay.bounds.east,
        north: radarOverlay.bounds.north,
        south: radarOverlay.bounds.south,
        west: radarOverlay.bounds.west
      },
      {
        clickable: false,
        opacity: radarOpacity
      }
    );
    radarOverlayRef.current.setMap(map);

    return () => {
      radarOverlayRef.current?.setMap(null);
      radarOverlayRef.current = undefined;
    };
  }, [map, radarOpacity, radarOverlay?.bounds.east, radarOverlay?.bounds.north, radarOverlay?.bounds.south, radarOverlay?.bounds.west, radarOverlay?.imageUrl]);

  useEffect(() => {
    if (!map) return;

    accuracyCircleRef.current = new google.maps.Circle({
      clickable: false,
      fillColor: "#60a5fa",
      fillOpacity: 0.14,
      strokeColor: "#2563eb",
      strokeOpacity: 0.42,
      strokeWeight: 1,
      zIndex: 2
    });
    userHeadingMarkerRef.current = new google.maps.Marker({
      clickable: false,
      icon: userHeadingIcon(0),
      optimized: false,
      title: "目前位置與前進方向",
      zIndex: google.maps.Marker.MAX_ZINDEX + 98
    });
    userLocationMarkerRef.current = new google.maps.Marker({
      clickable: false,
      icon: userLocationIcon(),
      optimized: false,
      title: "目前位置",
      zIndex: google.maps.Marker.MAX_ZINDEX + 100
    });

    return () => {
      accuracyCircleRef.current?.setMap(null);
      userHeadingMarkerRef.current?.setMap(null);
      userLocationMarkerRef.current?.setMap(null);
      accuracyCircleRef.current = undefined;
      userHeadingMarkerRef.current = undefined;
      userLocationMarkerRef.current = undefined;
    };
  }, [map]);

  useEffect(() => {
    if (
      !map ||
      !accuracyCircleRef.current ||
      !userHeadingMarkerRef.current ||
      !userLocationMarkerRef.current
    ) {
      return;
    }

    if (!userLocation) {
      accuracyCircleRef.current.setMap(null);
      userHeadingMarkerRef.current.setMap(null);
      userLocationMarkerRef.current.setMap(null);
      return;
    }

    const position = toLatLng(userLocation);
    accuracyCircleRef.current.setOptions({
      center: position,
      map,
      radius: Math.max(1, userLocation.accuracy)
    });
    userLocationMarkerRef.current.setOptions({
      map,
      position
    });

    if (isFiniteNumber(userLocation.heading)) {
      userHeadingMarkerRef.current.setOptions({
        icon: userHeadingIcon(normalizeHeading(userLocation.heading - mapHeading)),
        map,
        position,
        visible: true
      });
    } else {
      userHeadingMarkerRef.current.setMap(null);
    }
  }, [
    map,
    mapHeading,
    userLocation?.accuracy,
    userLocation?.heading,
    userLocation?.lat,
    userLocation?.lon
  ]);

  useEffect(() => {
    if (!map) return;

    searchMarkerRef.current?.setMap(null);
    if (!searchPlace) {
      return;
    }

    searchMarkerRef.current = new google.maps.Marker({
      icon: {
        fillColor: "#dc2626",
        fillOpacity: 1,
        path: google.maps.SymbolPath.CIRCLE,
        scale: 9,
        strokeColor: "#ffffff",
        strokeWeight: 3
      },
      label: {
        color: "#ffffff",
        fontSize: "11px",
        fontWeight: "800",
        text: "P"
      },
      map,
      position: { lat: searchPlace.lat, lng: searchPlace.lon },
      title: searchPlace.title,
      zIndex: google.maps.Marker.MAX_ZINDEX + 10
    });

    return () => {
      searchMarkerRef.current?.setMap(null);
    };
  }, [map, searchPlace]);

  useEffect(() => {
    if (!map) return;

    navigationPolylineRefs.current.forEach((polyline) => polyline.setMap(null));
    navigationEndpointMarkerRefs.current.forEach((marker) => marker.setMap(null));
    navigationPolylineRefs.current = [];
    navigationEndpointMarkerRefs.current = [];

    if (!navigationRoutes.length) {
      return;
    }

    const selectedRoute = navigationRoutes.find((route) => route.id === selectedNavigationRouteId) || navigationRoutes[0];
    const orderedRoutes = [
      ...navigationRoutes.filter((route) => route.id !== selectedRoute.id),
      selectedRoute
    ];

    orderedRoutes.forEach((route) => {
      let path: google.maps.LatLngLiteral[];
      try {
        path = decodePolyline(route.polyline).map((coordinate) => ({
          lat: coordinate.lat,
          lng: coordinate.lon
        }));
      } catch {
        return;
      }

      const selected = route.id === selectedRoute.id;
      const polyline = new google.maps.Polyline({
        clickable: true,
        map,
        path,
        strokeColor: selected ? "#1a73e8" : "#78909c",
        strokeOpacity: selected ? 0.96 : 0.7,
        strokeWeight: selected ? 7 : 5,
        zIndex: selected ? 12 : 8
      });
      polyline.addListener("click", () => onSelectNavigationRouteRef.current?.(route.id));
      navigationPolylineRefs.current.push(polyline);
    });

    const firstLeg = selectedRoute.legs[0];
    const lastLeg = selectedRoute.legs[selectedRoute.legs.length - 1];
    if (firstLeg && lastLeg) {
      navigationEndpointMarkerRefs.current = [
        new google.maps.Marker({
          map,
          position: toLatLng(firstLeg.start),
          icon: navigationEndpointIcon("#ffffff", "#1a73e8", 6),
          title: "路線起點",
          zIndex: google.maps.Marker.MAX_ZINDEX + 30
        }),
        new google.maps.Marker({
          map,
          position: toLatLng(lastLeg.end),
          icon: navigationEndpointIcon("#1a73e8", "#ffffff", 8),
          title: "目的地",
          zIndex: google.maps.Marker.MAX_ZINDEX + 31
        })
      ];
    }

    if (navigationPreviewActive) {
      map.moveCamera({ heading: 0, tilt: 0 });
      map.fitBounds(
        {
          south: selectedRoute.viewport.south,
          west: selectedRoute.viewport.west,
          north: selectedRoute.viewport.north,
          east: selectedRoute.viewport.east
        },
        72
      );
    }

    return () => {
      navigationPolylineRefs.current.forEach((polyline) => polyline.setMap(null));
      navigationEndpointMarkerRefs.current.forEach((marker) => marker.setMap(null));
      navigationPolylineRefs.current = [];
      navigationEndpointMarkerRefs.current = [];
    };
  }, [map, navigationPreviewActive, navigationRoutes, selectedNavigationRouteId]);

  useEffect(() => {
    if (!map) return;

    if (!userLocation) {
      return;
    }

    if (lastUserLocationFocusRequestRef.current === userLocationFocusRequest) {
      return;
    }
    lastUserLocationFocusRequestRef.current = userLocationFocusRequest;

    const center = toLatLng(userLocation);
    map.moveCamera({
      center,
      heading: followedHeading,
      tilt: 0,
      zoom: Math.max(map.getZoom() || 15, 15)
    });
  }, [
    followedHeading,
    map,
    userLocation?.lat,
    userLocation?.lon,
    userLocationFocusRequest
  ]);

  useEffect(() => {
    if (!map || !followUserLocation || !userLocation) return;

    map.moveCamera({
      center: toLatLng(userLocation),
      heading: followedHeading,
      tilt: 0,
      zoom: Math.max(map.getZoom() || 15, 15)
    });
  }, [
    followedHeading,
    followUserLocation,
    map,
    userLocation?.lat,
    userLocation?.lon
  ]);

  useEffect(() => {
    if (!map) return;

    const target = selectedCamera;
    if (target) {
      map.panTo({ lat: target.lat, lng: target.lon });
      map.setZoom(Math.max(map.getZoom() || 12, 14));
      return;
    }

    if (searchPlace) {
      map.panTo({ lat: searchPlace.lat, lng: searchPlace.lon });
      map.setZoom(Math.max(map.getZoom() || 12, 15));
      return;
    }

    if (focusCameras?.length) {
      if (focusCameras.length === 1) {
        map.panTo({ lat: focusCameras[0].lat, lng: focusCameras[0].lon });
        map.setZoom(Math.max(map.getZoom() || 12, 14));
        return;
      }

      const bounds = new google.maps.LatLngBounds();
      focusCameras.forEach((camera) => bounds.extend({ lat: camera.lat, lng: camera.lon }));
      map.fitBounds(bounds, 68);
    }
  }, [focusCameras, map, searchPlace, selectedCamera]);

  if (!GOOGLE_MAPS_API_KEY) {
    return (
      <div className="map-canvas map-empty-state">
        <strong>尚未設定 Google Maps API key</strong>
        <span>請在 .env.local 和 Vercel Environment Variables 設定 VITE_GOOGLE_MAPS_API_KEY。</span>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="map-canvas map-empty-state">
        <strong>Google Maps 暫時無法載入</strong>
        <span>{loadError}</span>
      </div>
    );
  }

  return <div ref={mapElementRef} className="map-canvas" aria-label="Google Maps 即時影像地圖" />;
}

function toLatLng(location: { lat: number; lon: number }): google.maps.LatLngLiteral {
  return { lat: location.lat, lng: location.lon };
}

function userLocationIcon(): google.maps.Symbol {
  return {
    fillColor: "#4285f4",
    fillOpacity: 1,
    path: google.maps.SymbolPath.CIRCLE,
    scale: 8,
    strokeColor: "#ffffff",
    strokeOpacity: 1,
    strokeWeight: 3
  };
}

function userHeadingIcon(rotation: number): google.maps.Symbol {
  return {
    anchor: new google.maps.Point(0, 0),
    fillColor: "#4285f4",
    fillOpacity: 0.34,
    path: "M 0 -25 L 13 5 L 0 1 L -13 5 Z",
    rotation,
    scale: 1,
    strokeColor: "#ffffff",
    strokeOpacity: 0.72,
    strokeWeight: 1
  };
}

function navigationEndpointIcon(fillColor: string, strokeColor: string, scale: number): google.maps.Symbol {
  return {
    fillColor,
    fillOpacity: 1,
    path: google.maps.SymbolPath.CIRCLE,
    scale,
    strokeColor,
    strokeOpacity: 1,
    strokeWeight: 3
  };
}

function markerIcon(color: string, selected: boolean): google.maps.Symbol {
  return {
    fillColor: color,
    fillOpacity: 1,
    path: google.maps.SymbolPath.CIRCLE,
    scale: selected ? 10 : 7,
    strokeColor: "#ffffff",
    strokeWeight: selected ? 4 : 3
  };
}

function cameraMarkerKey(id: string) {
  return `camera:${id}`;
}

function boundsToLiteral(bounds: google.maps.LatLngBounds): google.maps.LatLngBoundsLiteral {
  const northEast = bounds.getNorthEast();
  const southWest = bounds.getSouthWest();
  return {
    east: northEast.lng(),
    north: northEast.lat(),
    south: southWest.lat(),
    west: southWest.lng()
  };
}

function padBounds(bounds: google.maps.LatLngBoundsLiteral, ratio: number): google.maps.LatLngBoundsLiteral {
  const latPadding = Math.max(0.01, (bounds.north - bounds.south) * ratio);
  const lngPadding = Math.max(0.01, (bounds.east - bounds.west) * ratio);

  return {
    east: bounds.east + lngPadding,
    north: bounds.north + latPadding,
    south: bounds.south - latPadding,
    west: bounds.west - lngPadding
  };
}

function isWithinBounds(item: { lat: number; lon: number }, bounds: google.maps.LatLngBoundsLiteral) {
  return item.lat >= bounds.south && item.lat <= bounds.north && item.lon >= bounds.west && item.lon <= bounds.east;
}

function mapBackgroundColor(theme: TimeTheme) {
  return theme === "night" ? "#111827" : "#e5f1f0";
}

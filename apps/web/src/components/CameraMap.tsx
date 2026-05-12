import { MarkerClusterer, SuperClusterViewportAlgorithm } from "@googlemaps/markerclusterer";
import { useEffect, useRef, useState } from "react";
import { GOOGLE_MAPS_API_KEY, loadGoogleMaps } from "../googleMaps";
import type { Camera, SearchPlace, VehicleDetector } from "../types";

const TAIWAN_CENTER = { lat: 23.75, lng: 121 };
const USER_LOCATION_RADIUS_METERS = 500;
const VIEWPORT_PADDING_RATIO = 0.35;

const markerColors: Record<Camera["category"] | "traffic", string> = {
  freeway: "#0e6b52",
  highway: "#2b6fb0",
  city: "#b25d17",
  scenic: "#0f9f9a",
  traffic: "#8b5cf6"
};

interface CameraMapProps {
  cameras: Camera[];
  vehicleDetectors?: VehicleDetector[];
  selectedCamera?: Camera;
  selectedVehicleDetector?: VehicleDetector;
  searchPlace?: SearchPlace;
  userLocation?: { lat: number; lon: number };
  userLocationFocusRequest?: number;
  focusCameras?: Camera[];
  onSelectCamera: (camera: Camera) => void;
  onSelectVehicleDetector?: (vd: VehicleDetector) => void;
}

type MarkerKind = "camera" | "vd";

interface MarkerEntry {
  kind: MarkerKind;
  marker: google.maps.Marker;
}

type MarkerData =
  | { kind: "camera"; item: Camera }
  | { kind: "vd"; item: VehicleDetector };

export function CameraMap({
  cameras,
  vehicleDetectors = [],
  selectedCamera,
  selectedVehicleDetector,
  searchPlace,
  userLocation,
  userLocationFocusRequest,
  focusCameras,
  onSelectCamera,
  onSelectVehicleDetector
}: CameraMapProps) {
  const mapElementRef = useRef<HTMLDivElement>(null);
  const clustererRef = useRef<MarkerClusterer | undefined>(undefined);
  const markerCacheRef = useRef<Map<string, MarkerEntry>>(new Map());
  const markerDataRef = useRef<Map<string, MarkerData>>(new Map());
  const renderedMarkerKeysRef = useRef<Set<string>>(new Set());
  const circleRef = useRef<google.maps.Circle | undefined>(undefined);
  const searchMarkerRef = useRef<google.maps.Marker | undefined>(undefined);
  const onSelectCameraRef = useRef(onSelectCamera);
  const onSelectVehicleDetectorRef = useRef(onSelectVehicleDetector);
  const [map, setMap] = useState<google.maps.Map | undefined>();
  const [viewportBounds, setViewportBounds] = useState<google.maps.LatLngBoundsLiteral | undefined>();
  const [loadError, setLoadError] = useState("");

  onSelectCameraRef.current = onSelectCamera;
  onSelectVehicleDetectorRef.current = onSelectVehicleDetector;

  function ensureMarker({
    color,
    key,
    kind,
    item,
    selected,
    title
  }: {
    color: string;
    key: string;
    kind: MarkerKind;
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

      if (markerData.kind === "camera") {
        onSelectCameraRef.current(markerData.item);
        return;
      }

      onSelectVehicleDetectorRef.current?.(markerData.item);
    });

    const entry = { kind, marker };
    markerCacheRef.current.set(key, entry);
    return entry;
  }

  useEffect(() => {
    if (!GOOGLE_MAPS_API_KEY) {
      return;
    }

    let cancelled = false;
    loadGoogleMaps()
      .then(({ Map }) => {
        if (cancelled || !mapElementRef.current) return;

        const nextMap = new Map(mapElementRef.current, {
          center: TAIWAN_CENTER,
          clickableIcons: false,
          fullscreenControl: false,
          gestureHandling: "greedy",
          mapTypeControl: false,
          maxZoom: 18,
          minZoom: 6,
          streetViewControl: false,
          zoom: 7
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
      setMap(undefined);
    };
  }, []);

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

    const syncViewportBounds = () => {
      const nextBounds = map.getBounds();
      if (!nextBounds) return;

      setViewportBounds(boundsToLiteral(nextBounds));
    };

    const listener = map.addListener("idle", syncViewportBounds);
    syncViewportBounds();

    return () => {
      listener.remove();
    };
  }, [map]);

  useEffect(() => {
    if (!map || !clustererRef.current || !viewportBounds) return;

    const paddedBounds = padBounds(viewportBounds, VIEWPORT_PADDING_RATIO);
    const selectedCameraKey = selectedCamera ? cameraMarkerKey(selectedCamera.id) : "";
    const selectedVdKey = selectedVehicleDetector ? vehicleDetectorMarkerKey(selectedVehicleDetector.id) : "";
    const nextKeys = new Set<string>();
    const validKeys = new Set<string>();
    const markersToAdd: google.maps.Marker[] = [];
    const markersToRemove: google.maps.Marker[] = [];

    cameras.forEach((camera) => {
      const key = cameraMarkerKey(camera.id);
      validKeys.add(key);
      markerDataRef.current.set(key, { kind: "camera", item: camera });

      if (!isWithinBounds(camera, paddedBounds) && key !== selectedCameraKey) {
        return;
      }

      nextKeys.add(key);
      const entry = ensureMarker({
        key,
        kind: "camera",
        color: markerColors[camera.category],
        item: camera,
        selected: key === selectedCameraKey,
        title: camera.title
      });

      if (!renderedMarkerKeysRef.current.has(key)) {
        markersToAdd.push(entry.marker);
      }
    });

    vehicleDetectors.forEach((vehicleDetector) => {
      const key = vehicleDetectorMarkerKey(vehicleDetector.id);
      validKeys.add(key);
      markerDataRef.current.set(key, { kind: "vd", item: vehicleDetector });

      if (!isWithinBounds(vehicleDetector, paddedBounds) && key !== selectedVdKey) {
        return;
      }

      nextKeys.add(key);
      const entry = ensureMarker({
        key,
        kind: "vd",
        color: markerColors.traffic,
        item: vehicleDetector,
        selected: key === selectedVdKey,
        title: vehicleDetector.title
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
    if (markersToRemove.length || markersToAdd.length || selectedCameraKey || selectedVdKey) {
      clustererRef.current.render();
    }

    renderedMarkerKeysRef.current = nextKeys;
  }, [
    cameras,
    map,
    selectedCamera?.id,
    selectedVehicleDetector?.id,
    vehicleDetectors,
    viewportBounds
  ]);

  useEffect(() => {
    if (!map) return;

    circleRef.current?.setMap(null);
    if (!userLocation) {
      return;
    }

    circleRef.current = new google.maps.Circle({
      center: toLatLng(userLocation),
      fillColor: "#60a5fa",
      fillOpacity: 0.14,
      map,
      radius: USER_LOCATION_RADIUS_METERS,
      strokeColor: "#2563eb",
      strokeOpacity: 0.9,
      strokeWeight: 2
    });

    return () => {
      circleRef.current?.setMap(null);
    };
  }, [map, userLocation]);

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

    if (!userLocation) {
      return;
    }

    const center = toLatLng(userLocation);
    const bounds = circleBounds(center, USER_LOCATION_RADIUS_METERS);
    map.fitBounds(bounds, 24);
  }, [map, userLocation?.lat, userLocation?.lon, userLocationFocusRequest]);

  useEffect(() => {
    if (!map) return;

    const target = selectedCamera || selectedVehicleDetector;
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
  }, [focusCameras, map, searchPlace, selectedCamera, selectedVehicleDetector]);

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

function circleBounds(center: google.maps.LatLngLiteral, radiusMeters: number) {
  const earthRadiusMeters = 6_378_137;
  const latOffset = (radiusMeters / earthRadiusMeters) * (180 / Math.PI);
  const lngOffset = latOffset / Math.cos((center.lat * Math.PI) / 180);

  return {
    east: center.lng + lngOffset,
    north: center.lat + latOffset,
    south: center.lat - latOffset,
    west: center.lng - lngOffset
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

function vehicleDetectorMarkerKey(id: string) {
  return `vd:${id}`;
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

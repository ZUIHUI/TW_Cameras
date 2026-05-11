import { MarkerClusterer } from "@googlemaps/markerclusterer";
import { useEffect, useRef, useState } from "react";
import { GOOGLE_MAPS_API_KEY, loadGoogleMaps } from "../googleMaps";
import type { Camera, SearchPlace, VehicleDetector } from "../types";

const TAIWAN_CENTER = { lat: 23.75, lng: 121 };
const USER_LOCATION_RADIUS_METERS = 500;

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
  focusCameras?: Camera[];
  onSelectCamera: (camera: Camera) => void;
  onSelectVehicleDetector?: (vd: VehicleDetector) => void;
}

export function CameraMap({
  cameras,
  vehicleDetectors = [],
  selectedCamera,
  selectedVehicleDetector,
  searchPlace,
  userLocation,
  focusCameras,
  onSelectCamera,
  onSelectVehicleDetector
}: CameraMapProps) {
  const mapElementRef = useRef<HTMLDivElement>(null);
  const clustererRef = useRef<MarkerClusterer | undefined>(undefined);
  const circleRef = useRef<google.maps.Circle | undefined>(undefined);
  const searchMarkerRef = useRef<google.maps.Marker | undefined>(undefined);
  const onSelectCameraRef = useRef(onSelectCamera);
  const onSelectVehicleDetectorRef = useRef(onSelectVehicleDetector);
  const [map, setMap] = useState<google.maps.Map | undefined>();
  const [loadError, setLoadError] = useState("");

  onSelectCameraRef.current = onSelectCamera;
  onSelectVehicleDetectorRef.current = onSelectVehicleDetector;

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

    clustererRef.current?.clearMarkers();
    const markers = [
      ...cameras.map((camera) =>
        createMapMarker({
          color: markerColors[camera.category],
          item: camera,
          map,
          selected: selectedCamera?.id === camera.id,
          title: camera.title,
          onClick: () => onSelectCameraRef.current(camera)
        })
      ),
      ...vehicleDetectors.map((vd) =>
        createMapMarker({
          color: markerColors.traffic,
          item: vd,
          map,
          selected: selectedVehicleDetector?.id === vd.id,
          title: vd.title,
          onClick: () => onSelectVehicleDetectorRef.current?.(vd)
        })
      )
    ];

    clustererRef.current = new MarkerClusterer({
      map,
      markers,
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
      markers.forEach((marker) => marker.setMap(null));
    };
  }, [
    cameras,
    map,
    selectedCamera?.id,
    selectedVehicleDetector?.id,
    vehicleDetectors
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
  }, [map, userLocation?.lat, userLocation?.lon]);

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

function createMapMarker({
  color,
  item,
  map,
  onClick,
  selected,
  title
}: {
  color: string;
  item: { lat: number; lon: number };
  map: google.maps.Map;
  onClick: () => void;
  selected: boolean;
  title: string;
}) {
  const marker = new google.maps.Marker({
    icon: {
      fillColor: color,
      fillOpacity: 1,
      path: google.maps.SymbolPath.CIRCLE,
      scale: selected ? 10 : 7,
      strokeColor: "#ffffff",
      strokeWeight: selected ? 4 : 3
    },
    map,
    optimized: true,
    position: { lat: item.lat, lng: item.lon },
    title,
    zIndex: selected ? google.maps.Marker.MAX_ZINDEX + 1 : undefined
  });

  marker.addListener("click", onClick);
  return marker;
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

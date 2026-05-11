import L from "leaflet";
import { Circle, Marker, TileLayer, Tooltip, useMap } from "react-leaflet";
import { MapContainer } from "react-leaflet/MapContainer";
import { useEffect } from "react";
import type { Camera, VehicleDetector } from "../types";

const USER_LOCATION_RADIUS_METERS = 500;

interface CameraMapProps {
  cameras: Camera[];
  vehicleDetectors?: VehicleDetector[];
  selectedCamera?: Camera;
  selectedVehicleDetector?: VehicleDetector;
  userLocation?: { lat: number; lon: number };
  onSelectCamera: (camera: Camera) => void;
  onSelectVehicleDetector?: (vd: VehicleDetector) => void;
}

export function CameraMap({ 
  cameras, 
  vehicleDetectors = [], 
  selectedCamera, 
  selectedVehicleDetector,
  userLocation,
  onSelectCamera, 
  onSelectVehicleDetector 
}: CameraMapProps) {
  return (
    <MapContainer center={[23.75, 121]} className="map-canvas" maxZoom={18} minZoom={6} scrollWheelZoom zoom={7}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <MapFocus camera={selectedCamera} vehicleDetector={selectedVehicleDetector} userLocation={userLocation} />
      {userLocation && (
        <Circle
          center={[userLocation.lat, userLocation.lon]}
          pathOptions={{ color: "#2563eb", fillColor: "#60a5fa", fillOpacity: 0.14, weight: 2 }}
          radius={USER_LOCATION_RADIUS_METERS}
        />
      )}
      {cameras.map((camera) => (
        <Marker
          eventHandlers={{ click: () => onSelectCamera(camera) }}
          icon={markerIcon(camera, selectedCamera?.id === camera.id)}
          key={camera.id}
          position={[camera.lat, camera.lon]}
        >
          <Tooltip direction="top" offset={[0, -16]} opacity={0.95}>
            {camera.title}
          </Tooltip>
        </Marker>
      ))}
      {vehicleDetectors.map((vd) => (
        <Marker
          eventHandlers={{ click: () => onSelectVehicleDetector?.(vd) }}
          icon={vdMarkerIcon(vd, selectedVehicleDetector?.id === vd.id)}
          key={vd.id}
          position={[vd.lat, vd.lon]}
        >
          <Tooltip direction="top" offset={[0, -16]} opacity={0.95}>
            {vd.title}
          </Tooltip>
        </Marker>
      ))}
    </MapContainer>
  );
}

function MapFocus({ camera, vehicleDetector, userLocation }: { camera?: Camera; vehicleDetector?: VehicleDetector; userLocation?: { lat: number; lon: number } }) {
  const map = useMap();

  useEffect(() => {
    if (userLocation && !camera && !vehicleDetector) {
      const bounds = L.latLng(userLocation.lat, userLocation.lon).toBounds(USER_LOCATION_RADIUS_METERS * 2);
      map.flyToBounds(bounds, { duration: 0.55, maxZoom: 17, padding: [24, 24] });
      return;
    }

    const target = camera || vehicleDetector;
    if (target) {
      map.flyTo([target.lat, target.lon], Math.max(map.getZoom(), 12), { duration: 0.55 });
    }
  }, [camera, vehicleDetector, userLocation, map]);

  return null;
}

function markerIcon(camera: Camera, selected: boolean) {
  const className = ["marker-pin", camera.category, selected ? "selected" : ""].filter(Boolean).join(" ");
  return L.divIcon({
    className,
    html: "<span></span>",
    iconSize: selected ? [30, 30] : [22, 22],
    iconAnchor: selected ? [15, 15] : [11, 11]
  });
}

function vdMarkerIcon(vd: VehicleDetector, selected: boolean) {
  const className = ["marker-pin", "traffic", selected ? "selected" : ""].filter(Boolean).join(" ");
  return L.divIcon({
    className,
    html: "<span></span>",
    iconSize: selected ? [30, 30] : [22, 22],
    iconAnchor: selected ? [15, 15] : [11, 11]
  });
}

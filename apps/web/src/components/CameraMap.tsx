import L from "leaflet";
import { Marker, TileLayer, Tooltip, useMap } from "react-leaflet";
import { MapContainer } from "react-leaflet/MapContainer";
import { useEffect, useMemo } from "react";
import type { Camera } from "../types";

interface CameraMapProps {
  cameras: Camera[];
  selectedCamera?: Camera;
  onSelectCamera: (camera: Camera) => void;
}

export function CameraMap({ cameras, selectedCamera, onSelectCamera }: CameraMapProps) {
  return (
    <MapContainer center={[23.75, 121]} className="map-canvas" maxZoom={18} minZoom={6} scrollWheelZoom zoom={7}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <MapFocus camera={selectedCamera} />
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
    </MapContainer>
  );
}

function MapFocus({ camera }: { camera?: Camera }) {
  const map = useMap();

  useEffect(() => {
    if (camera) {
      map.flyTo([camera.lat, camera.lon], Math.max(map.getZoom(), 12), { duration: 0.55 });
    }
  }, [camera, map]);

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

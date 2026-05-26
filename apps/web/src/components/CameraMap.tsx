import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import type { TimeTheme } from "../timeTheme";
import type { Camera, RadarOverlayResponse, SearchPlace } from "../types";

const TILE_SIZE = 256;
const MIN_ZOOM = 6;
const MAX_ZOOM = 18;
const TAIWAN_CENTER = { lat: 23.75, lon: 121 };
const USER_LOCATION_RADIUS_METERS = 500;
const VIEWPORT_PADDING_PX = 96;

interface CameraMapProps {
  cameras: Camera[];
  selectedCamera?: Camera;
  radarOverlay?: RadarOverlayResponse;
  radarOpacity?: number;
  searchPlace?: SearchPlace;
  userLocation?: { lat: number; lon: number };
  userLocationFocusRequest?: number;
  followUserLocation?: boolean;
  theme: TimeTheme;
  focusCameras?: Camera[];
  onSelectCamera: (camera: Camera) => void;
  onUserMapGesture?: () => void;
  onViewportTargetChange?: (target: { lat: number; lon: number; title: string }) => void;
}

interface ViewState {
  center: {
    lat: number;
    lon: number;
  };
  zoom: number;
}

interface Size {
  width: number;
  height: number;
}

interface Point {
  x: number;
  y: number;
}

interface ViewProjection {
  centerPoint: Point;
  topLeft: Point;
  size: Size;
  view: ViewState;
}

interface Tile {
  key: string;
  src: string;
  left: number;
  top: number;
}

interface DragState {
  moved: boolean;
  pointerId: number;
  startCenterPoint: Point;
  startX: number;
  startY: number;
  zoom: number;
}

interface ProjectedCamera {
  camera: Camera;
  kind: "camera";
  left: number;
  selected: boolean;
  top: number;
}

interface ProjectedCluster {
  cameras: Camera[];
  count: number;
  id: string;
  kind: "cluster";
  left: number;
  top: number;
}

type ProjectedMapItem = ProjectedCamera | ProjectedCluster;

export function CameraMap({
  cameras,
  selectedCamera,
  radarOverlay,
  radarOpacity = 0.68,
  searchPlace,
  userLocation,
  userLocationFocusRequest,
  followUserLocation = false,
  focusCameras,
  onSelectCamera,
  onUserMapGesture,
  onViewportTargetChange
}: CameraMapProps) {
  const mapElementRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | undefined>(undefined);
  const onUserMapGestureRef = useRef(onUserMapGesture);
  const onViewportTargetChangeRef = useRef(onViewportTargetChange);
  const lastUserLocationFocusRequestRef = useRef(userLocationFocusRequest);
  const lastFollowPanKeyRef = useRef("");
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const [view, setView] = useState<ViewState>({
    center: TAIWAN_CENTER,
    zoom: 7
  });

  onUserMapGestureRef.current = onUserMapGesture;
  onViewportTargetChangeRef.current = onViewportTargetChange;

  useEffect(() => {
    const element = mapElementRef.current;
    if (!element) return;

    const syncSize = () => {
      setSize({
        width: element.clientWidth,
        height: element.clientHeight
      });
    };

    syncSize();
    const observer = new ResizeObserver(syncSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const projection = useMemo<ViewProjection | undefined>(() => {
    if (!size.width || !size.height) return undefined;
    const centerPoint = project(view.center, view.zoom);
    return {
      centerPoint,
      size,
      topLeft: {
        x: centerPoint.x - size.width / 2,
        y: centerPoint.y - size.height / 2
      },
      view
    };
  }, [size, view]);

  const tiles = useMemo(() => (projection ? tilesForProjection(projection) : []), [projection]);
  const mapItems = useMemo(
    () => (projection ? projectCameras(cameras, projection, selectedCamera?.id) : []),
    [cameras, projection, selectedCamera?.id]
  );
  const radarBox = useMemo(
    () => (projection && radarOverlay ? projectedGeoBounds(radarOverlay.bounds, projection) : undefined),
    [
      projection,
      radarOverlay?.bounds.east,
      radarOverlay?.bounds.north,
      radarOverlay?.bounds.south,
      radarOverlay?.bounds.west
    ]
  );
  const userMarker = projection && userLocation ? projectedLocation(userLocation, projection) : undefined;
  const searchMarker = projection && searchPlace ? projectedLocation(searchPlace, projection) : undefined;
  const userRadiusPixels =
    userLocation && projection ? USER_LOCATION_RADIUS_METERS / metersPerPixel(userLocation.lat, projection.view.zoom) : 0;
  const focusCameraKey = focusCameras?.map((camera) => camera.id).join("|") || "";

  useEffect(() => {
    if (!projection) return;

    onViewportTargetChangeRef.current?.({
      lat: view.center.lat,
      lon: view.center.lon,
      title: "地圖中心"
    });
  }, [projection, view.center.lat, view.center.lon]);

  useEffect(() => {
    if (!size.width || !size.height) return;

    if (selectedCamera) {
      centerViewOn(selectedCamera, (current) => Math.max(current.zoom, 14));
      return;
    }

    if (searchPlace) {
      centerViewOn(searchPlace, (current) => Math.max(current.zoom, 15));
      return;
    }

    if (focusCameras?.length) {
      setView((current) => fitLocations(focusCameras, size, current.zoom));
    }
  }, [focusCameraKey, searchPlace?.id, selectedCamera?.id, size.height, size.width]);

  useEffect(() => {
    if (!userLocation) return;
    if (lastUserLocationFocusRequestRef.current === userLocationFocusRequest) return;

    lastUserLocationFocusRequestRef.current = userLocationFocusRequest;
    centerViewOn(userLocation, (current) => Math.max(current.zoom, 15));
  }, [userLocation?.lat, userLocation?.lon, userLocationFocusRequest]);

  useEffect(() => {
    if (!followUserLocation || !userLocation) return;

    const locationKey = `${userLocation.lat.toFixed(6)}:${userLocation.lon.toFixed(6)}`;
    if (lastFollowPanKeyRef.current === locationKey) return;

    lastFollowPanKeyRef.current = locationKey;
    centerViewOn(userLocation, (current) => Math.max(current.zoom, 15));
  }, [followUserLocation, userLocation?.lat, userLocation?.lon]);

  function centerViewOn(target: { lat: number; lon: number }, zoom: number | ((current: ViewState) => number)) {
    setView((current) =>
      normalizeView({
        center: { lat: target.lat, lon: target.lon },
        zoom: typeof zoom === "function" ? zoom(current) : zoom
      })
    );
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!projection || event.button !== 0) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      moved: false,
      pointerId: event.pointerId,
      startCenterPoint: projection.centerPoint,
      startX: event.clientX,
      startY: event.clientY,
      zoom: view.zoom
    };
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;

    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) > 3) {
      drag.moved = true;
      onUserMapGestureRef.current?.();
    }

    setView((current) => {
      if (current.zoom !== drag.zoom) return current;
      return normalizeView({
        center: unproject(
          {
            x: drag.startCenterPoint.x - dx,
            y: drag.startCenterPoint.y - dy
          },
          drag.zoom
        ),
        zoom: drag.zoom
      });
    });
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = undefined;
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // Pointer capture may already be released after cancelled gestures.
      }
    }
  }

  function handleWheel(event: ReactWheelEvent<HTMLDivElement>) {
    if (!projection || !mapElementRef.current) return;

    event.preventDefault();
    onUserMapGestureRef.current?.();

    const delta = event.deltaY < 0 ? 1 : -1;
    const nextZoom = clamp(view.zoom + delta, MIN_ZOOM, MAX_ZOOM);
    if (nextZoom === view.zoom) return;

    const rect = mapElementRef.current.getBoundingClientRect();
    zoomAtPoint(nextZoom, {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    });
  }

  function zoomBy(delta: number) {
    if (!projection) return;
    onUserMapGestureRef.current?.();
    zoomAtPoint(clamp(view.zoom + delta, MIN_ZOOM, MAX_ZOOM), {
      x: size.width / 2,
      y: size.height / 2
    });
  }

  function zoomAtPoint(nextZoom: number, screenPoint: Point) {
    if (!projection || nextZoom === view.zoom) return;

    const geoUnderPointer = unproject(
      {
        x: projection.topLeft.x + screenPoint.x,
        y: projection.topLeft.y + screenPoint.y
      },
      view.zoom
    );
    const nextPointerWorld = project(geoUnderPointer, nextZoom);
    const nextCenterPoint = {
      x: nextPointerWorld.x - (screenPoint.x - size.width / 2),
      y: nextPointerWorld.y - (screenPoint.y - size.height / 2)
    };

    setView(
      normalizeView({
        center: unproject(nextCenterPoint, nextZoom),
        zoom: nextZoom
      })
    );
  }

  function zoomToCluster(cluster: ProjectedCluster) {
    const center = averageLocation(cluster.cameras);
    onUserMapGestureRef.current?.();
    centerViewOn(center, (current) => Math.min(MAX_ZOOM, Math.max(current.zoom + 2, 9)));
  }

  return (
    <div
      ref={mapElementRef}
      className="map-canvas osm-map"
      aria-label="台灣即時影像地圖"
      onPointerCancel={handlePointerUp}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onWheel={handleWheel}
      role="application"
    >
      <div className="osm-tile-layer" aria-hidden="true">
        {tiles.map((tile) => (
          <img
            alt=""
            className="osm-tile"
            draggable={false}
            key={tile.key}
            src={tile.src}
            style={positionStyle(tile.left, tile.top, TILE_SIZE, TILE_SIZE)}
          />
        ))}
      </div>

      {radarOverlay && radarBox && (
        <img
          alt=""
          className="osm-radar-overlay"
          draggable={false}
          src={radarOverlay.imageUrl}
          style={{
            ...positionStyle(radarBox.left, radarBox.top, radarBox.width, radarBox.height),
            opacity: radarOpacity
          }}
        />
      )}

      {userMarker && (
        <>
          <div
            className="osm-user-radius"
            style={positionStyle(
              userMarker.left - userRadiusPixels,
              userMarker.top - userRadiusPixels,
              userRadiusPixels * 2,
              userRadiusPixels * 2
            )}
          />
          <div className="osm-user-marker" style={markerPositionStyle(userMarker.left, userMarker.top)} />
        </>
      )}

      {searchMarker && (
        <div
          className="osm-search-marker"
          style={markerPositionStyle(searchMarker.left, searchMarker.top)}
          title={searchPlace?.title}
        >
          <span>P</span>
        </div>
      )}

      <div className="osm-marker-layer">
        {mapItems.map((item) =>
          item.kind === "cluster" ? (
            <button
              aria-label={`${item.count} 個點位`}
              className="osm-cluster"
              key={item.id}
              onClick={(event) => {
                event.stopPropagation();
                zoomToCluster(item);
              }}
              onPointerDown={(event) => event.stopPropagation()}
              style={markerPositionStyle(item.left, item.top)}
              title={`${item.count} 個點位`}
              type="button"
            >
              {formatClusterCount(item.count)}
            </button>
          ) : (
            <button
              aria-label={item.camera.title}
              className={`osm-marker marker-pin ${item.camera.category}${item.selected ? " selected" : ""}`}
              key={item.camera.id}
              onClick={(event) => {
                event.stopPropagation();
                onSelectCamera(item.camera);
              }}
              onPointerDown={(event) => event.stopPropagation()}
              style={markerPositionStyle(item.left, item.top)}
              title={item.camera.title}
              type="button"
            >
              <span />
            </button>
          )
        )}
      </div>

      <div className="osm-map-controls" aria-label="地圖縮放">
        <button type="button" onClick={() => zoomBy(1)} aria-label="放大地圖">
          +
        </button>
        <button type="button" onClick={() => zoomBy(-1)} aria-label="縮小地圖">
          -
        </button>
      </div>

      <a className="osm-attribution" href="https://www.openstreetmap.org/copyright" rel="noreferrer" target="_blank">
        OpenStreetMap
      </a>
    </div>
  );
}

function tilesForProjection(projection: ViewProjection): Tile[] {
  const tileCount = 2 ** projection.view.zoom;
  const minTileX = Math.floor(projection.topLeft.x / TILE_SIZE);
  const maxTileX = Math.floor((projection.topLeft.x + projection.size.width) / TILE_SIZE);
  const minTileY = Math.max(0, Math.floor(projection.topLeft.y / TILE_SIZE));
  const maxTileY = Math.min(tileCount - 1, Math.floor((projection.topLeft.y + projection.size.height) / TILE_SIZE));
  const tiles: Tile[] = [];

  for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
    for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
      const wrappedX = positiveModulo(tileX, tileCount);
      tiles.push({
        key: `${projection.view.zoom}:${tileX}:${tileY}`,
        left: tileX * TILE_SIZE - projection.topLeft.x,
        src: `https://tile.openstreetmap.org/${projection.view.zoom}/${wrappedX}/${tileY}.png`,
        top: tileY * TILE_SIZE - projection.topLeft.y
      });
    }
  }

  return tiles;
}

function projectCameras(cameras: Camera[], projection: ViewProjection, selectedCameraId?: string): ProjectedMapItem[] {
  const visible = cameras
    .map((camera) => {
      const point = projectedLocation(camera, projection);
      return {
        camera,
        kind: "camera" as const,
        left: point.left,
        selected: camera.id === selectedCameraId,
        top: point.top
      };
    })
    .filter(({ left, selected, top }) => {
      if (selected) return true;
      return (
        left >= -VIEWPORT_PADDING_PX &&
        left <= projection.size.width + VIEWPORT_PADDING_PX &&
        top >= -VIEWPORT_PADDING_PX &&
        top <= projection.size.height + VIEWPORT_PADDING_PX
      );
    });

  const clusterSize = clusterGridSize(projection.view.zoom);
  if (!clusterSize) {
    return visible;
  }

  const singles: ProjectedCamera[] = [];
  const buckets = new Map<string, ProjectedCamera[]>();

  visible.forEach((item) => {
    if (item.selected) {
      singles.push(item);
      return;
    }

    const key = `${Math.floor(item.left / clusterSize)}:${Math.floor(item.top / clusterSize)}`;
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(item);
    } else {
      buckets.set(key, [item]);
    }
  });

  const clustered: ProjectedMapItem[] = [...singles];
  buckets.forEach((items, key) => {
    if (items.length === 1) {
      clustered.push(items[0]);
      return;
    }

    clustered.push({
      cameras: items.map((item) => item.camera),
      count: items.length,
      id: `cluster:${projection.view.zoom}:${key}`,
      kind: "cluster",
      left: average(items.map((item) => item.left)),
      top: average(items.map((item) => item.top))
    });
  });

  return clustered;
}

function projectedLocation(location: { lat: number; lon: number }, projection: ViewProjection) {
  const point = project(location, projection.view.zoom);
  return {
    left: point.x - projection.topLeft.x,
    top: point.y - projection.topLeft.y
  };
}

function projectedGeoBounds(
  bounds: RadarOverlayResponse["bounds"],
  projection: ViewProjection
): { left: number; top: number; width: number; height: number } {
  const northWest = project({ lat: bounds.north, lon: bounds.west }, projection.view.zoom);
  const southEast = project({ lat: bounds.south, lon: bounds.east }, projection.view.zoom);

  return {
    height: southEast.y - northWest.y,
    left: northWest.x - projection.topLeft.x,
    top: northWest.y - projection.topLeft.y,
    width: southEast.x - northWest.x
  };
}

function fitLocations(locations: Array<{ lat: number; lon: number }>, size: Size, fallbackZoom: number): ViewState {
  if (!locations.length || !size.width || !size.height) {
    return normalizeView({ center: TAIWAN_CENTER, zoom: fallbackZoom });
  }

  if (locations.length === 1) {
    return normalizeView({ center: locations[0], zoom: Math.max(fallbackZoom, 14) });
  }

  const points = locations.map((location) => project(location, 0));
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const usableWidth = Math.max(1, size.width - VIEWPORT_PADDING_PX * 2);
  const usableHeight = Math.max(1, size.height - VIEWPORT_PADDING_PX * 2);
  const dx = Math.max(0.000001, maxX - minX);
  const dy = Math.max(0.000001, maxY - minY);
  const zoom = clamp(Math.floor(Math.min(Math.log2(usableWidth / dx), Math.log2(usableHeight / dy))), MIN_ZOOM, MAX_ZOOM);

  return normalizeView({
    center: unproject(
      {
        x: (minX + maxX) / 2,
        y: (minY + maxY) / 2
      },
      0
    ),
    zoom
  });
}

function project(location: { lat: number; lon: number }, zoom: number): Point {
  const lat = clamp(location.lat, -85.05112878, 85.05112878);
  const worldSize = TILE_SIZE * 2 ** zoom;
  const sinLat = Math.sin((lat * Math.PI) / 180);

  return {
    x: ((normalizeLongitude(location.lon) + 180) / 360) * worldSize,
    y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * worldSize
  };
}

function unproject(point: Point, zoom: number): { lat: number; lon: number } {
  const worldSize = TILE_SIZE * 2 ** zoom;
  const y = clamp(point.y, 0, worldSize);
  const lon = (point.x / worldSize) * 360 - 180;
  const latRadians = Math.atan(Math.sinh(Math.PI - (2 * Math.PI * y) / worldSize));

  return {
    lat: (latRadians * 180) / Math.PI,
    lon: normalizeLongitude(lon)
  };
}

function normalizeView(view: ViewState): ViewState {
  return {
    center: {
      lat: clamp(view.center.lat, 20, 26.5),
      lon: clamp(view.center.lon, 118, 123)
    },
    zoom: clamp(Math.round(view.zoom), MIN_ZOOM, MAX_ZOOM)
  };
}

function metersPerPixel(lat: number, zoom: number) {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

function clusterGridSize(zoom: number) {
  if (zoom >= 13) return 0;
  if (zoom >= 11) return 42;
  if (zoom >= 9) return 54;
  return 70;
}

function averageLocation(cameras: Camera[]) {
  return {
    lat: average(cameras.map((camera) => camera.lat)),
    lon: average(cameras.map((camera) => camera.lon))
  };
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function formatClusterCount(count: number) {
  return count >= 1000 ? `${Math.round(count / 100) / 10}k` : String(count);
}

function positionStyle(left: number, top: number, width: number, height: number): CSSProperties {
  return {
    height,
    left,
    top,
    width
  };
}

function markerPositionStyle(left: number, top: number): CSSProperties {
  return {
    left,
    top
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeLongitude(lon: number) {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

function positiveModulo(value: number, divisor: number) {
  return ((value % divisor) + divisor) % divisor;
}

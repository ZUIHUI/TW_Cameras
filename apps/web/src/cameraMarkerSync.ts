import type { Camera } from "./types";

export interface CameraMarkerDescriptor {
  category: Camera["category"];
  key: string;
  lat: number;
  lon: number;
  title: string;
}

export interface CameraMarkerSyncPlan {
  added: CameraMarkerDescriptor[];
  next: Map<string, CameraMarkerDescriptor>;
  removedKeys: string[];
  replaced: CameraMarkerDescriptor[];
  updated: CameraMarkerDescriptor[];
}

export function cameraMarkerKey(id: string) {
  return `camera:${id}`;
}

export function planCameraMarkerSync(
  cameras: readonly Camera[],
  current: ReadonlyMap<string, CameraMarkerDescriptor>
): CameraMarkerSyncPlan {
  const next = new Map<string, CameraMarkerDescriptor>();

  cameras.forEach((camera) => {
    const descriptor: CameraMarkerDescriptor = {
      category: camera.category,
      key: cameraMarkerKey(camera.id),
      lat: camera.lat,
      lon: camera.lon,
      title: camera.title
    };
    next.set(descriptor.key, descriptor);
  });

  const added: CameraMarkerDescriptor[] = [];
  const replaced: CameraMarkerDescriptor[] = [];
  const updated: CameraMarkerDescriptor[] = [];

  next.forEach((descriptor, key) => {
    const previous = current.get(key);
    if (!previous) {
      added.push(descriptor);
      return;
    }

    if (previous.lat !== descriptor.lat || previous.lon !== descriptor.lon) {
      replaced.push(descriptor);
      return;
    }

    if (previous.category !== descriptor.category || previous.title !== descriptor.title) {
      updated.push(descriptor);
    }
  });

  const removedKeys: string[] = [];
  current.forEach((_descriptor, key) => {
    if (!next.has(key)) {
      removedKeys.push(key);
    }
  });

  return {
    added,
    next,
    removedKeys,
    replaced,
    updated
  };
}

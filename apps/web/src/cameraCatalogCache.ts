import type { CameraCatalogResponse } from "./types";

const DATABASE_NAME = "taiwan-live-cam-cache";
const DATABASE_VERSION = 1;
const STORE_NAME = "camera-catalog";
const ENTRY_KEY = "latest";
const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;

export const CAMERA_CATALOG_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const CAMERA_CATALOG_CACHE_SCHEMA_VERSION = 1;

export interface CameraCatalogCacheEntry {
  cachedAt: number;
  catalog: CameraCatalogResponse;
  schemaVersion: number;
}

export function isUsableCameraCatalogCacheEntry(
  value: unknown,
  now = Date.now()
): value is CameraCatalogCacheEntry {
  if (!value || typeof value !== "object") return false;

  const entry = value as Partial<CameraCatalogCacheEntry>;
  if (entry.schemaVersion !== CAMERA_CATALOG_CACHE_SCHEMA_VERSION) return false;
  if (typeof entry.cachedAt !== "number" || !Number.isFinite(entry.cachedAt)) return false;
  if (entry.cachedAt > now + CLOCK_SKEW_TOLERANCE_MS) return false;
  if (now - entry.cachedAt > CAMERA_CATALOG_CACHE_MAX_AGE_MS) return false;

  return isCameraCatalogResponse(entry.catalog);
}

export async function readCameraCatalogCache(): Promise<CameraCatalogResponse | undefined> {
  if (typeof indexedDB === "undefined") return undefined;

  let database: IDBDatabase | undefined;
  try {
    database = await openDatabase();
    const entry = await readEntry(database);
    return isUsableCameraCatalogCacheEntry(entry) ? entry.catalog : undefined;
  } catch {
    return undefined;
  } finally {
    database?.close();
  }
}

export async function writeCameraCatalogCache(catalog: CameraCatalogResponse): Promise<void> {
  if (typeof indexedDB === "undefined") return;

  let database: IDBDatabase | undefined;
  try {
    database = await openDatabase();
    await writeEntry(database, {
      cachedAt: Date.now(),
      catalog,
      schemaVersion: CAMERA_CATALOG_CACHE_SCHEMA_VERSION
    });
  } catch {
    // Browser storage is an optional acceleration path. Network loading remains authoritative.
  } finally {
    database?.close();
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Unable to open the camera catalog cache."));
    request.onblocked = () => reject(new Error("Camera catalog cache upgrade is blocked."));
  });
}

function readEntry(database: IDBDatabase): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(ENTRY_KEY);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Unable to read the camera catalog cache."));
    transaction.onabort = () => reject(transaction.error || new Error("Camera catalog cache read was aborted."));
  });
}

function writeEntry(database: IDBDatabase, entry: CameraCatalogCacheEntry): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(entry, ENTRY_KEY);

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Unable to write the camera catalog cache."));
    transaction.onabort = () => reject(transaction.error || new Error("Camera catalog cache write was aborted."));
  });
}

function isCameraCatalogResponse(value: unknown): value is CameraCatalogResponse {
  if (!value || typeof value !== "object") return false;

  const catalog = value as Partial<CameraCatalogResponse>;
  return (
    Array.isArray(catalog.cameras) &&
    Array.isArray(catalog.vehicleDetectors) &&
    Array.isArray(catalog.sourceErrors) &&
    typeof catalog.updatedAt === "string" &&
    Boolean(catalog.summary && typeof catalog.summary === "object") &&
    Boolean(catalog.cache && typeof catalog.cache === "object")
  );
}

import { getCameraCatalog } from "../apps/api/src/adapters/cameras.js";
import { CAMERA_CATALOG_CACHE_HEADERS, cachedJson, toErrorResponse } from "../apps/api/src/vercel.js";

export default {
  async fetch() {
    try {
      const catalog = await getCameraCatalog();
      return cachedJson(
        {
          ...catalog.value,
          cache: {
            updatedAt: catalog.updatedAt,
            stale: catalog.stale,
            error: catalog.error
          }
        },
        {
          headers: CAMERA_CATALOG_CACHE_HEADERS
        }
      );
    } catch (error) {
      return toErrorResponse(error);
    }
  }
};

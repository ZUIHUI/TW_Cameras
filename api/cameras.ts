import { getCameraCatalog } from "../apps/api/src/adapters/cameras.js";
import { cachedJson, toErrorResponse } from "../apps/api/src/vercel.js";

export default {
  async fetch() {
    try {
      const catalog = await getCameraCatalog();
      return cachedJson({
        ...catalog.value,
        cache: {
          updatedAt: catalog.updatedAt,
          stale: catalog.stale,
          error: catalog.error
        }
      });
    } catch (error) {
      return toErrorResponse(error);
    }
  }
};

import { getRadarOverlay } from "../apps/api/src/adapters/radar.js";
import { cachedJson, toErrorResponse } from "../apps/api/src/vercel.js";

export default {
  async fetch() {
    try {
      const radar = await getRadarOverlay();
      return cachedJson({
        ...radar.value,
        cache: {
          updatedAt: radar.updatedAt,
          stale: radar.stale,
          error: radar.error
        }
      });
    } catch (error) {
      return toErrorResponse(error);
    }
  }
};

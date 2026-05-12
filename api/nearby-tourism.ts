import { getNearbyTourismSummary, parseNearbyTourismQuery } from "../apps/api/src/adapters/nearbyTourism.js";
import { cachedJson, toErrorResponse } from "../apps/api/src/vercel.js";

export default {
  async fetch(request: Request) {
    try {
      const searchParams = new URL(request.url).searchParams;
      const query = parseNearbyTourismQuery({
        lat: searchParams.get("lat"),
        lon: searchParams.get("lon"),
        radius: searchParams.get("radius")
      });

      if (!query.ok) {
        return Response.json({ error: "invalid_query", message: query.message }, { status: 400 });
      }

      const summary = await getNearbyTourismSummary(query.value);
      return cachedJson({
        ...summary.value,
        cache: {
          updatedAt: summary.updatedAt,
          stale: summary.stale,
          error: summary.error
        }
      });
    } catch (error) {
      return toErrorResponse(error);
    }
  }
};

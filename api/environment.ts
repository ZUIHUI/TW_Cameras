import {
  getEnvironmentSummary,
  getEnvironmentSummaryByCoordinate,
  parseCoordinateEnvironmentQuery
} from "../apps/api/src/adapters/environment.js";
import { cachedJson, toErrorResponse } from "../apps/api/src/vercel.js";

export default {
  async fetch(request: Request) {
    try {
      const searchParams = new URL(request.url).searchParams;
      const lat = searchParams.get("lat");
      const lon = searchParams.get("lon");
      if (lat !== null || lon !== null) {
        const query = parseCoordinateEnvironmentQuery({ lat: lat ?? undefined, lon: lon ?? undefined });
        if (!query.ok) {
          return Response.json({ error: "invalid_query", message: query.message }, { status: 400 });
        }

        const summary = await getEnvironmentSummaryByCoordinate(query.value);
        return cachedJson({
          ...summary.value,
          cache: {
            updatedAt: summary.updatedAt,
            stale: summary.stale,
            error: summary.error
          }
        });
      }

      const county = searchParams.get("county")?.trim();
      if (!county) {
        return Response.json({ error: "county is required" }, { status: 400 });
      }

      const summary = await getEnvironmentSummary(county);
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

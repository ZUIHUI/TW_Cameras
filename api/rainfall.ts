import { getNearbyRainfallSummary, parseRainfallQuery } from "../apps/api/src/adapters/rainfall.js";
import { cachedJson, toErrorResponse } from "../apps/api/src/vercel.js";

export default {
  async fetch(request: Request) {
    try {
      const searchParams = new URL(request.url).searchParams;
      const query = parseRainfallQuery({
        lat: searchParams.get("lat") || undefined,
        lon: searchParams.get("lon") || undefined,
        radius: searchParams.get("radius") || undefined,
        limit: searchParams.get("limit") || undefined
      });

      if (!query.ok) {
        return Response.json({ error: "invalid_query", message: query.message }, { status: 400 });
      }

      const rainfall = await getNearbyRainfallSummary(query.value);
      return cachedJson({
        ...rainfall.value,
        cache: {
          updatedAt: rainfall.updatedAt,
          stale: rainfall.stale,
          error: rainfall.error
        }
      });
    } catch (error) {
      return toErrorResponse(error);
    }
  }
};

import { getEnvironmentSummary } from "../apps/api/src/adapters/environment.js";
import { toErrorResponse } from "../apps/api/src/vercel.js";

export default {
  async fetch(request: Request) {
    try {
      const county = new URL(request.url).searchParams.get("county")?.trim();
      if (!county) {
        return Response.json({ error: "county is required" }, { status: 400 });
      }

      const summary = await getEnvironmentSummary(county);
      return Response.json({
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

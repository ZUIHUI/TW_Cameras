import { computeRoutes, parseRouteRequest } from "../apps/api/src/adapters/routes.js";
import { toErrorResponse } from "../apps/api/src/vercel.js";

const NO_STORE_HEADERS = {
  "cache-control": "no-store"
};

export default {
  async fetch(request: Request) {
    if (request.method !== "POST") {
      return Response.json(
        { error: "method_not_allowed", message: "POST is required." },
        { status: 405, headers: { ...NO_STORE_HEADERS, allow: "POST" } }
      );
    }

    try {
      const parsed = parseRouteRequest(await request.json().catch(() => undefined));
      if (!parsed.ok) {
        return Response.json(
          { error: "invalid_request", message: parsed.message },
          { status: 400, headers: NO_STORE_HEADERS }
        );
      }

      return Response.json(await computeRoutes(parsed.value), { headers: NO_STORE_HEADERS });
    } catch (error) {
      const response = toErrorResponse(error);
      response.headers.set("cache-control", "no-store");
      return response;
    }
  }
};

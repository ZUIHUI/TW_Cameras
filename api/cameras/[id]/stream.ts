import {
  CAMERA_STREAM_CORS_HEADERS,
  fetchCameraStreamResponse
} from "../../../apps/api/src/adapters/cameraStream.js";
import { getCameraCatalog } from "../../../apps/api/src/adapters/cameras.js";
import { toErrorResponse } from "../../../apps/api/src/vercel.js";

export default {
  async fetch(request: Request) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: CAMERA_STREAM_CORS_HEADERS,
        status: 204
      });
    }

    try {
      const pathnameParts = new URL(request.url).pathname.split("/");
      const id = decodeURIComponent(pathnameParts.at(-2) || "");
      const catalog = await getCameraCatalog();
      const camera = catalog.value.cameras.find((item) => item.id === id);

      if (!camera) {
        return Response.json({ error: "Camera not found" }, { status: 404 });
      }

      return fetchCameraStreamResponse(camera, request.url, {
        accept: request.headers.get("accept"),
        range: request.headers.get("range"),
        userAgent: request.headers.get("user-agent")
      });
    } catch (error) {
      return toErrorResponse(error);
    }
  }
};

import { getCameraCatalog } from "../../apps/api/src/adapters/cameras.js";
import { toErrorResponse } from "../../apps/api/src/vercel.js";

export default {
  async fetch(request: Request) {
    try {
      const id = decodeURIComponent(new URL(request.url).pathname.split("/").at(-1) || "");
      const catalog = await getCameraCatalog();
      const camera = catalog.value.cameras.find((item) => item.id === id);

      if (!camera) {
        return Response.json({ error: "Camera not found" }, { status: 404 });
      }

      return Response.json({
        camera,
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

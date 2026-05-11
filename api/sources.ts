import { sources } from "../apps/api/src/sources.js";

export default {
  fetch() {
    return Response.json({
      updatedAt: new Date().toISOString(),
      sources
    });
  }
};

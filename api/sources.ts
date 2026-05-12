import { sources } from "../apps/api/src/sources.js";
import { cachedJson } from "../apps/api/src/vercel.js";

export default {
  fetch() {
    return cachedJson({
      updatedAt: new Date().toISOString(),
      sources
    });
  }
};

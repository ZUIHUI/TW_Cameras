import {
  getGoogleNearbyRestaurants,
  getGooglePlaceDetails,
  getGooglePlacePredictions,
  parseNearbyRestaurantsQuery,
  parsePlaceAutocompleteQuery,
  parsePlaceDetailsQuery
} from "../apps/api/src/adapters/googlePlaces.js";
import { cachedJson, toErrorResponse } from "../apps/api/src/vercel.js";

export default {
  async fetch(request: Request) {
    try {
      const searchParams = new URL(request.url).searchParams;
      const kind = searchParams.get("kind");

      if (kind === "nearby-restaurants") {
        const query = parseNearbyRestaurantsQuery({
          lat: searchParams.get("lat"),
          lon: searchParams.get("lon"),
          radius: searchParams.get("radius")
        });
        if (!query.ok) {
          return Response.json({ error: "invalid_query", message: query.message }, { status: 400 });
        }
        return cachedJson(await getGoogleNearbyRestaurants(query.value));
      }

      if (kind === "autocomplete") {
        const query = parsePlaceAutocompleteQuery({ input: searchParams.get("input") });
        if (!query.ok) {
          return Response.json({ error: "invalid_query", message: query.message }, { status: 400 });
        }
        return cachedJson(await getGooglePlacePredictions(query.value.input));
      }

      if (kind === "details") {
        const query = parsePlaceDetailsQuery({ placeId: searchParams.get("placeId") });
        if (!query.ok) {
          return Response.json({ error: "invalid_query", message: query.message }, { status: 400 });
        }
        return cachedJson(await getGooglePlaceDetails(query.value.placeId));
      }

      return Response.json({ error: "invalid_query", message: "kind is required." }, { status: 400 });
    } catch (error) {
      return toErrorResponse(error);
    }
  }
};

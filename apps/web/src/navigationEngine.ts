import type { RouteCoordinate } from "./types";

export function decodePolyline(encoded: string): RouteCoordinate[] {
  const coordinates: RouteCoordinate[] = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;

  while (index < encoded.length) {
    const latitudeDelta = decodeValue(encoded, index);
    index = latitudeDelta.nextIndex;
    const longitudeDelta = decodeValue(encoded, index);
    index = longitudeDelta.nextIndex;
    latitude += latitudeDelta.value;
    longitude += longitudeDelta.value;
    coordinates.push({
      lat: latitude / 1e5,
      lon: longitude / 1e5
    });
  }

  return coordinates;
}

function decodeValue(encoded: string, startIndex: number) {
  let result = 0;
  let shift = 0;
  let index = startIndex;
  let byte = 0;

  do {
    if (index >= encoded.length) {
      throw new Error("Invalid encoded polyline.");
    }
    byte = encoded.charCodeAt(index) - 63;
    index += 1;
    result |= (byte & 0x1f) << shift;
    shift += 5;
  } while (byte >= 0x20);

  return {
    value: result & 1 ? ~(result >> 1) : result >> 1,
    nextIndex: index
  };
}

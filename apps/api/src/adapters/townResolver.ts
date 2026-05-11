import { taipeiDistrictBoundaries, type DistrictBoundary, type DistrictPolygon, type Position } from "../data/taipeiDistrictBoundaries.js";

const taipeiCountyName = "臺北市";

export function resolveTownFromCoordinate(county: string, lat: number, lon: number): string {
  if (county !== taipeiCountyName) {
    return "";
  }

  return findDistrict(taipeiDistrictBoundaries, lat, lon);
}

function findDistrict(boundaries: DistrictBoundary[], lat: number, lon: number): string {
  const point: Position = [lon, lat];

  for (const boundary of boundaries) {
    if (boundary.polygons.some((polygon) => pointInPolygon(point, polygon))) {
      return boundary.name;
    }
  }

  return "";
}

function pointInPolygon(point: Position, polygon: DistrictPolygon): boolean {
  const [outerRing, ...holes] = polygon;
  if (!outerRing || !pointInRing(point, outerRing)) {
    return false;
  }

  return !holes.some((ring) => pointInRing(point, ring));
}

function pointInRing(point: Position, ring: Position[]): boolean {
  const [x, y] = point;
  let inside = false;

  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [currentX, currentY] = ring[index];
    const [previousX, previousY] = ring[previous];

    if (pointOnSegment(x, y, previousX, previousY, currentX, currentY)) {
      return true;
    }

    const crosses = currentY > y !== previousY > y;
    if (!crosses) continue;

    const intersectionX = ((previousX - currentX) * (y - currentY)) / (previousY - currentY) + currentX;
    if (x < intersectionX) {
      inside = !inside;
    }
  }

  return inside;
}

function pointOnSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): boolean {
  const cross = (px - ax) * (by - ay) - (py - ay) * (bx - ax);
  if (Math.abs(cross) > 1e-10) {
    return false;
  }

  const dot = (px - ax) * (px - bx) + (py - ay) * (py - by);
  return dot <= 1e-10;
}

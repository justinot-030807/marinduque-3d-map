/**
 * Web Mercator projection utilities matching scripts/fetch_terrain.py.
 * Converts WGS84 (lat, lon) coordinates to normalized heightmap UV [0..1]
 * and 3D world (x, z) coordinates on the terrain plane.
 */

export const WORLD_SIZE = 100;

/**
 * Convert geographic (lat, lon) in degrees to normalized Web Mercator [0..1].
 * x: 0 at -180 lon -> 1 at +180 lon
 * y: 0 at north pole (~85.0511N) -> 1 at south pole (~-85.0511S)
 */
export function latLonToMercator(lat, lon) {
  const mx = (lon + 180.0) / 360.0;
  const latRad = (lat * Math.PI) / 180.0;
  const my = (1.0 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2.0;
  return { mx, my };
}

/**
 * Convert (lat, lon) to normalized image UV within the heightmap [0..1].
 * u: 0 = west edge, 1 = east edge
 * v: 0 = north edge (top of PNG), 1 = south edge (bottom of PNG)
 */
export function latLonToHeightmapUV(lat, lon, mercatorBounds) {
  const { mx, my } = latLonToMercator(lat, lon);
  const u = (mx - mercatorBounds.xMin) / (mercatorBounds.xMax - mercatorBounds.xMin);
  const v = (my - mercatorBounds.yMin) / (mercatorBounds.yMax - mercatorBounds.yMin);
  return { u, v };
}

/**
 * Convert (lat, lon) to 3D world (x, z) coordinates where:
 * +x = East, -x = West, -z = North, +z = South.
 */
export function latLonToWorldXZ(lat, lon, mercatorBounds, worldSize = WORLD_SIZE) {
  const { u, v } = latLonToHeightmapUV(lat, lon, mercatorBounds);
  return {
    x: (u - 0.5) * worldSize,
    z: (v - 0.5) * worldSize,
    u,
    v,
  };
}

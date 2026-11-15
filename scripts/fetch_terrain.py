#!/usr/bin/env python3
"""
Download and stitch AWS Terrain Tiles (Terrarium PNG) for Marinduque, Philippines
and surrounding islets into a 16-bit grayscale heightmap PNG in /public.

Terrarium decoding formula:
  elevation_meters = (R * 256 + G + B / 256) - 32768

Values below 0 m are clamped to 0 m (sea level).
Also writes /public/marinduque-terrain.json with exact Web Mercator bounds
so client code can convert (lat, lon) <-> terrain (u, v) accurately.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import math
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

TILE_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"

# Zoom-12 tile grid covering all of Marinduque Island + nearby islets
# (Tres Reyes, Elefante, Polo/Santa Cruz, Maniwaya, Mompong, San Andres)
# while excluding mainland Bondoc Peninsula (which sits in tile row 1891).
DEFAULT_ZOOM = 12
TILE_X_MIN = 3433
TILE_X_MAX = 3438
TILE_Y_MIN = 1892
TILE_Y_MAX = 1896

# Square Web Mercator crop within the stitched 1536x1280 tile grid (6x5 tiles).
# Centers horizontally on Marinduque + islets with open-sea margins on all sides.
CROP_X = 138
CROP_Y = 0
CROP_SIZE = 1280

EARTH_RADIUS_M = 6378137.0
EARTH_CIRCUMFERENCE_M = 2.0 * math.pi * EARTH_RADIUS_M


def mercator_xy_to_latlon(mx: float, my: float) -> tuple[float, float]:
    """Convert normalized Web Mercator [0..1] coordinates to (lat, lon) in degrees."""
    lon = mx * 360.0 - 180.0
    lat = math.degrees(math.atan(math.sinh(math.pi * (1.0 - 2.0 * my))))
    return lat, lon


def download_tile(z: int, x: int, y: int, cache_dir: Path) -> Path:
    """Download a single Terrarium PNG tile with local file caching."""
    cache_path = cache_dir / f"{z}_{x}_{y}.png"
    if cache_path.exists() and cache_path.stat().st_size > 0:
        return cache_path

    url = TILE_URL.format(z=z, x=x, y=y)
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "marinduque-3d-map/1.0 (+https://registry.opendata.aws/terrain-tiles/)"},
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = resp.read()
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Failed to download {url}: {exc}") from exc

    cache_path.write_bytes(data)
    return cache_path


def decode_terrarium_tile(tile_path: Path) -> np.ndarray:
    """Decode a Terrarium RGB PNG into float32 elevation meters."""
    with Image.open(tile_path) as img:
        arr = np.asarray(img.convert("RGB"), dtype=np.float32)
    return (arr[..., 0] * 256.0 + arr[..., 1] + arr[..., 2] / 256.0) - 32768.0


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch & stitch Marinduque AWS Terrarium heightmap.")
    parser.add_argument("--size", type=int, default=1024, help="Output square PNG resolution (default: 1024)")
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "public",
        help="Output directory (default: ./public)",
    )
    parser.add_argument(
        "--cache-dir",
        type=Path,
        default=Path(__file__).resolve().parent.parent / ".cache" / "terrarium",
        help="Tile cache directory",
    )
    args = parser.parse_args()

    z = DEFAULT_ZOOM
    tile_size = 256
    xs = list(range(TILE_X_MIN, TILE_X_MAX + 1))
    ys = list(range(TILE_Y_MIN, TILE_Y_MAX + 1))

    args.cache_dir.mkdir(parents=True, exist_ok=True)
    args.out_dir.mkdir(parents=True, exist_ok=True)

    tasks = [(x, y) for y in ys for x in xs]
    print(f"Fetching {len(tasks)} AWS Terrarium tiles at zoom {z}...")

    tile_paths: dict[tuple[int, int], Path] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        future_map = {
            pool.submit(download_tile, z, x, y, args.cache_dir): (x, y)
            for x, y in tasks
        }
        for fut in concurrent.futures.as_completed(future_map):
            xy = future_map[fut]
            tile_paths[xy] = fut.result()

    stitched_w = len(xs) * tile_size
    stitched_h = len(ys) * tile_size
    stitched = np.zeros((stitched_h, stitched_w), dtype=np.float32)

    for iy, y in enumerate(ys):
        for ix, x in enumerate(xs):
            elev = decode_terrarium_tile(tile_paths[(x, y)])
            stitched[
                iy * tile_size : (iy + 1) * tile_size,
                ix * tile_size : (ix + 1) * tile_size,
            ] = elev

    # Crop exact square Web Mercator region and clamp negative values to 0 m.
    cropped = stitched[CROP_Y : CROP_Y + CROP_SIZE, CROP_X : CROP_X + CROP_SIZE]
    cropped = np.maximum(cropped, 0.0)

    # Resample smoothly to target square heightmap resolution.
    if args.size != CROP_SIZE:
        elev_img = Image.fromarray(cropped, mode="F")
        resized_img = elev_img.resize((args.size, args.size), Image.Resampling.BILINEAR)
        height_m = np.maximum(np.asarray(resized_img, dtype=np.float32), 0.0)
    else:
        height_m = cropped

    max_elev_m = float(height_m.max())
    if max_elev_m <= 0.0:
        raise RuntimeError("Decoded elevation grid has no positive land elevations.")

    # Encode as 16-bit grayscale PNG for sub-decimeter vertical precision without stair-stepping.
    scaled_u16 = np.clip(np.round((height_m / max_elev_m) * 65535.0), 0, 65535).astype(np.uint16)
    png_path = args.out_dir / "marinduque-heightmap.png"
    Image.fromarray(scaled_u16, mode="I;16").save(png_path, optimize=True)

    # Exact normalized Web Mercator [0..1] bounds of the cropped area.
    world_px = (1 << z) * tile_size
    world_px_min = TILE_X_MIN * tile_size + CROP_X
    world_px_max = world_px_min + CROP_SIZE
    world_py_min = TILE_Y_MIN * tile_size + CROP_Y
    world_py_max = world_py_min + CROP_SIZE

    mx_min = world_px_min / world_px
    mx_max = world_px_max / world_px
    my_min = world_py_min / world_px
    my_max = world_py_max / world_px

    north, west = mercator_xy_to_latlon(mx_min, my_min)
    south, east = mercator_xy_to_latlon(mx_max, my_max)
    center_lat, center_lon = mercator_xy_to_latlon((mx_min + mx_max) * 0.5, (my_min + my_max) * 0.5)

    # Ground scale at center latitude (Web Mercator scale factor = 1 / cos(lat)).
    cos_lat = math.cos(math.radians(center_lat))
    ground_width_m = (mx_max - mx_min) * EARTH_CIRCUMFERENCE_M * cos_lat
    ground_height_m = (my_max - my_min) * EARTH_CIRCUMFERENCE_M * cos_lat

    metadata = {
        "source": "AWS Open Data Terrain Tiles (Mapzen Terrarium)",
        "tileUrlTemplate": TILE_URL,
        "zoom": z,
        "tileSize": tile_size,
        "tiles": {
            "xMin": TILE_X_MIN,
            "xMax": TILE_X_MAX,
            "yMin": TILE_Y_MIN,
            "yMax": TILE_Y_MAX,
        },
        "cropInStitched": {
            "x": CROP_X,
            "y": CROP_Y,
            "width": CROP_SIZE,
            "height": CROP_SIZE,
        },
        "outputSize": {
            "width": args.size,
            "height": args.size,
        },
        "encoding": {
            "format": "png-uint16-gray",
            "minMeters": 0.0,
            "maxMeters": round(max_elev_m, 3),
        },
        "mercatorBounds": {
            "xMin": mx_min,
            "xMax": mx_max,
            "yMin": my_min,
            "yMax": my_max,
        },
        "geoBounds": {
            "north": round(north, 6),
            "south": round(south, 6),
            "west": round(west, 6),
            "east": round(east, 6),
            "centerLat": round(center_lat, 6),
            "centerLon": round(center_lon, 6),
        },
        "groundDimensionsMeters": {
            "width": round(ground_width_m, 1),
            "height": round(ground_height_m, 1),
        },
    }

    meta_path = args.out_dir / "marinduque-terrain.json"
    meta_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")

    print(f"Wrote {png_path} ({png_path.stat().st_size / 1024:.1f} KB, {args.size}x{args.size} uint16)")
    print(f"Wrote {meta_path}")
    print(
        f"Bounds: N={north:.4f}, S={south:.4f}, W={west:.4f}, E={east:.4f} | "
        f"Center: ({center_lat:.4f}, {center_lon:.4f}) | "
        f"Max elev: {max_elev_m:.2f} m | Ground: {ground_width_m/1000:.2f} x {ground_height_m/1000:.2f} km"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

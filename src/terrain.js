import * as THREE from 'three';
import { decode } from 'fast-png';
import { WORLD_SIZE, latLonToHeightmapUV, latLonToWorldXZ } from './geo.js';

const MESH_SEGMENTS = 512;
const SHORELINE_ELEV_M = 0.55;
const SEABED_DEPTH_UNITS = -0.45;

// Elevation color stops (RGB 0..255) tuned to Marinduque's actual topography (0..1173 m)
const COLOR_SEABED = [28, 72, 96];
const COLOR_SHALLOW = [184, 178, 138];
const COLOR_SAND = [232, 217, 170];
const COLOR_COAST_GRASS = [124, 176, 84];
const COLOR_GREEN = [74, 154, 62];
const COLOR_DARK_GREEN = [30, 88, 46];
const COLOR_HIGH_FOREST = [24, 66, 40];
const COLOR_ROCK_DARK = [96, 98, 88];
const COLOR_ROCK_PEAK = [148, 142, 132];

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function lerpRGB(c1, c2, t) {
  const k = Math.max(0, Math.min(1, t));
  return [
    lerp(c1[0], c2[0], k),
    lerp(c1[1], c2[1], k),
    lerp(c1[2], c2[2], k),
  ];
}

function elevationToColor(elevM, slope) {
  if (elevM <= 0.25) {
    const t = smoothstep(0.0, 0.25, elevM);
    return lerpRGB(COLOR_SEABED, COLOR_SHALLOW, t);
  }
  if (elevM < SHORELINE_ELEV_M) {
    const t = smoothstep(0.25, SHORELINE_ELEV_M, elevM);
    return lerpRGB(COLOR_SHALLOW, COLOR_SAND, t);
  }

  let rgb;
  if (elevM < 9.0) {
    const t = smoothstep(SHORELINE_ELEV_M, 9.0, elevM);
    rgb = lerpRGB(COLOR_SAND, COLOR_COAST_GRASS, t);
  } else if (elevM < 95.0) {
    const t = smoothstep(9.0, 95.0, elevM);
    rgb = lerpRGB(COLOR_COAST_GRASS, COLOR_GREEN, t);
  } else if (elevM < 280.0) {
    const t = smoothstep(95.0, 280.0, elevM);
    rgb = lerpRGB(COLOR_GREEN, COLOR_DARK_GREEN, t);
  } else if (elevM < 520.0) {
    const t = smoothstep(280.0, 520.0, elevM);
    rgb = lerpRGB(COLOR_DARK_GREEN, COLOR_HIGH_FOREST, t);
  } else if (elevM < 760.0) {
    const t = smoothstep(520.0, 760.0, elevM);
    rgb = lerpRGB(COLOR_HIGH_FOREST, COLOR_ROCK_DARK, t);
  } else {
    const t = smoothstep(760.0, 1140.0, elevM);
    rgb = lerpRGB(COLOR_ROCK_DARK, COLOR_ROCK_PEAK, t);
  }

  // Expose volcanic rock slightly on steep mountain slopes above 120 m
  if (elevM > 120.0) {
    const altMask = smoothstep(120.0, 380.0, elevM);
    const slopeMask = smoothstep(0.45, 1.15, slope) * 0.55 * altMask;
    rgb = lerpRGB(rgb, COLOR_ROCK_DARK, slopeMask);
  }

  return rgb;
}

/**
 * Load heightmap PNG + metadata JSON and build the 3D displaced terrain mesh.
 */
export async function createTerrain(onProgress) {
  onProgress?.('Loading elevation metadata...');
  const [metaRes, pngRes] = await Promise.all([
    fetch('./marinduque-terrain.json'),
    fetch('./marinduque-heightmap.png'),
  ]);

  if (!metaRes.ok || !pngRes.ok) {
    throw new Error('Failed to load terrain assets from /public.');
  }

  const metadata = await metaRes.json();
  onProgress?.('Decoding 16-bit elevation tiles...');
  const pngBuffer = await pngRes.arrayBuffer();
  const decoded = decode(new Uint8Array(pngBuffer));

  const { width, height, data, depth } = decoded;
  const maxVal = depth === 16 ? 65535.0 : 255.0;
  const maxMeters = metadata.encoding.maxMeters;

  // Convert PNG pixel buffer to float32 elevation in meters (row 0 = North, row H-1 = South)
  const elevMeters = new Float32Array(width * height);
  const channels = decoded.channels || 1;
  for (let i = 0; i < width * height; i++) {
    const norm = data[i * channels] / maxVal;
    elevMeters[i] = Math.max(0, norm * maxMeters);
  }

  // 1:1 physical ground-to-height ratio (world units per real meter)
  const baseYPerMeter = WORLD_SIZE / metadata.groundDimensionsMeters.width;

  function sampleElevationAtUV(u, v) {
    const cu = Math.max(0, Math.min(1, u));
    const cv = Math.max(0, Math.min(1, v));
    const fx = cu * (width - 1);
    const fy = cv * (height - 1);
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const x1 = Math.min(width - 1, x0 + 1);
    const y1 = Math.min(height - 1, y0 + 1);
    const tx = fx - x0;
    const ty = fy - y0;

    const e00 = elevMeters[y0 * width + x0];
    const e10 = elevMeters[y0 * width + x1];
    const e01 = elevMeters[y1 * width + x0];
    const e11 = elevMeters[y1 * width + x1];

    const top = e00 + (e10 - e00) * tx;
    const bot = e01 + (e11 - e01) * tx;
    return top + (bot - top) * ty;
  }

  function elevationToBaseY(elevM) {
    if (elevM >= SHORELINE_ELEV_M) {
      return (elevM - SHORELINE_ELEV_M) * baseYPerMeter;
    }
    // Smoothly transition coastal shelf below sea level (y = 0) so ocean ringing never z-fights
    const t = smoothstep(0.0, SHORELINE_ELEV_M, elevM);
    return SEABED_DEPTH_UNITS * (1.0 - t);
  }

  // Build displaced ~512x512 mesh
  onProgress?.('Building 3D terrain mesh...');
  const geometry = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, MESH_SEGMENTS, MESH_SEGMENTS);
  geometry.rotateX(-Math.PI / 2);

  const posAttr = geometry.attributes.position;
  const uvAttr = geometry.attributes.uv;
  for (let i = 0; i < posAttr.count; i++) {
    const u = uvAttr.getX(i);
    // PlaneGeometry uv.y = 1 at North (-Z), 0 at South (+Z), while image v = 0 at North
    const vImg = 1.0 - uvAttr.getY(i);
    const elevM = sampleElevationAtUV(u, vImg);
    posAttr.setY(i, elevationToBaseY(elevM));
  }
  geometry.computeVertexNormals();

  // Build 1024x1024 Albedo + Tangent-Space Normal + Coastal Shelf textures
  onProgress?.('Shading elevation bands & coastal relief...');
  const metersPerPixel = metadata.groundDimensionsMeters.width / width;
  const albedoData = new Uint8Array(width * height * 4);
  const normalData = new Uint8Array(width * height * 4);
  const shoreMask = new Float32Array(width * height);

  for (let py = 0; py < height; py++) {
    const pyUp = Math.max(0, py - 1);
    const pyDn = Math.min(height - 1, py + 1);
    // DataTexture uses flipY = false, so uv.y = 1 (North, py=0) maps to texture row height-1
    const texRow = height - 1 - py;

    for (let px = 0; px < width; px++) {
      const pxL = Math.max(0, px - 1);
      const pxR = Math.min(width - 1, px + 1);

      const idx = py * width + px;
      const eC = elevMeters[idx];
      const eL = elevMeters[py * width + pxL];
      const eR = elevMeters[py * width + pxR];
      const eU = elevMeters[pyUp * width + px];
      const eD = elevMeters[pyDn * width + px];

      const dhdx = (eR - eL) / (2.0 * metersPerPixel);
      const dhdz = (eD - eU) / (2.0 * metersPerPixel);
      const slope = Math.hypot(dhdx, dhdz);

      // Albedo RGB
      const [r, g, b] = elevationToColor(eC, slope);
      const outIdx = (texRow * width + px) * 4;
      albedoData[outIdx] = Math.round(r);
      albedoData[outIdx + 1] = Math.round(g);
      albedoData[outIdx + 2] = Math.round(b);
      albedoData[outIdx + 3] = 255;

      // Tangent-space normal: +U = +X (East), +V = -Z (North = -py)
      const nx = -dhdx;
      const ny = dhdz; // -(eU - eD) / (2 * step)
      const nz = 1.0;
      const invLen = 1.0 / Math.hypot(nx, ny, nz);

      normalData[outIdx] = Math.round((nx * invLen * 0.5 + 0.5) * 255);
      normalData[outIdx + 1] = Math.round((ny * invLen * 0.5 + 0.5) * 255);
      normalData[outIdx + 2] = Math.round((nz * invLen * 0.5 + 0.5) * 255);
      normalData[outIdx + 3] = 255;

      // Seed shoreline proximity mask strictly from land above shoreline to avoid Terrarium ocean ringing
      shoreMask[texRow * width + px] = eC > SHORELINE_ELEV_M ? 1.0 : 0.0;
    }
  }

  // Blur coastal mask into a smooth shallow-reef distance glow for the water shader
  const shoreGlow = buildCoastalGlowTexture(shoreMask, width, height, 18);

  const albedoTexture = new THREE.DataTexture(albedoData, width, height, THREE.RGBAFormat);
  albedoTexture.colorSpace = THREE.SRGBColorSpace;
  albedoTexture.magFilter = THREE.LinearFilter;
  albedoTexture.minFilter = THREE.LinearMipmapLinearFilter;
  albedoTexture.generateMipmaps = true;
  albedoTexture.needsUpdate = true;

  const normalTexture = new THREE.DataTexture(normalData, width, height, THREE.RGBAFormat);
  normalTexture.magFilter = THREE.LinearFilter;
  normalTexture.minFilter = THREE.LinearMipmapLinearFilter;
  normalTexture.generateMipmaps = true;
  normalTexture.needsUpdate = true;

  const material = new THREE.MeshStandardMaterial({
    map: albedoTexture,
    normalMap: normalTexture,
    normalScale: new THREE.Vector2(1.0, 1.0),
    roughness: 0.86,
    metalness: 0.02,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'MarinduqueTerrain';
  mesh.receiveShadow = true;
  mesh.castShadow = true;

  let currentExaggeration = 2.6;
  function setExaggeration(value) {
    currentExaggeration = value;
    mesh.scale.y = value;
    // Scale micro-ridge normal detail gently alongside vertical exaggeration
    const nScale = 0.75 + (value - 1.0) * 0.35;
    material.normalScale.set(nScale, nScale);
  }
  setExaggeration(currentExaggeration);

  function getAnchorAtLatLon(lat, lon) {
    const { u, v } = latLonToHeightmapUV(lat, lon, metadata.mercatorBounds);
    const elevM = sampleElevationAtUV(u, v);
    const baseY = elevationToBaseY(elevM);
    const { x, z } = latLonToWorldXZ(lat, lon, metadata.mercatorBounds, WORLD_SIZE);
    return {
      x,
      z,
      u,
      v,
      baseY,
      elevMeters: elevM,
    };
  }

  function getSurfaceYAtLatLon(lat, lon) {
    const anchor = getAnchorAtLatLon(lat, lon);
    return {
      ...anchor,
      worldY: Math.max(0, anchor.baseY * currentExaggeration),
    };
  }

  function getExaggeration() {
    return currentExaggeration;
  }

  return {
    mesh,
    metadata,
    shoreGlowTexture: shoreGlow,
    setExaggeration,
    getExaggeration,
    sampleElevationAtUV,
    getAnchorAtLatLon,
    getSurfaceYAtLatLon,
  };
}

/**
 * Separable box/exponential blur downsampled to 256x256 for smooth shallow-water turquoise glow.
 */
function buildCoastalGlowTexture(mask, srcW, srcH, radiusPx) {
  const dstSize = 256;
  const small = new Float32Array(dstSize * dstSize);
  const stepX = srcW / dstSize;
  const stepY = srcH / dstSize;

  for (let y = 0; y < dstSize; y++) {
    const sy = Math.min(srcH - 1, Math.floor(y * stepY));
    for (let x = 0; x < dstSize; x++) {
      const sx = Math.min(srcW - 1, Math.floor(x * stepX));
      small[y * dstSize + x] = mask[sy * srcW + sx];
    }
  }

  // Two-pass separable box blur for smooth distance falloff
  const r = Math.max(2, Math.round((radiusPx * dstSize) / srcW));
  const tmp = new Float32Array(dstSize * dstSize);
  const out = new Float32Array(dstSize * dstSize);

  for (let pass = 0; pass < 2; pass++) {
    const src = pass === 0 ? small : out;
    // Horizontal
    for (let y = 0; y < dstSize; y++) {
      for (let x = 0; x < dstSize; x++) {
        let sum = 0;
        let count = 0;
        const x0 = Math.max(0, x - r);
        const x1 = Math.min(dstSize - 1, x + r);
        for (let k = x0; k <= x1; k++) {
          sum += src[y * dstSize + k];
          count++;
        }
        tmp[y * dstSize + x] = sum / count;
      }
    }
    // Vertical
    for (let x = 0; x < dstSize; x++) {
      for (let y = 0; y < dstSize; y++) {
        let sum = 0;
        let count = 0;
        const y0 = Math.max(0, y - r);
        const y1 = Math.min(dstSize - 1, y + r);
        for (let k = y0; k <= y1; k++) {
          sum += tmp[k * dstSize + x];
          count++;
        }
        out[y * dstSize + x] = Math.max(small[y * dstSize + x], sum / count);
      }
    }
  }

  const rgba = new Uint8Array(dstSize * dstSize * 4);
  for (let i = 0; i < dstSize * dstSize; i++) {
    const val = Math.round(Math.max(0, Math.min(1, out[i])) * 255);
    rgba[i * 4] = val;
    rgba[i * 4 + 1] = val;
    rgba[i * 4 + 2] = val;
    rgba[i * 4 + 3] = 255;
  }

  const tex = new THREE.DataTexture(rgba, dstSize, dstSize, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

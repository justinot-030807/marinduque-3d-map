import * as THREE from 'three';
import { WORLD_SIZE } from './geo.js';

const SEA_SIZE = 520;

const vertexShader = /* glsl */ `
  varying vec3 vWorldPos;

  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPosition.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform vec3 uSunDir;
  uniform vec3 uSkyColor;
  uniform vec3 uHorizonColor;
  uniform sampler2D uShoreGlow;
  uniform float uWorldSize;

  varying vec3 vWorldPos;

  // Lightweight organic wave height with mild domain warping (avoids linear striping)
  float waveHeight(vec2 p, float t) {
    float warp = sin(p.x * 0.17 - p.y * 0.19 + t * 0.45) * 0.6;
    float w1 = sin(p.x * 0.37 + p.y * 0.24 + warp + t * 1.05) * 0.34;
    float w2 = sin(p.x * -0.29 + p.y * 0.47 - warp * 0.7 - t * 0.82) * 0.28;
    float w3 = cos(p.x * 0.79 - p.y * 0.63 + t * 1.35) * 0.14;
    float w4 = sin((p.x * 1.15 - p.y * 0.95) + t * 1.65) * 0.07;
    return w1 + w2 + w3 + w4;
  }

  vec3 computeWaterNormal(vec2 p, float t, float distFromCenter) {
    float eps = 0.22;
    float hC = waveHeight(p, t);
    float hX = waveHeight(p + vec2(eps, 0.0), t);
    float hZ = waveHeight(p + vec2(0.0, eps), t);
    // Fade normal amplitude smoothly with distance to prevent grazing-angle moire banding
    float distFade = 1.0 / (1.0 + distFromCenter * 0.016);
    float strength = 0.075 * distFade;
    return normalize(vec3((hC - hX) * strength / eps, 1.0, (hC - hZ) * strength / eps));
  }

  void main() {
    vec2 xz = vWorldPos.xz;
    vec2 shoreUV = vec2(
      xz.x / uWorldSize + 0.5,
      0.5 - xz.y / uWorldSize
    );

    // Sample shore proximity only inside the terrain bounding square with soft edge fade
    float inBounds =
      smoothstep(0.0, 0.04, shoreUV.x) *
      smoothstep(1.0, 0.96, shoreUV.x) *
      smoothstep(0.0, 0.04, shoreUV.y) *
      smoothstep(1.0, 0.96, shoreUV.y);

    float shore = texture2D(uShoreGlow, clamp(shoreUV, 0.0, 1.0)).r * inBounds;
    float distFromCenter = length(xz);

    vec3 N = computeWaterNormal(xz, uTime, distFromCenter);
    vec3 V = normalize(cameraPosition - vWorldPos);
    vec3 L = normalize(uSunDir);

    // Fresnel term (Schlick)
    float NdotV = max(dot(N, V), 0.001);
    float fresnel = pow(1.0 - NdotV, 4.0);
    fresnel = clamp(0.05 + 0.72 * fresnel, 0.0, 0.80);

    // Tropical sea palette (linear RGB): deep sapphire open ocean -> turquoise shallow reef near shore
    vec3 deepSea = vec3(0.006, 0.042, 0.115);
    vec3 midSea = vec3(0.012, 0.095, 0.215);
    vec3 shallowLagoon = vec3(0.022, 0.345, 0.385);

    // Distance-based deep tint + coastal reef tint
    float centerDepthMask = smoothstep(55.0, 14.0, distFromCenter);
    vec3 waterBase = mix(deepSea, midSea, 0.35 + 0.45 * centerDepthMask);
    waterBase = mix(waterBase, shallowLagoon, smoothstep(0.22, 0.88, shore) * 0.90);

    // Soft animated shoreline foam ripple near beaches
    float ripplePhase = sin(shore * 34.0 - uTime * 2.1 + waveHeight(xz * 0.6, uTime) * 2.5);
    float foamBand = smoothstep(0.60, 0.94, shore) * smoothstep(0.35, 0.95, ripplePhase);
    vec3 foamColor = vec3(0.75, 0.92, 0.94);
    waterBase = mix(waterBase, foamColor, foamBand * 0.42);

    // Subtle sky reflection & crisp tropical sun shimmer
    vec3 R = reflect(-V, N);
    float skyGrad = smoothstep(0.0, 0.6, max(R.y, 0.0));
    vec3 envColor = mix(uHorizonColor, uSkyColor, skyGrad);

    vec3 H = normalize(L + V);
    float spec = pow(max(dot(N, H), 0.0), 110.0) * 0.55;
    float broadGlint = pow(max(dot(N, H), 0.0), 18.0) * 0.08;
    vec3 sunColor = vec3(1.0, 0.94, 0.82);

    vec3 color = mix(waterBase, envColor, fresnel * 0.58) + sunColor * (spec + broadGlint);

    // Blend seamlessly into horizon fog at far distance so sea meets sky naturally
    float horizonFog = smoothstep(105.0, 240.0, distFromCenter);
    color = mix(color, uHorizonColor, horizonFog);

    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * Create the flat animated tropical sea plane at y = 0.
 */
export function createWater({ shoreGlowTexture, sunDirection, skyColor, horizonColor }) {
  const geometry = new THREE.PlaneGeometry(SEA_SIZE, SEA_SIZE, 1, 1);
  geometry.rotateX(-Math.PI / 2);

  const uniforms = {
    uTime: { value: 0 },
    uSunDir: { value: sunDirection.clone().normalize() },
    uSkyColor: { value: skyColor.clone() },
    uHorizonColor: { value: horizonColor.clone() },
    uShoreGlow: { value: shoreGlowTexture },
    uWorldSize: { value: WORLD_SIZE },
  };

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
    transparent: false,
    depthWrite: true,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'MarinduqueSea';
  mesh.position.y = 0;

  function update(elapsedSeconds) {
    uniforms.uTime.value = elapsedSeconds;
  }

  return { mesh, update };
}

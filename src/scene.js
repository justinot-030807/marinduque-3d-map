import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import gsap from 'gsap';

const SKY_TOP = new THREE.Color(0x7ac3e8);
const SKY_HORIZON = new THREE.Color(0xd5eef8);
const SUN_DIRECTION = new THREE.Vector3(68, 62, 46);

const PAN_LIMIT_XZ = 49;
const PAN_LIMIT_Y = 14;

export function createSceneController(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = SKY_HORIZON.clone();
  scene.fog = new THREE.FogExp2(SKY_HORIZON.getHex(), 0.0021);

  // Subtle sky dome gradient from horizon mist to tropical azure zenith
  const skyGeo = new THREE.SphereGeometry(280, 24, 14);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTopColor: { value: SKY_TOP },
      uHorizonColor: { value: SKY_HORIZON },
    },
    vertexShader: /* glsl */ `
      varying float vHeight;
      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vHeight = normalize(worldPos.xyz).y;
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uTopColor;
      uniform vec3 uHorizonColor;
      varying float vHeight;
      void main() {
        float t = smoothstep(0.0, 0.52, max(vHeight, 0.0));
        gl_FragColor = vec4(mix(uHorizonColor, uTopColor, t), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const skyDome = new THREE.Mesh(skyGeo, skyMat);
  scene.add(skyDome);

  // Lighting: tropical daylight sun + ocean/sky hemisphere + gentle NW rim fill
  const hemiLight = new THREE.HemisphereLight(0xd4efff, 0x164e63, 0.92);
  scene.add(hemiLight);

  const sunLight = new THREE.DirectionalLight(0xfff4df, 2.3);
  sunLight.position.copy(SUN_DIRECTION);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(1024, 1024);
  sunLight.shadow.camera.near = 15;
  sunLight.shadow.camera.far = 210;
  const shadowExtent = 56;
  sunLight.shadow.camera.left = -shadowExtent;
  sunLight.shadow.camera.right = shadowExtent;
  sunLight.shadow.camera.top = shadowExtent;
  sunLight.shadow.camera.bottom = -shadowExtent;
  sunLight.shadow.bias = -0.0005;
  sunLight.shadow.normalBias = 0.03;
  scene.add(sunLight);

  const fillLight = new THREE.DirectionalLight(0x8ecae6, 0.45);
  fillLight.position.set(-65, 32, -55);
  scene.add(fillLight);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.5, 600);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.enablePan = true;
  controls.screenSpacePanning = false;
  controls.rotateSpeed = 0.72;
  controls.zoomSpeed = 0.85;
  controls.panSpeed = 0.75;
  controls.touches = {
    ONE: THREE.TOUCH.ROTATE,
    TWO: THREE.TOUCH.DOLLY_PAN,
  };
  // Limit tilt & zoom so camera never clips underwater or loses the island
  controls.minPolarAngle = 0.16;
  controls.maxPolarAngle = Math.PI * 0.43;
  controls.minDistance = 16;
  controls.maxDistance = 320;

  function getHeroFraming() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = Math.max(1, canvas.clientHeight || window.innerHeight);
    const aspect = w / h;
    const isPortrait = aspect < 1.0;
    const fovRad = THREE.MathUtils.degToRad(isPortrait ? 56 : 45);
    // Account for foreground perspective of SW/SE coasts & islets
    const baseVector = isPortrait
      ? new THREE.Vector3(-8, 108, 92)
      : new THREE.Vector3(-15, 76, 94);
    const baseDist = baseVector.length();
    const targetSpan = isPortrait ? 124 : 104;
    const minDistForWidth = targetSpan / (2 * Math.tan(fovRad / 2) * Math.max(aspect, 0.36));
    const scale = Math.max(1.0, minDistForWidth / baseDist);

    return {
      position: baseVector.multiplyScalar(scale),
      target: isPortrait ? new THREE.Vector3(-4.5, 0.5, 3) : new THREE.Vector3(-3, 0.5, 5.5),
    };
  }

  function updateSize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = Math.max(1, canvas.clientHeight || window.innerHeight);
    const aspect = w / h;

    camera.fov = aspect < 1.0 ? 56 : 45;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    controls.maxDistance = aspect < 1.0 ? 320 : 175;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
  }

  const initial = getHeroFraming();
  camera.position.copy(initial.position);
  controls.target.copy(initial.target);
  updateSize();
  controls.update();

  window.addEventListener('resize', updateSize);

  // Track user interactions & cancel active camera tweens gracefully
  let activeTween = null;
  const userInteractCallbacks = [];

  function cancelCameraTween() {
    if (activeTween) {
      activeTween.kill();
      activeTween = null;
    }
  }

  function onUserInteract(cb) {
    userInteractCallbacks.push(cb);
  }

  controls.addEventListener('start', () => {
    cancelCameraTween();
    for (const cb of userInteractCallbacks) {
      cb();
    }
  });

  function animateCameraTo(destPosition, destTarget, { duration = 1.2, ease = 'power3.inOut', onComplete } = {}) {
    cancelCameraTween();
    activeTween = gsap.timeline({
      defaults: { duration, ease },
      onComplete: () => {
        activeTween = null;
        onComplete?.();
      },
    });
    activeTween.to(
      camera.position,
      {
        x: destPosition.x,
        y: destPosition.y,
        z: destPosition.z,
      },
      0,
    );
    activeTween.to(
      controls.target,
      {
        x: destTarget.x,
        y: destTarget.y,
        z: destTarget.z,
      },
      0,
    );
    return activeTween;
  }

  function resetView(duration = 1.15) {
    const hero = getHeroFraming();
    animateCameraTo(hero.position, hero.target, { duration, ease: 'power3.inOut' });
  }

  /**
   * Scenic opening sweep from high southeast maritime horizon to hero view.
   */
  function playIntroSweep() {
    const hero = getHeroFraming();
    const introStart = hero.position
      .clone()
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.72)
      .multiplyScalar(1.18);
    introStart.y = Math.max(introStart.y, hero.position.y * 1.15);

    const introTarget = hero.target.clone().add(new THREE.Vector3(6, 0, -4));
    camera.position.copy(introStart);
    controls.target.copy(introTarget);
    controls.update();

    animateCameraTo(hero.position, hero.target, {
      duration: 2.1,
      ease: 'power2.out',
    });
  }

  /**
   * Fly camera smoothly to highlight a spot world position,
   * automatically framing it clear of desktop side panel or mobile bottom sheet.
   */
  function flyTo(worldPos, options = {}) {
    const w = canvas.clientWidth || window.innerWidth;
    const h = Math.max(1, canvas.clientHeight || window.innerHeight);
    const isDesktop = w >= 768 && w >= h;

    const {
      distance = isDesktop ? 32 : 38,
      polarAngle = isDesktop ? 0.92 : 0.86,
      duration = 1.25,
      panelBias = true,
      onComplete,
    } = options;

    const spotTarget = new THREE.Vector3(worldPos.x, Math.max(0.2, worldPos.y), worldPos.z);

    // Choose a dramatic sun-kissed azimuth looking inward from nearby coast
    const radialLen = Math.hypot(spotTarget.x, spotTarget.z);
    let viewDirXZ;
    if (radialLen > 6) {
      viewDirXZ = new THREE.Vector2(spotTarget.x / radialLen, spotTarget.z / radialLen);
      // Slight cross-angle so coastline and mountain flanks show clear depth
      viewDirXZ.rotateAround(new THREE.Vector2(0, 0), 0.36);
    } else {
      viewDirXZ = new THREE.Vector2(-0.22, 0.97).normalize();
    }

    const clampedPolar = THREE.MathUtils.clamp(
      polarAngle,
      controls.minPolarAngle + 0.08,
      controls.maxPolarAngle - 0.04,
    );
    const clampedDist = THREE.MathUtils.clamp(distance, controls.minDistance + 2, controls.maxDistance);

    const horizDist = Math.sin(clampedPolar) * clampedDist;
    const vertDist = Math.cos(clampedPolar) * clampedDist;

    const camOffset = new THREE.Vector3(
      viewDirXZ.x * horizDist,
      vertDist,
      viewDirXZ.y * horizDist,
    );

    const lookTarget = spotTarget.clone();
    const camPos = spotTarget.clone().add(camOffset);

    // Offset viewport center away from the open panel / bottom sheet
    if (panelBias) {
      const forward = lookTarget.clone().sub(camPos).normalize();
      const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
      const forwardXZ = new THREE.Vector3(forward.x, 0, forward.z).normalize();

      if (isDesktop) {
        // Right side drawer occupies right ~35% -> shift framing target right so pin lands left-of-center
        const shift = right.multiplyScalar(clampedDist * 0.16);
        lookTarget.add(shift);
        camPos.add(shift);
      } else {
        // Bottom sheet occupies lower ~54% -> shift camera & target south along view axis so pin sits cleanly high
        const shift = forwardXZ.multiplyScalar(-clampedDist * 0.34);
        lookTarget.add(shift);
        camPos.add(shift);
      }
    }

    lookTarget.x = THREE.MathUtils.clamp(lookTarget.x, -PAN_LIMIT_XZ, PAN_LIMIT_XZ);
    lookTarget.z = THREE.MathUtils.clamp(lookTarget.z, -PAN_LIMIT_XZ, PAN_LIMIT_XZ);
    lookTarget.y = THREE.MathUtils.clamp(lookTarget.y, 0, PAN_LIMIT_Y);

    animateCameraTo(camPos, lookTarget, { duration, ease: 'power3.inOut', onComplete });
  }

  function clampTarget() {
    controls.target.x = THREE.MathUtils.clamp(controls.target.x, -PAN_LIMIT_XZ, PAN_LIMIT_XZ);
    controls.target.z = THREE.MathUtils.clamp(controls.target.z, -PAN_LIMIT_XZ, PAN_LIMIT_XZ);
    controls.target.y = THREE.MathUtils.clamp(controls.target.y, 0, PAN_LIMIT_Y);
  }

  const clock = new THREE.Clock();
  const updateCallbacks = [];
  let rafId = 0;

  function onTick(cb) {
    updateCallbacks.push(cb);
  }

  function start() {
    function loop() {
      rafId = requestAnimationFrame(loop);
      const elapsed = clock.getElapsedTime();
      clampTarget();
      controls.update();
      camera.updateMatrixWorld();
      for (const cb of updateCallbacks) {
        cb(elapsed);
      }
      renderer.render(scene, camera);
    }
    loop();
  }

  function dispose() {
    cancelCameraTween();
    cancelAnimationFrame(rafId);
    window.removeEventListener('resize', updateSize);
    controls.dispose();
    renderer.dispose();
  }

  return {
    scene,
    camera,
    renderer,
    controls,
    skyColor: SKY_TOP,
    horizonColor: SKY_HORIZON,
    sunDirection: SUN_DIRECTION,
    onTick,
    onUserInteract,
    start,
    resetView,
    playIntroSweep,
    flyTo,
    dispose,
  };
}

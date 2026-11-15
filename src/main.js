import './style.css';
import gsap from 'gsap';
import { createSceneController } from './scene.js';
import { createTerrain } from './terrain.js';
import { createWater } from './water.js';
import { createPinsLayer } from './pins.js';
import { createUIController } from './ui.js';
import spotsData from './data/spots.json';
import municipalitiesData from './data/municipalities.json';

function syncSliderTrack(slider) {
  const min = parseFloat(slider.min) || 1;
  const max = parseFloat(slider.max) || 6;
  const val = parseFloat(slider.value) || 2.6;
  const pct = ((val - min) / (max - min)) * 100;
  slider.style.setProperty('--range-pct', `${pct.toFixed(1)}%`);
}

async function init() {
  gsap.ticker.lagSmoothing(0);
  const canvas = document.getElementById('scene-canvas');
  const overlayEl = document.getElementById('map-overlay');
  const slider = document.getElementById('exaggeration-slider');
  const sliderOutput = document.getElementById('exaggeration-value');
  const labelsBtn = document.getElementById('labels-toggle-btn');
  const resetBtn = document.getElementById('reset-view-btn');

  const loadingScreen = document.getElementById('loading-screen');
  const loadingBarFill = document.getElementById('loading-bar-fill');
  const loadingStatus = document.getElementById('loading-status');

  const stageProgress = {
    'Loading elevation metadata...': 28,
    'Decoding 16-bit elevation tiles...': 52,
    'Building 3D terrain mesh...': 76,
    'Shading elevation bands & coastal relief...': 92,
  };

  syncSliderTrack(slider);

  try {
    const sceneCtrl = createSceneController(canvas);

    const terrain = await createTerrain((msg) => {
      loadingStatus.textContent = msg;
      const pct = stageProgress[msg];
      if (pct) {
        loadingBarFill.style.width = `${pct}%`;
      }
    });

    const initialExag = parseFloat(slider.value) || 2.6;
    terrain.setExaggeration(initialExag);
    sliderOutput.textContent = `${initialExag.toFixed(1)}×`;
    sceneCtrl.scene.add(terrain.mesh);

    const water = createWater({
      shoreGlowTexture: terrain.shoreGlowTexture,
      sunDirection: sceneCtrl.sunDirection,
      skyColor: sceneCtrl.skyColor,
      horizonColor: sceneCtrl.horizonColor,
    });
    sceneCtrl.scene.add(water.mesh);

    let uiCtrl = null;
    const pinsLayer = createPinsLayer({
      scene: sceneCtrl.scene,
      camera: sceneCtrl.camera,
      terrain,
      spots: spotsData,
      municipalities: municipalitiesData,
      overlayEl,
      onSelectSpot: (spotId) => {
        uiCtrl?.selectSpot(spotId);
      },
    });

    uiCtrl = createUIController({
      spots: spotsData,
      pinsLayer,
      sceneCtrl,
    });

    sceneCtrl.onTick((elapsed) => {
      water.update(elapsed);
      pinsLayer.update(elapsed);
    });

    slider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      terrain.setExaggeration(val);
      sliderOutput.textContent = `${val.toFixed(1)}×`;
      syncSliderTrack(slider);
      pinsLayer.syncHeights();
    });

    let showLabels = true;
    labelsBtn.addEventListener('click', () => {
      showLabels = !showLabels;
      labelsBtn.classList.toggle('is-active', showLabels);
      labelsBtn.setAttribute('aria-pressed', showLabels ? 'true' : 'false');
      pinsLayer.setLabelsVisible(showLabels);
    });

    resetBtn.addEventListener('click', () => {
      uiCtrl.stopTour();
      uiCtrl.closePlacesDrawer({ immediate: true });
      uiCtrl.closeSpot();
      sceneCtrl.resetView();
    });

    // Dismiss active detail card or places drawer when user taps cleanly on ocean / terrain without dragging
    let downX = 0;
    let downY = 0;
    canvas.addEventListener('pointerdown', (e) => {
      downX = e.clientX;
      downY = e.clientY;
    });
    canvas.addEventListener('pointerup', (e) => {
      const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
      if (moved < 6) {
        if (uiCtrl.isDrawerOpen()) {
          uiCtrl.closePlacesDrawer();
        }
        if (uiCtrl.getActiveSpotId()) {
          uiCtrl.stopTour();
          uiCtrl.closeSpot();
        }
      }
    });

    loadingBarFill.style.width = '100%';
    loadingStatus.textContent = 'Ready to explore Marinduque';

    sceneCtrl.start();
    sceneCtrl.playIntroSweep();

    requestAnimationFrame(() => {
      loadingScreen.style.pointerEvents = 'none';
      gsap.to(loadingScreen, {
        opacity: 0,
        duration: 0.55,
        delay: 0.1,
        ease: 'power2.out',
        onComplete: () => {
          loadingScreen.remove();
        },
      });
    });
  } catch (err) {
    console.error('Failed to initialize 3D map:', err);
    const msg = String(err?.message || '').toLowerCase();
    loadingStatus.textContent = msg.includes('webgl')
      ? 'WebGL 3D rendering is unavailable in this browser view.'
      : 'Could not load elevation data. Run "npm run fetch-terrain" first.';
    loadingBarFill.style.background = '#ef4444';
  }
}

init();

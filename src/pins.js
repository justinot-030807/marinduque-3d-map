import * as THREE from 'three';

const MIN_PIN_SCREEN_SEP = 44; // guarantees >= 44px tap clearance & zero overlap
const STEM_THRESHOLD_PX = 5;

const COLOR_FEATURED = new THREE.Color(0xf59e0b);
const COLOR_STANDARD = new THREE.Color(0x34d399);
const COLOR_EVENT = new THREE.Color(0xfbbf24);
const COLOR_SELECTED = new THREE.Color(0xffffff);

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Create glowing radial glow sprite texture on an offscreen 2D canvas.
 */
function createGlowTexture() {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
  grad.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');
  grad.addColorStop(0.28, 'rgba(255, 255, 255, 0.72)');
  grad.addColorStop(0.62, 'rgba(255, 255, 255, 0.22)');
  grad.addColorStop(1.0, 'rgba(255, 255, 255, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

function getPinIconMarkup(spot) {
  if (spot.isEvent) {
    // Festive mask / calendar spark glyph for Moriones Festival
    return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2.2l1.6 3.3 3.6.5-2.6 2.5.6 3.6L8 10.4l-3.2 1.7.6-3.6L2.8 6l3.6-.5L8 2.2z"/></svg>`;
  }
  if (spot.category === 'Peaks & Nature') {
    return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12.5L6.5 4.5l3 5 2-3L14 12.5H2z"/></svg>`;
  }
  if (spot.category === 'Heritage & Events') {
    return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2.5v3M6.5 4h3M4 13.5V7.5l4-2 4 2v6M3 13.5h10"/></svg>`;
  }
  // Default: Beaches & Islands coastal droplet/compass gem
  return `<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="8" cy="8" r="3.4"/></svg>`;
}

/**
 * Manages 3D surface beacons + constant-screen-size projected DOM pins
 * + municipality labels synchronized with real terrain height & camera motion.
 */
export function createPinsLayer({
  scene,
  camera,
  terrain,
  spots,
  municipalities,
  overlayEl,
  onSelectSpot,
}) {
  const pinGroup = new THREE.Group();
  pinGroup.name = 'MarinduquePins';
  scene.add(pinGroup);

  const glowTex = createGlowTexture();
  const ringGeom = new THREE.RingGeometry(0.46, 0.78, 28);
  ringGeom.rotateX(-Math.PI / 2);
  const dotGeom = new THREE.SphereGeometry(0.24, 14, 12);

  // Layer containers inside overlayEl
  const stemsSvg = document.createElementNS(SVG_NS, 'svg');
  stemsSvg.setAttribute('class', 'pin-stems');
  stemsSvg.setAttribute('aria-hidden', 'true');
  overlayEl.appendChild(stemsSvg);

  const muniContainer = document.createElement('div');
  muniContainer.className = 'municipality-layer';
  overlayEl.appendChild(muniContainer);

  const pinContainer = document.createElement('div');
  pinContainer.className = 'pins-layer';
  overlayEl.appendChild(pinContainer);

  let activeCategory = 'all';
  let activeSpotId = null;
  let labelsVisible = true;

  // Build municipality entries
  const muniItems = municipalities.map((m) => {
    const anchor = terrain.getAnchorAtLatLon(m.lat, m.lon);
    const el = document.createElement('div');
    el.className = `muni-label${m.tag ? ' is-capital' : ''}`;
    el.innerHTML = m.tag
      ? `<span class="muni-name">${m.name}</span><span class="muni-tag">${m.tag}</span>`
      : `<span class="muni-name">${m.name}</span>`;
    muniContainer.appendChild(el);
    return {
      data: m,
      anchor,
      worldPos: new THREE.Vector3(anchor.x, 0, anchor.z),
      el,
    };
  });

  // Build spot entries (3D beacon + projected button + SVG leader line)
  const spotItems = spots.map((spot, idx) => {
    const anchor = terrain.getAnchorAtLatLon(spot.lat, spot.lon);
    const baseColor = spot.featured
      ? COLOR_FEATURED
      : spot.isEvent
        ? COLOR_EVENT
        : COLOR_STANDARD;

    // 3D ground ring & glowing core beacon locked to surface
    const beaconGroup = new THREE.Group();

    const ringMat = new THREE.MeshBasicMaterial({
      color: baseColor.clone(),
      transparent: true,
      opacity: spot.featured ? 0.65 : 0.45,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const ringMesh = new THREE.Mesh(ringGeom, ringMat);
    beaconGroup.add(ringMesh);

    const dotMat = new THREE.MeshBasicMaterial({
      color: baseColor.clone(),
      transparent: true,
      opacity: 0.92,
    });
    const dotMesh = new THREE.Mesh(dotGeom, dotMat);
    dotMesh.position.y = 0.22;
    beaconGroup.add(dotMesh);

    const spriteMat = new THREE.SpriteMaterial({
      map: glowTex,
      color: baseColor.clone(),
      transparent: true,
      opacity: spot.featured ? 0.72 : 0.48,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const haloSprite = new THREE.Sprite(spriteMat);
    haloSprite.scale.set(2.8, 2.8, 1);
    haloSprite.position.y = 0.3;
    beaconGroup.add(haloSprite);

    pinGroup.add(beaconGroup);

    // SVG hairline tether line + tiny ground dot for decluttered pins
    const stemLine = document.createElementNS(SVG_NS, 'line');
    stemLine.setAttribute('class', `pin-stem${spot.featured ? ' is-featured' : ''}`);
    stemsSvg.appendChild(stemLine);

    const groundDot = document.createElementNS(SVG_NS, 'circle');
    groundDot.setAttribute('r', '2.5');
    groundDot.setAttribute('class', `pin-ground-dot${spot.featured ? ' is-featured' : ''}`);
    stemsSvg.appendChild(groundDot);

    // Accessible interactive pin button (>= 48x48px hit area)
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = [
      'map-pin',
      spot.featured ? 'is-featured' : 'is-standard',
      spot.isEvent ? 'is-event' : '',
    ]
      .filter(Boolean)
      .join(' ');
    btn.dataset.spotId = spot.id;
    btn.setAttribute(
      'aria-label',
      `${spot.name} in ${spot.municipality} (${spot.category})${spot.featured ? ' — Featured Top Pick' : ''}`,
    );
    btn.style.setProperty('--pin-delay', `${(idx * 0.28).toFixed(2)}s`);

    btn.innerHTML = `
      <span class="pin-pulse" aria-hidden="true"></span>
      <span class="pin-core" aria-hidden="true">${getPinIconMarkup(spot)}</span>
      <span class="pin-tooltip" aria-hidden="true">${spot.name}</span>
    `;

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      onSelectSpot?.(spot.id);
    });

    pinContainer.appendChild(btn);

    return {
      spot,
      anchor,
      elevMeters: Math.round(anchor.elevMeters),
      worldPos: new THREE.Vector3(anchor.x, 0, anchor.z),
      beaconGroup,
      ringMesh,
      ringMat,
      dotMat,
      spriteMat,
      haloSprite,
      baseColor,
      btn,
      stemLine,
      groundDot,
      visible: true,
      ax: 0,
      ay: 0,
      dx: 0,
      dy: 0,
      inFront: false,
      seedAngle: idx * 1.17 + 0.45,
    };
  });

  function syncHeights() {
    const exag = terrain.getExaggeration();
    for (const item of spotItems) {
      const y = Math.max(0.08, item.anchor.baseY * exag);
      item.worldPos.y = y;
      item.beaconGroup.position.set(item.anchor.x, y + 0.16, item.anchor.z);
    }
    for (const m of muniItems) {
      const y = Math.max(0.08, m.anchor.baseY * exag);
      m.worldPos.y = y + 0.35;
    }
  }
  syncHeights();

  function matchesFilter(spot) {
    if (activeCategory === 'all') return true;
    if (activeCategory === 'featured') return Boolean(spot.featured);
    return spot.category === activeCategory;
  }

  function applyVisibility() {
    for (const item of spotItems) {
      const show = matchesFilter(item.spot) || item.spot.id === activeSpotId;
      item.visible = show;
      item.beaconGroup.visible = show;
      item.btn.classList.toggle('is-filtered-out', !show);
      item.btn.tabIndex = show ? 0 : -1;
      item.btn.setAttribute('aria-hidden', show ? 'false' : 'true');
      const isActive = item.spot.id === activeSpotId;
      item.btn.classList.toggle('is-active', isActive);
    }
  }

  function setCategoryFilter(category) {
    activeCategory = category;
    applyVisibility();
  }

  function setActiveSpot(spotId) {
    activeSpotId = spotId || null;
    applyVisibility();
  }

  function setLabelsVisible(show) {
    labelsVisible = Boolean(show);
    muniContainer.classList.toggle('is-hidden', !labelsVisible);
  }

  function getSpotWorldPos(spotId) {
    const found = spotItems.find((i) => i.spot.id === spotId);
    return found ? found.worldPos.clone() : null;
  }

  function getSpotElevation(spotId) {
    const found = spotItems.find((i) => i.spot.id === spotId);
    return found ? found.elevMeters : 0;
  }

  function getVisibleSpots() {
    return spotItems.filter((i) => matchesFilter(i.spot)).map((i) => i.spot);
  }

  // Reusable projection scratch vector
  const projVec = new THREE.Vector3();

  function update(elapsed) {
    const w = overlayEl.clientWidth || window.innerWidth;
    const h = overlayEl.clientHeight || window.innerHeight;
    if (w <= 0 || h <= 0) return;

    const camDist = camera.position.length();
    const closeupDim = camDist < 55;

    // 1. Update 3D beacon pulse & project each spot anchor to screen pixels
    const activeProjected = [];

    for (let i = 0; i < spotItems.length; i++) {
      const item = spotItems[i];
      if (!item.visible) {
        item.stemLine.style.display = 'none';
        item.groundDot.style.display = 'none';
        continue;
      }

      const isSelected = item.spot.id === activeSpotId;
      const phase = elapsed * 2.4 + i * 0.7;
      const pulse = 0.5 + 0.5 * Math.sin(phase);

      // Gentle 3D surface beacon animation
      const ringScale = isSelected ? 1.55 + pulse * 0.45 : item.spot.featured ? 1.05 + pulse * 0.35 : 0.9 + pulse * 0.25;
      item.ringMesh.scale.setScalar(ringScale);
      item.ringMat.opacity = isSelected ? 0.85 : (item.spot.featured ? 0.38 : 0.26) + pulse * 0.28;
      item.dotMat.color.copy(isSelected ? COLOR_SELECTED : item.baseColor);
      item.ringMat.color.copy(isSelected ? COLOR_SELECTED : item.baseColor);
      item.spriteMat.color.copy(isSelected ? COLOR_SELECTED : item.baseColor);
      item.haloSprite.scale.setScalar(isSelected ? 4.1 + pulse * 0.7 : item.spot.featured ? 2.9 + pulse * 0.4 : 2.1);

      // Project slightly above terrain surface bead
      projVec.set(item.worldPos.x, item.worldPos.y + 0.5, item.worldPos.z).project(camera);
      const inFront = projVec.z >= -1 && projVec.z <= 1;
      const sx = (projVec.x * 0.5 + 0.5) * w;
      const sy = (-projVec.y * 0.5 + 0.5) * h;

      item.inFront = inFront && sx > -40 && sx < w + 40 && sy > -40 && sy < h + 40;
      item.ax = sx;
      item.ay = sy;
      item.dx = sx;
      item.dy = sy;

      if (item.inFront) {
        activeProjected.push(item);
      } else {
        item.btn.style.opacity = '0';
        item.btn.style.pointerEvents = 'none';
        item.stemLine.style.display = 'none';
        item.groundDot.style.display = 'none';
      }
    }

    // 2. Screen-space decluttering so co-located pins (e.g., Boac Cathedral & Moriones) never overlap
    for (let pass = 0; pass < 3; pass++) {
      for (let a = 0; a < activeProjected.length; a++) {
        for (let b = a + 1; b < activeProjected.length; b++) {
          const pA = activeProjected[a];
          const pB = activeProjected[b];
          let vx = pB.dx - pA.dx;
          let vy = pB.dy - pA.dy;
          let dist = Math.hypot(vx, vy);

          if (dist < MIN_PIN_SCREEN_SEP) {
            if (dist < 0.01) {
              vx = Math.cos(pA.seedAngle);
              vy = Math.sin(pA.seedAngle);
              dist = 1;
            }
            const push = (MIN_PIN_SCREEN_SEP - dist) * 0.52;
            const nx = vx / dist;
            const ny = vy / dist;
            pA.dx -= nx * push;
            pA.dy -= ny * push;
            pB.dx += nx * push;
            pB.dy += ny * push;
          }
        }
      }
    }

    // Apply DOM positions & optional SVG stems back to real ground coordinates
    for (const item of activeProjected) {
      item.btn.style.opacity = '';
      item.btn.style.pointerEvents = '';
      item.btn.style.transform = `translate3d(${item.dx.toFixed(1)}px, ${item.dy.toFixed(1)}px, 0) translate(-50%, -50%)`;

      if (item.dx < 96) item.btn.dataset.edge = 'left';
      else if (item.dx > w - 96) item.btn.dataset.edge = 'right';
      else delete item.btn.dataset.edge;

      const offsetDist = Math.hypot(item.dx - item.ax, item.dy - item.ay);
      if (offsetDist > STEM_THRESHOLD_PX) {
        item.stemLine.style.display = '';
        item.stemLine.setAttribute('x1', item.ax.toFixed(1));
        item.stemLine.setAttribute('y1', item.ay.toFixed(1));
        item.stemLine.setAttribute('x2', item.dx.toFixed(1));
        item.stemLine.setAttribute('y2', item.dy.toFixed(1));

        item.groundDot.style.display = '';
        item.groundDot.setAttribute('cx', item.ax.toFixed(1));
        item.groundDot.setAttribute('cy', item.ay.toFixed(1));
      } else {
        item.stemLine.style.display = 'none';
        item.groundDot.style.display = 'none';
      }
    }

    // 3. Project municipality labels cleanly with subtle proximity fade near active pins
    if (labelsVisible) {
      for (const m of muniItems) {
        projVec.copy(m.worldPos).project(camera);
        const inFront = projVec.z >= -1 && projVec.z <= 1;
        const mx = (projVec.x * 0.5 + 0.5) * w;
        const my = (-projVec.y * 0.5 + 0.5) * h;

        if (!inFront || mx < -60 || mx > w + 60 || my < -40 || my > h + 40) {
          m.el.style.opacity = '0';
          continue;
        }

        // Shift Boac slightly northwest so it sits clearly beside Cathedral & Plaza pins
        const tweakX = m.data.id === 'boac' ? -28 : 0;
        const tweakY = m.data.id === 'boac' ? -18 : -12;
        const lx = mx + tweakX;
        const ly = my + tweakY;

        let crowded = false;
        for (const p of activeProjected) {
          if (Math.hypot(p.dx - lx, p.dy - ly) < 44) {
            crowded = true;
            break;
          }
        }

        m.el.style.transform = `translate3d(${lx.toFixed(1)}px, ${ly.toFixed(1)}px, 0) translate(-50%, -100%)`;
        m.el.style.opacity = closeupDim || crowded ? '0.26' : '0.92';
      }
    }
  }

  return {
    syncHeights,
    setCategoryFilter,
    setActiveSpot,
    setLabelsVisible,
    getSpotWorldPos,
    getSpotElevation,
    getVisibleSpots,
    update,
  };
}

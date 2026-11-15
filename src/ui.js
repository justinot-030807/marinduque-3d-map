import gsap from 'gsap';

const TOUR_STOP_DURATION_SEC = 7.5;

function formatCoords(lat, lon) {
  const latStr = `${Math.abs(lat).toFixed(3)}° ${lat >= 0 ? 'N' : 'S'}`;
  const lonStr = `${Math.abs(lon).toFixed(3)}° ${lon >= 0 ? 'E' : 'W'}`;
  return `${latStr}, ${lonStr}`;
}

function formatElev(elevMeters) {
  if (elevMeters < 2) return 'Sea level';
  return `Elev. ${elevMeters.toLocaleString('en-US')} m`;
}

/**
 * Safely renders text while wrapping `TODO: ...` phrases cleanly for editorial clarity.
 */
function renderTextWithTodo(el, text) {
  el.textContent = '';
  if (!text) return;
  const regex = /(TODO:[^.;)]+(?:[.;)]|$))/gi;
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      el.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
    }
    const span = document.createElement('span');
    span.className = 'todo-note';
    span.textContent = match[0];
    el.appendChild(span);
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    el.appendChild(document.createTextNode(text.slice(lastIndex)));
  }
}

export function createUIController({ spots, pinsLayer, sceneCtrl }) {
  const filterBtns = Array.from(document.querySelectorAll('.filter-chip'));
  const tourToggleBtn = document.getElementById('tour-toggle-btn');

  // Tour dock DOM
  const tourDock = document.getElementById('tour-dock');
  const tourStepLabel = document.getElementById('tour-step-label');
  const tourProgressFill = document.getElementById('tour-progress-fill');
  const tourPrevBtn = document.getElementById('tour-prev-btn');
  const tourPlayBtn = document.getElementById('tour-play-btn');
  const tourPlayIcon = document.getElementById('tour-play-icon');
  const tourNextBtn = document.getElementById('tour-next-btn');
  const tourExitBtn = document.getElementById('tour-exit-btn');

  // Spot detail panel / bottom sheet DOM
  const sheet = document.getElementById('spot-sheet');
  const sheetHandle = document.getElementById('spot-sheet-handle');
  const closeBtn = document.getElementById('spot-close-btn');
  const photoEl = document.getElementById('spot-photo');
  const catLabelEl = document.getElementById('spot-category-label');
  const featuredBadgeEl = document.getElementById('spot-featured-badge');
  const elevBadgeEl = document.getElementById('spot-elev-badge');
  const muniEl = document.getElementById('spot-municipality');
  const coordsEl = document.getElementById('spot-coords');
  const titleEl = document.getElementById('spot-sheet-title');
  const descEl = document.getElementById('spot-description');
  const gettingThereEl = document.getElementById('spot-getting-there');
  const bestTimeEl = document.getElementById('spot-best-time');
  const creditEl = document.getElementById('spot-photo-credit');
  const prevSpotBtn = document.getElementById('spot-prev-btn');
  const nextSpotBtn = document.getElementById('spot-next-btn');
  const counterEl = document.getElementById('spot-index-counter');

  const featuredSpots = spots.filter((s) => s.featured);

  let activeSpotId = null;
  let activeFilter = 'all';
  let tourActive = false;
  let tourPlaying = false;
  let tourIndex = 0;
  let tourProgressTween = null;

  const isDesktop = () => window.innerWidth >= 768;

  function setActiveFilter(category) {
    activeFilter = category;
    for (const btn of filterBtns) {
      const matches = btn.dataset.filter === category;
      btn.classList.toggle('is-active', matches);
      btn.setAttribute('aria-pressed', matches ? 'true' : 'false');
    }
    pinsLayer.setCategoryFilter(category);

    // If an open spot isn't part of the newly chosen filter, close cleanly
    if (activeSpotId && category !== 'all') {
      const current = spots.find((s) => s.id === activeSpotId);
      if (current && current.category !== category) {
        closeSpot();
      }
    }
  }

  function populateSpotContent(spot) {
    const elev = pinsLayer.getSpotElevation(spot.id);
    photoEl.src = spot.photo;
    photoEl.alt = `${spot.name} in ${spot.municipality}, Marinduque`;
    catLabelEl.textContent = spot.isEvent ? 'Cultural Event' : spot.category;
    featuredBadgeEl.hidden = !spot.featured;
    elevBadgeEl.textContent = formatElev(elev);

    muniEl.textContent = spot.municipality;
    coordsEl.textContent = formatCoords(spot.lat, spot.lon);
    titleEl.textContent = spot.name;

    renderTextWithTodo(descEl, spot.description);
    renderTextWithTodo(gettingThereEl, spot.howToGetThere);
    renderTextWithTodo(bestTimeEl, spot.bestTime);

    if (spot.photoCredit) {
      creditEl.hidden = false;
      renderTextWithTodo(creditEl, spot.photoCredit);
    } else {
      creditEl.hidden = true;
    }

    const list = tourActive ? featuredSpots : pinsLayer.getVisibleSpots();
    const idx = Math.max(0, list.findIndex((s) => s.id === spot.id));
    counterEl.textContent = `${idx + 1} / ${list.length}`;

    // Scroll body back to top on spot switch
    const bodyEl = sheet.querySelector('.spot-body');
    if (bodyEl) bodyEl.scrollTop = 0;
  }

  function selectSpot(spotId, { fromTour = false } = {}) {
    const spot = spots.find((s) => s.id === spotId);
    if (!spot) return;

    // If user clicks a regular pin directly while tour auto-play is running, pause auto-play gracefully
    if (!fromTour && tourActive) {
      pauseTour();
    }

    const wasClosed = sheet.hidden;
    activeSpotId = spot.id;
    pinsLayer.setActiveSpot(spot.id);
    document.body.classList.add('has-spot-open');
    populateSpotContent(spot);

    if (wasClosed) {
      sheet.hidden = false;
      gsap.killTweensOf(sheet);
      gsap.fromTo(
        sheet,
        isDesktop() ? { opacity: 0, x: 26, y: 0 } : { opacity: 0, y: 36, x: 0 },
        { opacity: 1, x: 0, y: 0, duration: 0.36, ease: 'power3.out', clearProps: 'transform' },
      );
    }

    const worldPos = pinsLayer.getSpotWorldPos(spot.id);
    if (worldPos) {
      // Slightly closer framing for small architectural landmarks, wider for peaks & islands
      const distance =
        spot.id === 'mt-malindig'
          ? isDesktop() ? 42 : 48
          : spot.id === 'boac-cathedral' || spot.id === 'moriones-festival'
            ? isDesktop() ? 27 : 33
            : isDesktop() ? 33 : 39;

      sceneCtrl.flyTo(worldPos, {
        distance,
        polarAngle: spot.id === 'mt-malindig' ? 0.96 : 0.88,
        duration: 1.25,
        panelBias: true,
      });
    }
  }

  function closeSpot() {
    if (sheet.hidden && !activeSpotId) return;
    activeSpotId = null;
    pinsLayer.setActiveSpot(null);
    document.body.classList.remove('has-spot-open');

    if (!sheet.hidden) {
      gsap.killTweensOf(sheet);
      gsap.to(sheet, {
        opacity: 0,
        ...(isDesktop() ? { x: 22 } : { y: 32 }),
        duration: 0.24,
        ease: 'power2.in',
        onComplete: () => {
          sheet.hidden = true;
          gsap.set(sheet, { clearProps: 'all' });
        },
      });
    }
  }

  function stepSpot(delta) {
    if (tourActive) {
      goToTourStop(tourIndex + delta);
      return;
    }
    const list = pinsLayer.getVisibleSpots();
    if (!list.length) return;
    const curIdx = list.findIndex((s) => s.id === activeSpotId);
    const nextIdx = curIdx === -1 ? 0 : (curIdx + delta + list.length) % list.length;
    selectSpot(list[nextIdx].id);
  }

  // =========================================================================
  // Top Picks Tour Logic
  // =========================================================================
  function updateTourPlayUI() {
    if (tourPlaying) {
      tourPlayBtn.setAttribute('aria-label', 'Pause auto-advance');
      tourPlayIcon.innerHTML =
        '<rect x="4.5" y="4" width="3.2" height="10" rx="1"/><rect x="10.3" y="4" width="3.2" height="10" rx="1"/>';
    } else {
      tourPlayBtn.setAttribute('aria-label', 'Resume auto-advance');
      tourPlayIcon.innerHTML = '<polygon points="5,3.5 14,9 5,14.5" />';
    }
  }

  function scheduleNextTourStop() {
    if (tourProgressTween) {
      tourProgressTween.kill();
      tourProgressTween = null;
    }
    if (!tourActive || !tourPlaying) {
      const pct = ((tourIndex + 1) / featuredSpots.length) * 100;
      tourProgressFill.style.width = `${pct.toFixed(1)}%`;
      return;
    }

    const basePct = (tourIndex / featuredSpots.length) * 100;
    const targetPct = ((tourIndex + 1) / featuredSpots.length) * 100;
    tourProgressFill.style.transition = 'none';
    tourProgressFill.style.width = `${basePct.toFixed(1)}%`;

    tourProgressTween = gsap.to(tourProgressFill, {
      width: `${targetPct.toFixed(1)}%`,
      duration: TOUR_STOP_DURATION_SEC,
      ease: 'none',
      onComplete: () => {
        if (tourActive && tourPlaying) {
          goToTourStop(tourIndex + 1);
        }
      },
    });
  }

  function goToTourStop(nextIndex) {
    if (!featuredSpots.length) return;
    tourIndex = (nextIndex + featuredSpots.length) % featuredSpots.length;
    const stop = featuredSpots[tourIndex];
    tourStepLabel.textContent = `Stop ${tourIndex + 1} of ${featuredSpots.length} · ${stop.name}`;
    selectSpot(stop.id, { fromTour: true });
    scheduleNextTourStop();
  }

  function startTour() {
    if (!featuredSpots.length) return;
    tourActive = true;
    tourPlaying = true;
    document.body.classList.add('is-tour-active');

    setActiveFilter('all');

    tourToggleBtn.classList.add('is-running');
    tourToggleBtn.setAttribute('aria-pressed', 'true');
    tourToggleBtn.querySelector('span').textContent = 'Exit Tour';
    tourToggleBtn.querySelector('svg').innerHTML =
      '<rect x="4" y="4" width="10" height="10" rx="2" fill="currentColor" />';

    tourDock.hidden = false;
    gsap.killTweensOf(tourDock);
    gsap.fromTo(
      tourDock,
      { opacity: 0, y: 12 },
      { opacity: 1, y: 0, duration: 0.28, ease: 'power2.out', clearProps: 'transform' },
    );

    updateTourPlayUI();
    goToTourStop(0);
  }

  function pauseTour() {
    if (!tourActive || !tourPlaying) return;
    tourPlaying = false;
    if (tourProgressTween) {
      tourProgressTween.kill();
      tourProgressTween = null;
    }
    updateTourPlayUI();
  }

  function resumeTour() {
    if (!tourActive || tourPlaying) return;
    tourPlaying = true;
    updateTourPlayUI();
    scheduleNextTourStop();
  }

  function stopTour() {
    if (!tourActive) return;
    tourActive = false;
    tourPlaying = false;
    if (tourProgressTween) {
      tourProgressTween.kill();
      tourProgressTween = null;
    }
    document.body.classList.remove('is-tour-active');
    tourDock.hidden = true;
    tourToggleBtn.classList.remove('is-running');
    tourToggleBtn.setAttribute('aria-pressed', 'false');
    tourToggleBtn.querySelector('span').textContent = 'Top Picks Tour';
    tourToggleBtn.querySelector('svg').innerHTML =
      '<polygon points="5.5,3.5 14.5,9 5.5,14.5" fill="currentColor" />';
  }

  // =========================================================================
  // Event Listeners
  // =========================================================================
  for (const btn of filterBtns) {
    btn.addEventListener('click', () => {
      if (tourActive) stopTour();
      setActiveFilter(btn.dataset.filter);
    });
  }

  tourToggleBtn.addEventListener('click', () => {
    if (tourActive) {
      stopTour();
      closeSpot();
      sceneCtrl.resetView();
    } else {
      startTour();
    }
  });

  tourPrevBtn.addEventListener('click', () => goToTourStop(tourIndex - 1));
  tourNextBtn.addEventListener('click', () => goToTourStop(tourIndex + 1));
  tourPlayBtn.addEventListener('click', () => {
    if (tourPlaying) pauseTour();
    else resumeTour();
  });
  tourExitBtn.addEventListener('click', () => {
    stopTour();
    closeSpot();
    sceneCtrl.resetView();
  });

  closeBtn.addEventListener('click', () => {
    if (tourActive) stopTour();
    closeSpot();
  });
  prevSpotBtn.addEventListener('click', () => stepSpot(-1));
  nextSpotBtn.addEventListener('click', () => stepSpot(1));

  // Manual globe drag pauses tour timer automatically so user controls win
  sceneCtrl.onUserInteract(() => {
    if (tourActive && tourPlaying) {
      pauseTour();
    }
  });

  // Mobile bottom-sheet swipe-down-to-close gesture on top handle
  let dragStartY = 0;
  let dragDeltaY = 0;
  let isDraggingSheet = false;

  sheetHandle.addEventListener('pointerdown', (e) => {
    if (isDesktop() || sheet.hidden) return;
    isDraggingSheet = true;
    dragStartY = e.clientY;
    dragDeltaY = 0;
    sheetHandle.setPointerCapture(e.pointerId);
    gsap.killTweensOf(sheet);
  });

  sheetHandle.addEventListener('pointermove', (e) => {
    if (!isDraggingSheet) return;
    dragDeltaY = Math.max(0, e.clientY - dragStartY);
    sheet.style.transform = `translateY(${dragDeltaY}px)`;
  });

  function finishSheetDrag() {
    if (!isDraggingSheet) return;
    isDraggingSheet = false;
    if (dragDeltaY > 72) {
      if (tourActive) stopTour();
      closeSpot();
    } else {
      gsap.to(sheet, { y: 0, duration: 0.24, ease: 'power2.out', clearProps: 'transform' });
    }
  }

  sheetHandle.addEventListener('pointerup', finishSheetDrag);
  sheetHandle.addEventListener('pointercancel', finishSheetDrag);

  // Clean keyboard navigation
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (tourActive) {
        stopTour();
        closeSpot();
      } else if (!sheet.hidden) {
        closeSpot();
      }
    } else if (e.key === 'ArrowRight' && (!sheet.hidden || tourActive)) {
      stepSpot(1);
    } else if (e.key === 'ArrowLeft' && (!sheet.hidden || tourActive)) {
      stepSpot(-1);
    }
  });

  return {
    selectSpot,
    closeSpot,
    startTour,
    stopTour,
    getActiveFilter: () => activeFilter,
    getActiveSpotId: () => activeSpotId,
  };
}

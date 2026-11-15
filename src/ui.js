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

function formatShortElev(elevMeters) {
  if (elevMeters < 2) return '0 m';
  return `${elevMeters.toLocaleString('en-US')} m`;
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

  // Explorer drawer DOM
  const placesToggleBtn = document.getElementById('places-toggle-btn');
  const placesCountBadge = document.getElementById('places-count-badge');
  const placesDrawer = document.getElementById('places-drawer');
  const placesCloseBtn = document.getElementById('places-close-btn');
  const placesSearch = document.getElementById('places-search');
  const placesSearchClear = document.getElementById('places-search-clear');
  const placesMuniBtns = Array.from(document.querySelectorAll('.muni-chip'));
  const placesList = document.getElementById('places-list');
  const placesSummary = document.getElementById('places-summary');

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
  const copyCoordsBtn = document.getElementById('spot-copy-coords-btn');
  const copyLabelEl = document.getElementById('spot-copy-label');
  const mapsLinkEl = document.getElementById('spot-maps-link');
  const titleEl = document.getElementById('spot-sheet-title');
  const descEl = document.getElementById('spot-description');
  const specsWrapEl = document.getElementById('spot-specs');
  const durationEl = document.getElementById('spot-duration');
  const costEl = document.getElementById('spot-cost');
  const hubEl = document.getElementById('spot-hub');
  const highlightsSectionEl = document.getElementById('spot-highlights-section');
  const highlightsEl = document.getElementById('spot-highlights');
  const gettingThereEl = document.getElementById('spot-getting-there');
  const bestTimeEl = document.getElementById('spot-best-time');
  const tipsRowEl = document.getElementById('spot-tips-row');
  const tipsEl = document.getElementById('spot-tips');
  const creditEl = document.getElementById('spot-photo-credit');
  const prevSpotBtn = document.getElementById('spot-prev-btn');
  const nextSpotBtn = document.getElementById('spot-next-btn');
  const counterEl = document.getElementById('spot-index-counter');

  const featuredSpots = spots.filter((s) => s.featured);

  let activeSpotId = null;
  let activeFilter = 'all';
  let drawerOpen = false;
  let drawerMuni = 'all';
  let drawerQuery = '';
  let tourActive = false;
  let tourPlaying = false;
  let tourIndex = 0;
  let tourProgressTween = null;
  let copyTimer = null;

  const isDesktop = () => window.innerWidth >= 768;

  // Populate dynamic category filter badge counts from spots.json
  function syncCategoryCounts() {
    const counts = { all: spots.length };
    for (const s of spots) {
      counts[s.category] = (counts[s.category] || 0) + 1;
    }
    for (const countEl of document.querySelectorAll('[data-count-for]')) {
      const key = countEl.dataset.countFor;
      countEl.textContent = String(counts[key] ?? 0);
    }
    if (placesCountBadge) {
      placesCountBadge.textContent = String(spots.length);
    }
  }
  syncCategoryCounts();

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

  // =========================================================================
  // Places Explorer Drawer
  // =========================================================================
  function getDirectorySpots() {
    const q = drawerQuery.trim().toLowerCase();
    return spots.filter((s) => {
      if (drawerMuni !== 'all') {
        const munis = s.municipality.toLowerCase();
        if (!munis.includes(drawerMuni.toLowerCase())) {
          return false;
        }
      }
      if (!q) return true;
      const haystack = [
        s.name,
        s.municipality,
        s.category,
        s.description,
        s.nearestHub || '',
        ...(Array.isArray(s.highlights) ? s.highlights : []),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }

  function renderPlacesDirectory() {
    const filtered = getDirectorySpots();
    placesList.textContent = '';

    if (placesSummary) {
      const townLabel = drawerMuni === 'all' ? 'all 6 towns' : drawerMuni;
      placesSummary.textContent = `${filtered.length} ${filtered.length === 1 ? 'destination' : 'destinations'} · ${townLabel}`;
    }

    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'places-empty';
      empty.innerHTML = `
        <p>No destinations matched your filter.</p>
        <button type="button" class="places-empty-reset">Reset search &amp; town filter</button>
      `;
      empty.querySelector('button').addEventListener('click', () => {
        drawerMuni = 'all';
        drawerQuery = '';
        placesSearch.value = '';
        placesSearchClear.hidden = true;
        for (const btn of placesMuniBtns) {
          btn.classList.toggle('is-active', btn.dataset.muni === 'all');
        }
        renderPlacesDirectory();
      });
      placesList.appendChild(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const spot of filtered) {
      const elev = pinsLayer.getSpotElevation(spot.id);
      const item = document.createElement('button');
      item.type = 'button';
      item.className = `place-row${spot.id === activeSpotId ? ' is-selected' : ''}${spot.featured ? ' is-featured' : ''}`;
      item.dataset.spotId = spot.id;
      item.setAttribute('role', 'listitem');

      const thumb = document.createElement('img');
      thumb.className = 'place-thumb';
      thumb.src = spot.photo;
      thumb.alt = '';
      thumb.loading = 'lazy';
      thumb.decoding = 'async';

      const info = document.createElement('div');
      info.className = 'place-info';

      const titleLine = document.createElement('div');
      titleLine.className = 'place-title-line';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'place-name';
      nameSpan.textContent = spot.name;
      titleLine.appendChild(nameSpan);

      if (spot.featured) {
        const starBadge = document.createElement('span');
        starBadge.className = 'place-star';
        starBadge.title = 'Top Pick';
        starBadge.setAttribute('aria-label', 'Top Pick');
        starBadge.textContent = '★';
        titleLine.appendChild(starBadge);
      }

      const subLine = document.createElement('div');
      subLine.className = 'place-sub';
      subLine.textContent = `${spot.municipality} · ${spot.isEvent ? 'Cultural Event' : spot.category}`;

      info.appendChild(titleLine);
      info.appendChild(subLine);

      const elevPill = document.createElement('span');
      elevPill.className = 'place-elev';
      elevPill.textContent = formatShortElev(elev);

      item.appendChild(thumb);
      item.appendChild(info);
      item.appendChild(elevPill);

      item.addEventListener('click', () => {
        if (activeFilter !== 'all' && spot.category !== activeFilter) {
          setActiveFilter('all');
        }
        closePlacesDrawer({ immediate: true });
        selectSpot(spot.id);
      });

      fragment.appendChild(item);
    }

    placesList.appendChild(fragment);
  }

  function openPlacesDrawer() {
    if (drawerOpen) return;
    drawerOpen = true;

    // On narrow mobile screens or desktop right column, dismiss open detail card cleanly so drawers never stack
    if (!sheet.hidden) {
      if (tourActive) stopTour();
      closeSpot();
    }

    placesToggleBtn.classList.add('is-active');
    placesToggleBtn.setAttribute('aria-expanded', 'true');
    document.body.classList.add('has-places-open');
    renderPlacesDirectory();

    placesDrawer.hidden = false;
    gsap.killTweensOf(placesDrawer);
    gsap.fromTo(
      placesDrawer,
      { opacity: 0, y: -10 },
      { opacity: 1, y: 0, duration: 0.24, ease: 'power2.out', clearProps: 'transform' },
    );
  }

  function closePlacesDrawer({ immediate = false } = {}) {
    if (!drawerOpen && placesDrawer.hidden) return;
    drawerOpen = false;
    placesToggleBtn.classList.remove('is-active');
    placesToggleBtn.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('has-places-open');

    if (immediate) {
      gsap.killTweensOf(placesDrawer);
      placesDrawer.hidden = true;
      gsap.set(placesDrawer, { clearProps: 'all' });
      return;
    }

    gsap.killTweensOf(placesDrawer);
    gsap.to(placesDrawer, {
      opacity: 0,
      y: -8,
      duration: 0.18,
      ease: 'power2.in',
      onComplete: () => {
        placesDrawer.hidden = true;
        gsap.set(placesDrawer, { clearProps: 'all' });
      },
    });
  }

  // =========================================================================
  // Spot Detail Content & Sheet Animation
  // =========================================================================
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

    // External Google Maps coordinate pin & reset Copy GPS button state
    if (mapsLinkEl) {
      mapsLinkEl.href = `https://www.google.com/maps/search/?api=1&query=${spot.lat},${spot.lon}`;
    }
    if (copyCoordsBtn && copyLabelEl) {
      copyCoordsBtn.dataset.gps = `${spot.lat.toFixed(5)}, ${spot.lon.toFixed(5)}`;
      copyCoordsBtn.classList.remove('is-copied');
      copyLabelEl.textContent = 'GPS';
      if (copyTimer) {
        clearTimeout(copyTimer);
        copyTimer = null;
      }
    }

    renderTextWithTodo(descEl, spot.description);

    // Quick 3-column trip planning specs strip
    const hasSpecs = Boolean(spot.duration || spot.estimatedCost || spot.nearestHub);
    if (specsWrapEl) {
      specsWrapEl.hidden = !hasSpecs;
      if (hasSpecs) {
        durationEl.textContent = spot.duration || 'Flexible';
        renderTextWithTodo(costEl, spot.estimatedCost || 'Varies locally');
        hubEl.textContent = spot.nearestHub || spot.municipality;
      }
    }

    // Highlights / What to See tags
    const hasHighlights = Array.isArray(spot.highlights) && spot.highlights.length > 0;
    if (highlightsSectionEl && highlightsEl) {
      highlightsSectionEl.hidden = !hasHighlights;
      highlightsEl.textContent = '';
      if (hasHighlights) {
        for (const item of spot.highlights) {
          const li = document.createElement('li');
          li.className = 'spot-highlight-chip';
          li.textContent = item;
          highlightsEl.appendChild(li);
        }
      }
    }

    renderTextWithTodo(gettingThereEl, spot.howToGetThere);
    renderTextWithTodo(bestTimeEl, spot.bestTime);

    if (tipsRowEl && tipsEl) {
      if (spot.tips) {
        tipsRowEl.hidden = false;
        renderTextWithTodo(tipsEl, spot.tips);
      } else {
        tipsRowEl.hidden = true;
      }
    }

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

    if (drawerOpen) {
      renderPlacesDirectory();
    }
  }

  function selectSpot(spotId, { fromTour = false } = {}) {
    const spot = spots.find((s) => s.id === spotId);
    if (!spot) return;

    if (drawerOpen) {
      closePlacesDrawer({ immediate: true });
    }

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
      const distance =
        spot.id === 'mt-malindig'
          ? isDesktop() ? 42 : 48
          : spot.id === 'pulang-lupa-shrine' || spot.id === 'luzon-datum-1911'
            ? isDesktop() ? 31 : 37
            : spot.id === 'boac-cathedral' ||
                spot.id === 'gasan-church' ||
                spot.id === 'moriones-festival' ||
                spot.id === 'biglang-awa-shrine'
              ? isDesktop() ? 27 : 33
              : isDesktop() ? 33 : 39;

      const polarAngle =
        spot.id === 'mt-malindig'
          ? 0.96
          : spot.id === 'pulang-lupa-shrine' || spot.id === 'luzon-datum-1911'
            ? 0.92
            : 0.88;

      sceneCtrl.flyTo(worldPos, {
        distance,
        polarAngle,
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
    if (drawerOpen) {
      closePlacesDrawer({ immediate: true });
    }

    tourActive = true;
    tourPlaying = true;
    document.body.classList.add('is-tour-active');

    setActiveFilter('all');

    tourToggleBtn.classList.add('is-running');
    tourToggleBtn.setAttribute('aria-pressed', 'true');
    const startLabel = tourToggleBtn.querySelector('.tour-cta-label');
    if (startLabel) startLabel.textContent = 'Exit Tour';
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
    const stopLabel = tourToggleBtn.querySelector('.tour-cta-label');
    if (stopLabel) stopLabel.innerHTML = 'Top Picks<span class="tour-cta-word"> Tour</span>';
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

  placesToggleBtn.addEventListener('click', () => {
    if (drawerOpen) closePlacesDrawer();
    else openPlacesDrawer();
  });

  placesCloseBtn.addEventListener('click', () => closePlacesDrawer());

  placesSearch.addEventListener('input', (e) => {
    drawerQuery = e.target.value || '';
    placesSearchClear.hidden = drawerQuery.length === 0;
    renderPlacesDirectory();
  });

  placesSearchClear.addEventListener('click', () => {
    drawerQuery = '';
    placesSearch.value = '';
    placesSearchClear.hidden = true;
    renderPlacesDirectory();
    placesSearch.focus();
  });

  for (const btn of placesMuniBtns) {
    btn.addEventListener('click', () => {
      drawerMuni = btn.dataset.muni;
      for (const b of placesMuniBtns) {
        b.classList.toggle('is-active', b === btn);
      }
      renderPlacesDirectory();
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

  if (copyCoordsBtn && copyLabelEl) {
    copyCoordsBtn.addEventListener('click', async () => {
      const gps = copyCoordsBtn.dataset.gps;
      if (!gps) return;
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(gps);
        } else {
          const ta = document.createElement('textarea');
          ta.value = gps;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          ta.remove();
        }
        copyCoordsBtn.classList.add('is-copied');
        copyLabelEl.textContent = 'Copied';
        if (copyTimer) clearTimeout(copyTimer);
        copyTimer = setTimeout(() => {
          copyCoordsBtn.classList.remove('is-copied');
          copyLabelEl.textContent = 'GPS';
        }, 1600);
      } catch {
        copyLabelEl.textContent = gps;
      }
    });
  }

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
      if (drawerOpen) {
        closePlacesDrawer();
      } else if (tourActive) {
        stopTour();
        closeSpot();
      } else if (!sheet.hidden) {
        closeSpot();
      }
    } else if (e.key === 'ArrowRight' && (!sheet.hidden || tourActive) && document.activeElement !== placesSearch) {
      stepSpot(1);
    } else if (e.key === 'ArrowLeft' && (!sheet.hidden || tourActive) && document.activeElement !== placesSearch) {
      stepSpot(-1);
    }
  });

  return {
    selectSpot,
    closeSpot,
    openPlacesDrawer,
    closePlacesDrawer,
    isDrawerOpen: () => drawerOpen,
    startTour,
    stopTour,
    getActiveFilter: () => activeFilter,
    getActiveSpotId: () => activeSpotId,
  };
}

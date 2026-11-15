const ORIGIN = { latitude: 22.2855625, longitude: 114.1347709 };
const MAP_CENTER = { latitude: ORIGIN.latitude, longitude: ORIGIN.longitude };
const $ = (id) => document.getElementById(id);
const apiUrl = (path) => new URL(`${location.pathname.includes('/static/') ? '../' : './'}api/${path}`, document.baseURI).toString();
const staticUrl = (path) => new URL(`./${path}`, document.baseURI).toString();
const state = { distanceMetres: 300, walkTimeSeconds: 300, slope: 30, stepSlope: 15, filter: 'all', view: 'map', mapStyle: 'detailed', massingStyle: 'diagram', reachStyle: 'diagram', places: [], google: false, isochrone: null, boundarySamples: 0, sectionPlaceId: null, map: null, maplibre: null, mapBasePaint: new Map(), tileset: null, clippingSignature: null, routeEntities: [], markerEntities: [], zoom: 1, pickOrigin: false, routeQueueRunning: false, routeQueueRequested: false, originVersion: 0, googleAnalysisVersion: 0, googleController: null, routeFailures: new Set(), boundaryCache: new Map(), boundaryRouteCache: new Map(), reachBlocksSignature: null };

function formatDistance(m) { return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`; }
function durationMinutes(p) { return p.duration_s != null ? p.duration_s / 60 : null; }
function routeGrade(p) { return Number(p.route_grade_deg ?? 0); }
function stepGrade(p) { return Number(p.max_step_slope_deg ?? p.max_slope_deg ?? 0); }
function accessible(p) { return Boolean(p.routeAnalysis && p.route_exists !== false && Number(p.duration_s) <= state.walkTimeSeconds && routeGrade(p) <= state.slope && stepGrade(p) <= state.stepSlope && p.accessible !== false); }
function status(p) {
  if (!p.routeAnalysis) return [p.routeError ? 'ROUTE UNAVAILABLE' : 'ROUTE PENDING', 'pending'];
  if (p.route_exists === false) return ['NO WALK ROUTE', 'outside'];
  if (p.accessible === false && !Number.isFinite(Number(p.duration_s))) return ['ROUTE UNAVAILABLE', 'pending'];
  if (Number(p.duration_s) > state.walkTimeSeconds) return ['OVER TIME', 'outside'];
  if (routeGrade(p) > state.slope) return [`${routeGrade(p).toFixed(1)}° ROUTE GRADE`, 'steep'];
  if (stepGrade(p) > state.stepSlope) return [`${stepGrade(p).toFixed(1)}° STEP GRADE`, 'steep'];
  return ['IN REACH', ''];
}
function updateSliderPaint(input) {
  const pct = ((Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min))) * 100;
  const color = input.id === 'distance' ? 'var(--rust)' : 'var(--pine)';
  input.style.background = `linear-gradient(to right,${color} 0%,${color} ${pct}%,#dcded5 ${pct}%,#dcded5 100%)`;
}
function candidateDistanceLimit() { return Math.min(4000, state.distanceMetres * 2); }
function candidatePlaces() { const limit = candidateDistanceLimit(); return state.places.filter(p => Number(p.study_distance_m) <= limit); }
function setRange(analyze = true) {
  const nextDistance = Number($('distance').value), nextSlope = Number($('slope').value), nextStepSlope = Number($('step-slope').value);
  if (nextDistance !== state.distanceMetres || nextSlope !== state.slope || nextStepSlope !== state.stepSlope) state.isochrone = null;
  state.distanceMetres = nextDistance; state.walkTimeSeconds = state.distanceMetres; state.slope = nextSlope; state.stepSlope = nextStepSlope;
  $('distance-value').textContent = state.distanceMetres; $('slope-value').textContent = state.slope; $('step-slope-value').textContent = state.stepSlope;
  $('walk-time').textContent = `${(state.walkTimeSeconds / 60).toFixed(state.walkTimeSeconds % 60 ? 1 : 0)} min`;
  $('caption-distance').textContent = Math.round(state.walkTimeSeconds / 60);
  $('caption-budget').textContent = `${formatDistance(state.distanceMetres)} at 1 m/s`;
  updateSliderPaint($('distance')); updateSliderPaint($('slope')); updateSliderPaint($('step-slope'));
  render();
  if (!analyze) {
    $('data-status').textContent = 'LIMIT CHANGED · RELEASE TO UPDATE WALK REACH';
    return;
  }
  fitReachView();
  if (state.google) scheduleGoogleAnalysis();
  else { renderMapLibreOverlays(); scheduleLandsDAnalysis(); }
}
function renderList() {
  const candidates = candidatePlaces();
  const visible = candidates.filter(p => state.filter === 'all' || p.kind === state.filter);
  $('place-list').innerHTML = visible.map(p => {
    const [label, cls] = status(p);
    const icon = p.kind === 'green' ? '♧' : '✳';
    const extra = p.routeAnalysis && (p.route_exists === false || (p.accessible === false && !Number.isFinite(Number(p.duration_s))))
      ? 'No connected pedestrian route was returned'
      : p.routeAnalysis
      ? `${Math.max(1, Math.round(durationMinutes(p)))} min · ${formatDistance(p.distance_m)} · ${routeGrade(p).toFixed(1)}° overall · ${stepGrade(p).toFixed(1)}° steepest step`
      : `CSDI location · ${formatDistance(p.study_distance_m)} study distance`;
    return `<div class="place-item ${accessible(p) ? 'is-accessible' : ''}" data-id="${escapeHtml(p.id)}"><span class="place-icon ${p.kind}">${icon}</span><span class="place-info"><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(extra)}</small></span><span class="place-status ${cls}">${escapeHtml(label)}</span></div>`;
  }).join('');
  $('place-total').textContent = String(candidates.length).padStart(2, '0');
  $('all-count').textContent = String(candidates.length).padStart(2, '0');
  $('green-count').textContent = String(candidates.filter(p => p.kind === 'green').length).padStart(2, '0');
  $('gym-count').textContent = String(candidates.filter(p => p.kind === 'gym').length).padStart(2, '0');
  $('candidate-extent').textContent = `Nearby seed points · within ${formatDistance(candidateDistanceLimit())} straight-line · routes decide reach`;
  document.querySelectorAll('.place-item').forEach(el => el.addEventListener('click', () => focusPlace(el.dataset.id)));
}
function linePath(p) {
  const [x, y] = p.xy; const [bx, by] = p.bend || [x, y];
  const d = `M 590 470 Q ${bx} ${by} ${x} ${y}`;
  const classes = accessible(p) ? 'route' : (routeGrade(p) > state.slope || stepGrade(p) > state.stepSlope ? 'route route-steep' : 'route route-outside');
  return `<path class="${classes}" data-route="${p.id}" d="${d}"/>`;
}
function pinMarkup(p) {
  const [x, y] = p.xy;
  const cls = p.kind === 'green' ? 'green-dot' : 'gym-dot';
  const glyph = p.kind === 'green' ? '♧' : '✳';
  const [label, statusClass] = status(p);
  const opacity = Number(p.duration_s) > state.walkTimeSeconds || routeGrade(p) > state.slope || stepGrade(p) > state.stepSlope ? '.48' : '1';
  return `<g class="place-pin" data-id="${p.id}" opacity="${opacity}" transform="translate(${x} ${y})"><circle class="pin-halo" r="15"/><circle class="pin-dot ${cls}" r="9"/><text text-anchor="middle" y="3.5" fill="white" font-size="10">${glyph}</text><text class="pin-label" x="13" y="-8">${p.name}</text>${statusClass === 'steep' ? `<text x="13" y="7" fill="#a24634" font-size="8" font-family="DM Mono">${routeGrade(p) > state.slope ? 'ROUTE' : 'STEP'} ${routeGrade(p) > state.slope ? routeGrade(p).toFixed(1) : stepGrade(p).toFixed(1)}°</text>` : ''}</g>`;
}
function render() { renderList(); renderCesiumOverlays(); renderMapLibreOverlays(); renderSectionMap(); }
function pointFromFeature(feature) {
  const geom = feature.geometry; if (!geom) return null;
  if (geom.type === 'Point') return geom.coordinates;
  const ring = geom.type === 'Polygon' ? geom.coordinates?.[0] : geom.type === 'MultiPolygon' ? geom.coordinates?.[0]?.[0] : null;
  if (!ring?.length) return null;
  return [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];
}
async function loadAccessPoints() {
  try {
    const collection = await fetch(staticUrl('data/access-points.geojson')).then(r => { if (!r.ok) throw new Error('CSDI GeoJSON not available'); return r.json(); });
    const loaded = (collection.features || []).map((feature, i) => {
      const coordinates = pointFromFeature(feature); if (!coordinates) return null;
      const properties = feature.properties || {};
      const kind = properties.kind === 'gym' || /fitness|exercise|gym/i.test(String(properties.kind || properties.facility_type || properties.category || '')) ? 'gym' : 'green';
      const id = String(feature.id || properties.id || `${kind}-${i + 1}`);
      const dlon = coordinates[0] - ORIGIN.longitude, dlat = coordinates[1] - ORIGIN.latitude;
      return { ...properties, id, name: String(properties.name || `Public ${kind === 'gym' ? 'fitness point' : 'open space'} ${i + 1}`), kind, coordinates, study_distance_m: haversineMetres([ORIGIN.longitude, ORIGIN.latitude], coordinates) };
    }).filter(Boolean);
    if (!loaded.length) return;
    state.places = loaded; render();
    $('data-status').textContent = `CSDI HONG KONG DATA · ${loaded.length} LOCATIONS`;
    $('map-data-label').textContent = 'CSDI LOCATIONS · ROUTES PENDING';
    state.sectionPlaceId = null;
    render();
  } catch (error) { $('data-status').textContent = 'HONG KONG DATA UNAVAILABLE'; $('map-data-label').textContent = 'DESTINATION DATA NOT LOADED'; console.error('Could not load CSDI access locations.', error); }
}
function focusPlace(id) {
  const place = state.places.find(p => p.id === id); if (!place) return;
  state.sectionPlaceId = id;
  renderSectionMap();
  $('place-list').querySelector(`[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  showToast(place.routeAnalysis ? `${place.name} · ${Math.max(1, Math.round(durationMinutes(place)))} min walking route` : `${place.name} · walking route is pending`);
  const coordinates = place.coordinates;
  if (state.view !== 'map' && state.map && coordinates) state.map.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(coordinates[0], coordinates[1], 950), duration: 1.2 });
  if (state.maplibre && coordinates && (state.view === 'map' || !state.map)) state.maplibre.flyTo({ center: coordinates, zoom: 17, pitch: state.view === 'map' ? 0 : 48, duration: 1000 });
}
let toastTimer;
function showToast(message) { const el = $('toast'); el.textContent = message; el.classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('visible'), 2300); }
function currentStyle() { return state.view === 'map' ? state.mapStyle : state.view === 'massing' ? state.massingStyle : state.reachStyle; }
function setMapStyle(style) {
  if (state.view === 'map') state.mapStyle = style;
  else if (state.view === 'massing') state.massingStyle = style;
  else if (state.view === 'reach') state.reachStyle = style;
  document.querySelectorAll('.style-option').forEach(button => {
    const selected = button.dataset.style === style;
    button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected));
  });
  applyPresentation();
}
function setView(mode) {
  state.view = mode;
  if (mode === 'section') {
    document.querySelector('.map-shell').classList.add('section-mode');
    $('map-data-label').textContent = '3D ROUTE ELEVATION PROFILE';
    $('section-panel').hidden = false;
    document.querySelectorAll('.view-option').forEach(b => { b.classList.toggle('selected', false); b.setAttribute('aria-pressed','false'); });
    renderSectionMap(); return;
  }
  document.querySelector('.map-shell').classList.remove('section-mode');
  $('section-panel').hidden = true;
  document.querySelectorAll('.view-option').forEach(b => {
    const selected = b.dataset.view === mode;
    b.classList.toggle('selected', selected); b.setAttribute('aria-pressed', String(selected));
  });
  setMapStyle(currentStyle());
}
function applyPresentation() {
  const style = currentStyle(), view = state.view, threeD = view !== 'map';
  const useCesium = threeD && style === 'detailed' && Boolean(state.map);
  $('cesium-container').style.display = useCesium ? 'block' : 'none';
  $('maplibre-container').style.display = useCesium || !state.maplibre ? 'none' : 'block';
  const shell = document.querySelector('.map-shell');
  shell.classList.toggle('diagram-mode', style === 'diagram');
  shell.classList.toggle('reach-mode', view === 'reach');
  if ($('reach-legend')) $('reach-legend').hidden = view === 'massing';
  if ($('reach-area-label')) $('reach-area-label').textContent = view === 'reach' && style === 'diagram' ? 'Reachable building blocks' : 'Reachable area';
  const presentationName = view === 'map' ? '2D City' : view === 'massing' ? '3D City' : '3D Reach';
  const styleName = view === 'map' ? (style === 'detailed' ? 'Colored street map' : 'Simplified route diagram')
    : view === 'massing' ? (style === 'detailed' ? 'Textured 3D city' : 'Building massing + routes')
      : (style === 'detailed' ? 'Detailed city + reach overlay' : 'Carved reach + highlighted routes');
  $('presentation-title').textContent = `${presentationName} · ${styleName}`;
  if ($('style-detailed-label')) $('style-detailed-label').textContent = view === 'map' ? 'Colored map' : view === 'massing' ? 'Textured 3D' : 'Detailed render';
  if ($('style-diagram-label')) $('style-diagram-label').textContent = view === 'map' ? 'Diagram' : view === 'massing' ? 'Massing' : 'Carved buffer';
  const detailFallback = $('detail-fallback');
  if (detailFallback) detailFallback.hidden = !(threeD && style === 'detailed' && !state.map);
  if (state.maplibre) {
    const map = state.maplibre;
    for (const layer of map.getStyle().layers) {
      if (layer.id === '3d-buildings-context') {
        map.setLayoutProperty(layer.id, 'visibility', threeD && view === 'reach' && style === 'diagram' ? 'visible' : 'none');
        map.setPaintProperty(layer.id, 'fill-extrusion-color', '#f7f7f4');
        map.setPaintProperty(layer.id, 'fill-extrusion-opacity', .98);
      } else if (layer.id === '3d-buildings') {
        map.setLayoutProperty(layer.id, 'visibility', threeD ? 'visible' : 'none');
        map.setPaintProperty(layer.id, 'fill-extrusion-color', view === 'reach' && style === 'diagram' ? '#bed8c7' : style === 'diagram' ? '#e5e4dc' : '#aebcac');
        map.setPaintProperty(layer.id, 'fill-extrusion-opacity', .94);
      } else if (layer.id === 'reach-mask-fill') {
        map.setLayoutProperty(layer.id, 'visibility', view === 'reach' && style === 'diagram' ? 'visible' : 'none');
        map.setPaintProperty(layer.id, 'fill-color', '#f6f6f2');
        map.setPaintProperty(layer.id, 'fill-opacity', .84);
      } else if (layer.id === 'reach-block-buildings') {
        map.setLayoutProperty(layer.id, 'visibility', view === 'reach' && style === 'diagram' ? 'visible' : 'none');
        map.setPaintProperty(layer.id, 'fill-extrusion-color', '#bed8c7');
        map.setPaintProperty(layer.id, 'fill-extrusion-opacity', .98);
      } else if (layer.id.startsWith('walk-buffer-')) {
        const showGroundFill = !(view === 'reach' && style === 'diagram' && layer.id === 'walk-buffer-fill');
        map.setLayoutProperty(layer.id, 'visibility', (view === 'reach' || view === 'map') && showGroundFill ? 'visible' : 'none');
        if (layer.id === 'walk-buffer-fill') {
          map.setPaintProperty(layer.id, 'fill-color', style === 'diagram' ? '#b9ddc8' : '#7eb297');
          map.setPaintProperty(layer.id, 'fill-opacity', style === 'diagram' ? .62 : .35);
        }
        if (layer.id === 'walk-buffer-outline') {
          map.setPaintProperty(layer.id, 'line-color', '#276d5d');
          map.setPaintProperty(layer.id, 'line-width', style === 'diagram' ? 3.5 : 2.5);
          map.setPaintProperty(layer.id, 'line-dasharray', [1, 0]);
        }
      } else if (!['accessible-route-casing','accessible-routes','access-place-points','access-place-labels','origin-point','origin-label'].includes(layer.id)) {
        const original = state.mapBasePaint.get(layer.id);
        if (style === 'diagram' && layer.type === 'symbol') map.setLayoutProperty(layer.id, 'visibility', 'none');
        else if (original) map.setLayoutProperty(layer.id, 'visibility', original.visibility);
        if (style === 'diagram' && layer.type === 'fill' && layer.paint?.['fill-color']) {
          const id = layer.id.toLowerCase();
          map.setPaintProperty(layer.id, 'fill-color', id.includes('water') ? (style === 'diagram' ? '#dce5e5' : '#bfd2d0') : id.includes('park') || id.includes('grass') ? (style === 'diagram' ? '#e6eee4' : '#dce6d9') : style === 'diagram' ? '#eeede6' : '#d9ddd4');
        } else if (style !== 'diagram' && original?.fillColor !== undefined && layer.type === 'fill') map.setPaintProperty(layer.id, 'fill-color', original.fillColor);
        if (style === 'diagram' && layer.type === 'line' && layer.paint?.['line-color']) map.setPaintProperty(layer.id, 'line-color', '#c7c9c1');
        else if (style !== 'diagram' && original?.lineColor !== undefined && layer.type === 'line') map.setPaintProperty(layer.id, 'line-color', original.lineColor);
      }
    }
    if (!(view === 'reach' && ['Polygon','MultiPolygon'].includes(state.isochrone?.geometry?.type))) map.flyTo({ center: [ORIGIN.longitude, ORIGIN.latitude], zoom: threeD ? 16.7 : 15.6, pitch: threeD ? 48 : 0, bearing: threeD && style === 'detailed' ? -12 : 0, duration: 550 });
    requestAnimationFrame(() => { map.resize(); if (view === 'reach' && ['Polygon','MultiPolygon'].includes(state.isochrone?.geometry?.type)) fitReachView(); });
  }
  if (state.map) {
    state.map.scene.screenSpaceCameraController.enableTilt = threeD;
    syncCesiumReachClip();
    if (view === 'reach' && ['Polygon','MultiPolygon'].includes(state.isochrone?.geometry?.type)) fitReachView();
    else state.map.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(ORIGIN.longitude, ORIGIN.latitude, threeD ? Math.max(700, state.distanceMetres * 3.2) : 1750), orientation: { heading: 0, pitch: Cesium.Math.toRadians(threeD ? -50 : -72), roll: 0 }, duration: .6 });
  }
  $('map-data-label').textContent = view === 'map' ? `2D CITY · ${styleName.toUpperCase()} · WALK BUFFER` : view === 'massing' ? `3D CITY · ${styleName.toUpperCase()} · ACCESS ROUTES` : `3D REACH · ${styleName.toUpperCase()} · ${state.boundarySamples}/24 SAMPLE DIRECTIONS`;
  renderMapLibreOverlays(); renderCesiumOverlays();
}

function syncCesiumReachClip() {
  if (!state.tileset) return;
  // Keep the detailed city visible for orientation. The reach area is an
  // overlay so buildings inside and around it remain visible together.
  if (state.tileset.clippingPolygons) state.tileset.clippingPolygons = undefined;
  state.clippingSignature = null;
}

function fitReachView() {
  const geometry = state.isochrone?.geometry;
  const rings = geometry?.type === 'Polygon' ? [geometry.coordinates[0]] : geometry?.type === 'MultiPolygon' ? geometry.coordinates.map(polygon => polygon[0]) : [];
  const pointsInReach = rings.flatMap(ring => ring.slice(0, -1));
  if (!pointsInReach.length) return;
  if (state.map && state.view === 'reach' && state.reachStyle === 'detailed') {
    const points = pointsInReach.map(point => Cesium.Cartesian3.fromDegrees(point[0], point[1], Number(point[2]) || 0));
    const sphere = Cesium.BoundingSphere.fromPoints(points);
    const range = Math.max(450, sphere.radius * 2.8);
    state.map.camera.flyToBoundingSphere(sphere, { duration: .7, offset: new Cesium.HeadingPitchRange(Cesium.Math.toRadians(-12), Cesium.Math.toRadians(-48), range) });
  }
  if (state.maplibre && state.view === 'reach' && (!state.map || state.reachStyle === 'diagram')) {
    const bounds = new maplibregl.LngLatBounds();
    pointsInReach.forEach(point => bounds.extend([point[0], point[1]]));
    state.maplibre.fitBounds(bounds, { padding: { top: 105, right: 85, bottom: 150, left: 85 }, maxZoom: 16.8, duration: 700, pitch: 38, bearing: 0 });
  }
  if (state.maplibre && state.view === 'map') {
    const bounds = new maplibregl.LngLatBounds();
    pointsInReach.forEach(point => bounds.extend([point[0], point[1]]));
    state.maplibre.fitBounds(bounds, { padding: { top: 95, right: 80, bottom: 100, left: 80 }, maxZoom: 17.5, duration: 650, pitch: 0, bearing: 0 });
  }
}

function renderCesiumOverlays() {
  if (!state.map) return;
  syncCesiumReachClip();
  for (const entity of [...state.routeEntities, ...state.markerEntities]) state.map.entities.remove(entity);
  state.routeEntities = []; state.markerEntities = [];
  const originRoute = state.places.find(p => p.path?.length && Number.isFinite(Number(p.path[0][2])))?.path;
  const originHeight = originRoute ? Number(originRoute[0][2]) : 20;
  const originHeightReference = originRoute ? Cesium.HeightReference.NONE : Cesium.HeightReference.CLAMP_TO_GROUND;
  const origin = state.map.entities.add({ position: Cesium.Cartesian3.fromDegrees(ORIGIN.longitude, ORIGIN.latitude, originHeight), point: { pixelSize: 12, color: Cesium.Color.fromCssColorString('#cb5237'), outlineColor: Cesium.Color.WHITE, outlineWidth: 3, heightReference: originHeightReference }, label: { text: 'COMMUNITY CENTRE', font: '12px DM Sans', pixelOffset: new Cesium.Cartesian2(16, -12), fillColor: Cesium.Color.fromCssColorString('#9e4535'), outlineColor: Cesium.Color.WHITE, outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, heightReference: originHeightReference } });
  state.markerEntities.push(origin);
  const ring = (state.view === 'reach' || state.view === 'map') ? state.isochrone?.geometry : null;
  const reachPolygons = ring?.type === 'Polygon' ? [ring.coordinates] : ring?.type === 'MultiPolygon' ? ring.coordinates : [];
  for (const polygonCoordinates of reachPolygons) {
    const coordinates = polygonCoordinates[0];
    const hasElevation = coordinates.every(c => c.length > 2 && Number.isFinite(Number(c[2])));
    const hierarchy = hasElevation
      ? Cesium.Cartesian3.fromDegreesArrayHeights(coordinates.flatMap(c => [c[0], c[1], Number(c[2])]))
      : Cesium.Cartesian3.fromDegreesArray(coordinates.flatMap(c => c.slice(0, 2)));
    const polygon = { hierarchy, material: Cesium.Color.fromCssColorString('#cb5237').withAlpha(.32), outline: true, outlineColor: Cesium.Color.fromCssColorString('#a94732').withAlpha(.98), outlineWidth: 3 };
    if (hasElevation) polygon.perPositionHeight = true;
    else polygon.height = 8;
    state.routeEntities.push(state.map.entities.add({ polygon }));
  }
  for (const p of state.places) {
    if (!accessible(p) || !p.path?.length) continue;
    const path = p.path;
    const pos = path.map(c => Cesium.Cartesian3.fromDegrees(c[0], c[1], c[2] ?? 20));
    const route = state.map.entities.add({ polyline: { positions: pos, width: 4, material: Cesium.Color.fromCssColorString('#276d5d'), clampToGround: false } });
    state.routeEntities.push(route);
    const end = path[path.length - 1];
    const endpointHeightReference = Number.isFinite(Number(end[2])) ? Cesium.HeightReference.NONE : Cesium.HeightReference.CLAMP_TO_GROUND;
    const marker = state.map.entities.add({ position: Cesium.Cartesian3.fromDegrees(end[0], end[1], end[2] ?? 24), point: { pixelSize: 9, color: Cesium.Color.fromCssColorString(p.kind === 'green' ? '#276d5d' : '#ca974b'), outlineColor: Cesium.Color.WHITE, outlineWidth: 2, heightReference: endpointHeightReference }, label: { text: p.name, font: '11px DM Sans', pixelOffset: new Cesium.Cartesian2(12, -8), fillColor: Cesium.Color.fromCssColorString('#26302a'), outlineColor: Cesium.Color.WHITE, outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, heightReference: endpointHeightReference, show: true } });
    state.markerEntities.push(marker);
  }
}
function mapLibreLayersReady() { return state.maplibre && state.maplibre.isStyleLoaded() && state.maplibre.getSource('access-routes'); }
function renderSectionMap() {
  const host = $('section-panel'); if (!host) return;
  const selected = state.places.find(p => p.id === state.sectionPlaceId);
  const place = selected || state.places.find(p => accessible(p) && p.path?.length) || state.places.find(p => p.routeAnalysis && p.path?.length) || state.places[0];
  if (!place) { host.innerHTML = '<div class="section-empty">CSDI destination locations are loading.</div>'; return; }
  if (!place.routeAnalysis || !place.path?.length) { host.innerHTML = `<div class="section-empty">${escapeHtml(place.name)}<br/><small>Request a route to see the 3D elevation profile. The profile uses Lands Department 3D pedestrian-network heights.</small></div>`; return; }
  const path = place.path;
  const distances = [0];
  for (let i = 1; i < path.length; i++) {
    const dx = (path[i][0] - path[i - 1][0]) * 102000, dy = (path[i][1] - path[i - 1][1]) * 111000;
    distances.push(distances[i - 1] + Math.hypot(dx, dy));
  }
  const total = Math.max(distances.at(-1) || 1, 1), elevations = path.map(p => Number(p[2] ?? 0));
  const minElevation = Math.min(...elevations), maxElevation = Math.max(...elevations), span = Math.max(maxElevation - minElevation, 2);
  const profile = path.map((p, i) => {
    const t = distances[i] / total, gradeY = 284 - t * 48 - ((elevations[i] - minElevation) / span) * 112;
    return { x: 122 + t * 710, y: gradeY, elevation: elevations[i], t };
  });
  const top = profile.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const first = profile[0], last = profile.at(-1), accepted = accessible(place);
  const gradeText = `${routeGrade(place).toFixed(1)}° route grade · ${stepGrade(place).toFixed(1)}° max step`;
  const routeSource = escapeHtml(place.route_source || 'Lands Department 3D pedestrian network');
  const markers = profile.filter((_, i) => i === 0 || i === profile.length - 1 || i % Math.max(1, Math.floor(profile.length / 7)) === 0).map((p, i) => `<circle cx="${p.x}" cy="${p.y}" r="${i === 0 || p === last ? 8 : 4}" fill="${i === 0 ? '#c94f37' : p === last ? '#287461' : '#f9f8f1'}" stroke="${i === 0 ? '#fff' : '#287461'}" stroke-width="3"/>`).join('');
  const lines = `<svg viewBox="0 0 960 520" role="img" aria-label="Terrain section from the community centre to ${escapeHtml(place.name)}"><defs><linearGradient id="sectionGround" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c9d6bd"/><stop offset="1" stop-color="#e7e6d9"/></linearGradient><linearGradient id="sectionCut" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#aabd9e"/><stop offset="1" stop-color="#738a75"/></linearGradient></defs><path d="M76 255 840 212 918 264 151 315Z" fill="#ebeee2" stroke="#adb8a5"/><path d="M151 315 918 264 918 351 151 405Z" fill="#d4d8ca" stroke="#adb8a5"/><path d="M${top} L${last.x.toFixed(1)} ${(last.y + 112).toFixed(1)} L${first.x.toFixed(1)} ${(first.y + 112).toFixed(1)}Z" fill="url(#sectionCut)" stroke="#667c68" stroke-width="2"/><path d="M${top}" fill="none" stroke="#f7f7ed" stroke-width="17" stroke-linejoin="round"/><path d="M${top}" fill="none" stroke="${accepted ? '#176d5a' : '#bb4c37'}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>${markers}<path d="M102 416h750" stroke="#858e83" stroke-dasharray="5 7"/><path d="M102 408v16m750-16v16" stroke="#858e83"/><text x="102" y="449" class="section-svg-label">0 m · COMMUNITY CENTRE</text><text x="850" y="449" text-anchor="end" class="section-svg-label">${escapeHtml(formatDistance(place.distance_m || total))} · ${escapeHtml(place.name)}</text><text x="76" y="242" class="section-svg-label">ELEVATION</text><text x="76" y="260" class="section-svg-small">${Math.round(minElevation)} m</text><text x="76" y="282" class="section-svg-small">${Math.round(maxElevation)} m</text><rect x="625" y="82" width="234" height="44" rx="3" fill="#fffdf6" stroke="#dadbd2"/><circle cx="647" cy="104" r="6" fill="${accepted ? '#287461' : '#bd4c38'}"/><text x="663" y="109" class="section-svg-label">${accepted ? 'WITHIN WALKING THRESHOLD' : 'OUTSIDE ACCESS THRESHOLD'}</text><text x="122" y="478" class="section-svg-small">3D NETWORK ELEVATION · ${routeSource}</text><text x="840" y="478" text-anchor="end" class="section-svg-label">${gradeText} · ${Math.max(1, Math.round(durationMinutes(place)))} min</text></svg>`;
  host.innerHTML = `<div class="section-heading"><span><b>ROUTE SECTION</b><small>Cutaway profile to the selected place</small></span><span class="section-place-name">${escapeHtml(place.name)}</span></div>${lines}`;
}
function renderMapLibreOverlays() {
  const map = state.maplibre; if (!map || !map.getSource('access-routes')) return;
  const buildingBaseFilter = ['!=', ['get', 'hide_3d'], true];
  const reachGeometry = state.view === 'reach' ? state.isochrone?.geometry : null;
  const hasReachGeometry = ['Polygon','MultiPolygon'].includes(reachGeometry?.type);
  if (state.view === 'reach' && state.reachStyle === 'diagram' && hasReachGeometry) {
    map.setFilter('3d-buildings-context', ['all', buildingBaseFilter, ['!', ['within', reachGeometry]]]);
    map.setFilter('3d-buildings', ['all', buildingBaseFilter, ['within', reachGeometry]]);
  } else {
    map.setFilter('3d-buildings-context', buildingBaseFilter);
    map.setFilter('3d-buildings', buildingBaseFilter);
  }
  const inReach = state.places.filter(p => accessible(p) && (state.filter === 'all' || p.kind === state.filter));
  const routes = inReach.filter(p => p.path?.length).map(p => ({ type: 'Feature', properties: { id: p.id, name: p.name, kind: p.kind }, geometry: { type: 'LineString', coordinates: p.path.map(c => c.slice(0, 2)) } }));
  const places = inReach.filter(p => p.coordinates).map(p => {
    const position = p.coordinates;
    return { type: 'Feature', properties: { id: p.id, name: p.name, kind: p.kind }, geometry: { type: 'Point', coordinates: position } };
  });
  const routeData = { type: 'FeatureCollection', features: routes };
  const placeData = { type: 'FeatureCollection', features: places };
  const bufferData = { type: 'FeatureCollection', features: state.isochrone && (state.view === 'reach' || state.view === 'map') ? [state.isochrone] : [] };
  const extent = Array.from({length: 8}, (_, i) => radialDestination(ORIGIN, 12000, i * 45)); extent.push(extent[0]);
  const signedArea = ring => ring.slice(0, -1).reduce((area, point, i) => { const next = ring[i + 1]; return area + point[0] * next[1] - next[0] * point[1]; }, 0) / 2;
  if (signedArea(extent) < 0) extent.reverse();
  const maskGeometry = state.isochrone?.geometry;
  const innerRings = maskGeometry?.type === 'Polygon'
    ? [maskGeometry.coordinates[0].map(point => point.slice())]
    : maskGeometry?.type === 'MultiPolygon'
      ? maskGeometry.coordinates.map(polygon => polygon[0].map(point => point.slice()))
      : [];
  innerRings.forEach(ring => { if (signedArea(ring) > 0) ring.reverse(); });
  const reachMask = innerRings.length ? { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [extent, ...innerRings] } } : null;
  const maskData = { type: 'FeatureCollection', features: reachMask ? [reachMask] : [] };
  const originData = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: 'Western District Elderly Community Centre' }, geometry: { type: 'Point', coordinates: [ORIGIN.longitude, ORIGIN.latitude] } }] };
  map.getSource('access-routes')?.setData(routeData); map.getSource('access-places')?.setData(placeData); map.getSource('walk-buffer')?.setData(bufferData); map.getSource('reach-mask')?.setData(maskData); map.getSource('map-origin')?.setData(originData);
  scheduleReachBuildingUpdate();
  if (map.getLayer('reach-mask-fill') && map.getLayer('3d-buildings-context')) map.moveLayer('reach-mask-fill', '3d-buildings-context');
  const boundaryText = $('reach-boundary-status');
  if (boundaryText) boundaryText.textContent = state.isochrone
    ? `${state.isochrone.properties.sample_count}/${state.isochrone.properties.requested_samples} sampled directions pass the ${Math.round(state.walkTimeSeconds / 60)} min walk-time, ${state.slope}° route-grade and ${state.stepSlope}° next-step limits.`
    : 'Waiting for walking-route samples';
  renderMapLibreSvgRoutes();
}
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
function polygonParts(geometry) {
  if (geometry?.type === 'Polygon') return [geometry.coordinates];
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}
function pointInRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / ((b[1] - a[1]) || Number.EPSILON) + a[0]) inside = !inside;
  }
  return inside;
}
function pointInPolygon(point, polygon) {
  return Boolean(polygon?.[0]?.length && pointInRing(point, polygon[0]) && !polygon.slice(1).some(hole => pointInRing(point, hole)));
}
function segmentsCross(a, b, c, d) {
  const cross = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const onSegment = (p, q, r) => r[0] >= Math.min(p[0], q[0]) - 1e-10 && r[0] <= Math.max(p[0], q[0]) + 1e-10 && r[1] >= Math.min(p[1], q[1]) - 1e-10 && r[1] <= Math.max(p[1], q[1]) + 1e-10;
  const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
  if (((abC > 0 && abD < 0) || (abC < 0 && abD > 0)) && ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))) return true;
  return (Math.abs(abC) < 1e-10 && onSegment(a, b, c)) || (Math.abs(abD) < 1e-10 && onSegment(a, b, d)) || (Math.abs(cdA) < 1e-10 && onSegment(c, d, a)) || (Math.abs(cdB) < 1e-10 && onSegment(c, d, b));
}
function polygonsTouch(a, b) {
  if (!a?.[0]?.length || !b?.[0]?.length) return false;
  const ar = a[0], br = b[0];
  if (ar.some(point => pointInPolygon(point, b)) || br.some(point => pointInPolygon(point, a))) return true;
  for (let i = 0; i < ar.length - 1; i += 1) for (let j = 0; j < br.length - 1; j += 1) {
    if (segmentsCross(ar[i], ar[i + 1], br[j], br[j + 1])) return true;
  }
  return false;
}
function geometriesTouch(a, b) {
  return polygonParts(a).some(first => polygonParts(b).some(second => polygonsTouch(first, second)));
}
let reachBlockUpdateTimer;
function scheduleReachBuildingUpdate() {
  clearTimeout(reachBlockUpdateTimer);
  reachBlockUpdateTimer = setTimeout(updateReachBuildingBlocks, 120);
}
function updateReachBuildingBlocks() {
  const map = state.maplibre, source = map?.getSource('reach-block-buildings');
  if (!source) return;
  const geometry = state.isochrone?.geometry;
  if (!(state.view === 'reach' && state.reachStyle === 'diagram') || !['Polygon', 'MultiPolygon'].includes(geometry?.type)) {
    if (state.reachBlocksSignature !== 'off') { source.setData({ type: 'FeatureCollection', features: [] }); state.reachBlocksSignature = 'off'; }
    return;
  }
  let tiles = [];
  try { tiles = map.querySourceFeatures('openfreemap', { sourceLayer: 'building', filter: ['!=', ['get', 'hide_3d'], true] }); }
  catch (error) { console.warn('OpenFreeMap building footprints are not ready.', error); }
  const seen = new Set();
  const selected = tiles.filter(feature => {
    if (!feature.geometry || !geometriesTouch(feature.geometry, geometry)) return false;
    const key = JSON.stringify(feature.geometry.coordinates);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).map(feature => ({
    type: 'Feature',
    properties: { render_height: Number(feature.properties?.render_height) || 15, render_min_height: Number(feature.properties?.render_min_height) || 0 },
    geometry: feature.geometry,
  }));
  const signature = `${state.originVersion}/${state.distanceMetres}/${state.slope}/${state.stepSlope}/${selected.length}/${[...seen].join('|')}`;
  if (signature === state.reachBlocksSignature) return;
  source.setData({ type: 'FeatureCollection', features: selected });
  state.reachBlocksSignature = signature;
}
function haversineMetres(a, b) {
  const rad = Math.PI / 180, phi1 = a[1] * rad, phi2 = b[1] * rad;
  const dPhi = (b[1] - a[1]) * rad, dLambda = (b[0] - a[0]) * rad;
  const h = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
function buildLandsDStops(place, origin) {
  const point = (name, longitude, latitude) => ({ attributes: { Name: name }, geometry: { spatialReference: { latestWkid: 4326 }, x: longitude, y: latitude, z: 0 } });
  return { features: [point('Western District Elderly Community Centre', origin.longitude, origin.latitude), point(place.name, place.coordinates[0], place.coordinates[1])] };
}
async function landsDRoute(place, origin) {
  const params = new URLSearchParams({ stops: JSON.stringify(buildLandsDStops(place, origin)), travelMode: '1', directionsLanguage: 'en', directionsLengthUnits: 'esriNAUMeters', outSR: '4326', f: 'json', returnZ: 'true', directionStyleName: 'NA Campus' });
  const response = await fetch(`https://mapapi.hkmapservice.gov.hk/PedRoute/NAServer/route/solve?${params}`, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Lands Department route service returned ${response.status}`);
  const payload = await response.json();
  const feature = payload.routes?.features?.[0];
  if (!feature) return { route_exists: false, routeAnalysis: true, route_source: 'Lands Department 3D Pedestrian Network' };
  const paths = feature.geometry?.paths || [];
  const rawPath = paths.flat().map(c => [Number(c[0]), Number(c[1]), Number(c[2])]);
  const path = rawPath.filter((c, i) => i === 0 || c[0] !== rawPath[i - 1][0] || c[1] !== rawPath[i - 1][1] || c[2] !== rawPath[i - 1][2]);
  if (path.length < 2 || path.some(c => !c.every(Number.isFinite))) throw new Error('3D route elevation samples are missing');
  const slopes = path.slice(1).map((c, i) => Math.atan2(Math.abs(c[2] - path[i][2]), Math.max(.5, haversineMetres(path[i], c))) * 180 / Math.PI);
  const routeLength = path.slice(1).reduce((sum, point, i) => sum + haversineMetres(path[i], point), 0);
  const totalRouteGrade = Math.atan2(Math.abs(path.at(-1)[2] - path[0][2]), Math.max(.5, routeLength)) * 180 / Math.PI;
  const summary = payload.directions?.[0]?.summary || {};
  const attrs = feature.attributes || {};
  const minutes = Number(summary.totalTime ?? attrs.Total_Time);
  const distance = Number(summary.totalLength ?? attrs.Total_Length);
  if (!Number.isFinite(minutes) || !Number.isFinite(distance)) throw new Error('Route service returned no walking time or distance');
  const maxStepSlope = Math.round(Math.max(...slopes) * 10) / 10;
  return { routeAnalysis: true, route_exists: true, accessible: true, route_source: 'Lands Department 3D Pedestrian Network', duration_s: Math.round(minutes * 60), distance_m: distance, route_grade_deg: Math.round(totalRouteGrade * 10) / 10, max_step_slope_deg: maxStepSlope, max_slope_deg: maxStepSlope, path };
}
function radialDestination(origin, metres, bearing) {
  const angle = bearing * Math.PI / 180, north = metres * Math.cos(angle), east = metres * Math.sin(angle);
  return [origin.longitude + east / (111320 * Math.cos(origin.latitude * Math.PI / 180)), origin.latitude + north / 111320];
}
function accessiblePrefixEndpoint(path, radius, maxRouteSlope, maxStepSlope, routeDurationSeconds, timeBudgetSeconds) {
  if (!path || path.length < 2) return null;
  const routeLength = path.slice(1).reduce((sum, point, i) => sum + Math.max(.5, haversineMetres(path[i], point)), 0);
  const timeLimitedDistance = routeLength * Math.min(1, timeBudgetSeconds / Math.max(routeDurationSeconds, 1));
  const endpointDistance = Math.min(radius, timeLimitedDistance);
  let travelled = 0;
  for (let i = 1; i < path.length; i++) {
    const previous = path[i - 1], next = path[i], segment = Math.max(.5, haversineMetres(previous, next));
    const grade = Math.atan2(Math.abs(next[2] - previous[2]), segment) * 180 / Math.PI;
    const cumulativeGrade = Math.atan2(Math.abs(next[2] - path[0][2]), Math.max(.5, travelled + segment)) * 180 / Math.PI;
    if (grade > maxStepSlope || cumulativeGrade > maxRouteSlope) return travelled >= 20 ? previous : null;
    if (travelled + segment >= endpointDistance) {
      const t = Math.max(0, Math.min(1, (endpointDistance - travelled) / segment));
      return [previous[0] + (next[0] - previous[0]) * t, previous[1] + (next[1] - previous[1]) * t, previous[2] + (next[2] - previous[2]) * t];
    }
    travelled += segment;
  }
  return travelled >= endpointDistance * .7 ? path[path.length - 1] : null;
}
function sampledReachGeometry(boundary, sampleCount, origin) {
  const step = 360 / sampleCount;
  const pointsBySpoke = new Map(boundary.map(point => [Math.round(point.bearing / step) % sampleCount, point.coordinate]));
  if (pointsBySpoke.size === sampleCount) {
    const ring = Array.from({ length: sampleCount }, (_, i) => pointsBySpoke.get(i).slice());
    ring.push(ring[0]);
    return { type: 'Polygon', coordinates: [ring] };
  }
  const valid = new Set(pointsBySpoke.keys()), starts = [...valid].filter(i => !valid.has((i - 1 + sampleCount) % sampleCount));
  const sectors = [];
  const originHeights = boundary.map(point => point.originElevation).filter(Number.isFinite);
  const originHeight = originHeights.length ? originHeights.reduce((sum, height) => sum + height, 0) / originHeights.length : 0;
  for (const start of starts) {
    const run = [start];
    while (valid.has((run.at(-1) + 1) % sampleCount) && (run.at(-1) + 1) % sampleCount !== start) run.push((run.at(-1) + 1) % sampleCount);
    const center = [origin.longitude, origin.latitude, originHeight];
    let ring;
    if (run.length === 1) {
      // Preserve an isolated safe bearing as its 15-degree sample cell.
      const index = run[0], point = pointsBySpoke.get(index), radius = haversineMetres([origin.longitude, origin.latitude], point);
      const left = radialDestination(origin, radius, (index - .5) * step), right = radialDestination(origin, radius, (index + .5) * step);
      ring = [center, [left[0], left[1], point[2] ?? originHeight], point.slice(), [right[0], right[1], point[2] ?? originHeight], center];
    } else ring = [center, ...run.map(i => pointsBySpoke.get(i).slice()), center];
    sectors.push([ring]);
  }
  return sectors.length ? { type: 'MultiPolygon', coordinates: sectors } : null;
}
async function buildLandsDContour(origin, originVersion) {
  if (state.google) return;
  const distanceMetres = state.distanceMetres, maxSlope = state.slope, maxStepSlope = state.stepSlope;
  const walkTimeSeconds = state.walkTimeSeconds;
  const cacheKey = `${originVersion}/${walkTimeSeconds}/${maxSlope}/${maxStepSlope}`;
  if (state.boundaryCache.has(cacheKey)) {
    state.isochrone = state.boundaryCache.get(cacheKey);
    state.boundarySamples = state.isochrone?.properties?.sample_count || 0;
    $('data-status').textContent = state.isochrone ? `LANDS DEPARTMENT 3D ROUTES · ${state.boundarySamples}/24 SAFE DIRECTIONS` : 'LANDS DEPARTMENT 3D ROUTES · NO REACH CONTOUR';
    render(); fitReachView(); return;
  }
  const boundary = [], sampleCount = 24, bearingStep = 360 / sampleCount;
  let nextSpoke = 0, completedSpokes = 0;
  const sampleWorker = async () => {
    while (true) {
      const spoke = nextSpoke++;
      if (spoke >= sampleCount || originVersion !== state.originVersion || distanceMetres !== state.distanceMetres || maxSlope !== state.slope || maxStepSlope !== state.stepSlope) return;
      $('data-status').textContent = `TRACING WALK REACH · ${completedSpokes}/${sampleCount} DIRECTIONS`;
      const candidateRadii = [3200, 1600, 800, 400, 200, 100];
      let sampledReach = null, shortestUsefulReach = Math.min(120, Math.max(60, distanceMetres * .35));
      try {
        for (const radius of candidateRadii) {
          if (originVersion !== state.originVersion || distanceMetres !== state.distanceMetres || maxSlope !== state.slope || maxStepSlope !== state.stepSlope) return;
          const routeKey = `${originVersion}/${spoke}/${radius}`;
          let route = state.boundaryRouteCache.get(routeKey);
          const requestRoute = route === undefined;
          if (requestRoute) {
            const coordinates = radialDestination(origin, radius, spoke * bearingStep);
            route = await landsDRoute({ id: `buffer-${spoke}-${radius}`, name: 'Walking-time boundary sample', coordinates }, origin);
            state.boundaryRouteCache.set(routeKey, route);
          }
          if (originVersion !== state.originVersion || distanceMetres !== state.distanceMetres || maxSlope !== state.slope || maxStepSlope !== state.stepSlope) return;
          if (route.route_exists && route.path?.length) {
            const endpoint = accessiblePrefixEndpoint(route.path, distanceMetres * 1.6, maxSlope, maxStepSlope, route.duration_s, walkTimeSeconds);
            if (endpoint) {
              const reach = { bearing: spoke * bearingStep, coordinate: endpoint, originElevation: Number(route.path[0][2]) };
              const radialReach = haversineMetres([origin.longitude, origin.latitude], endpoint);
              const bestRadialReach = sampledReach ? haversineMetres([origin.longitude, origin.latitude], sampledReach.coordinate) : 0;
              if (!sampledReach || radialReach > bestRadialReach) sampledReach = reach;
              if (radialReach >= shortestUsefulReach) break;
            }
          }
          if (requestRoute) await wait(180);
        }
        if (sampledReach) boundary.push(sampledReach);
      } catch (error) { console.warn(`Walking-time boundary sample ${spoke + 1} unavailable.`, error); }
      completedSpokes += 1;
      $('data-status').textContent = `TRACING WALK REACH · ${completedSpokes}/${sampleCount} DIRECTIONS`;
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, sampleCount) }, sampleWorker));
  if (state.google || originVersion !== state.originVersion || distanceMetres !== state.distanceMetres || maxSlope !== state.slope || maxStepSlope !== state.stepSlope) return;
  state.boundarySamples = boundary.length;
  const geometry = boundary.length >= 2 ? sampledReachGeometry(boundary, sampleCount, origin) : null;
  if (geometry) state.isochrone = { type: 'Feature', properties: { method: '24 Lands Department 3D pedestrian-network bearings at 15-degree spacing with progressively closer targets when a long target is disconnected. Reach is bounded by route time, total route grade, and maximum grade between consecutive elevation samples. Unsampled or blocked directions remain open.', sample_count: boundary.length, requested_samples: sampleCount, walk_time_seconds: walkTimeSeconds, equivalent_distance_m: distanceMetres, max_route_slope_deg: maxSlope, max_step_slope_deg: maxStepSlope }, geometry };
  else state.isochrone = null;
  state.boundaryCache.set(cacheKey, state.isochrone);
  $('data-status').textContent = state.isochrone
    ? `LANDS DEPARTMENT 3D ROUTES · ${boundary.length}/${sampleCount} SLOPE-SAFE DIRECTIONS`
    : `LANDS DEPARTMENT 3D ROUTES · BUFFER WITHHELD (${boundary.length}/${sampleCount} SLOPE-SAFE DIRECTIONS)`;
  render(); fitReachView();
}
let landsDTimer;
function scheduleLandsDAnalysis() { clearTimeout(landsDTimer); landsDTimer = setTimeout(runLandsDAnalysis, 900); }
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function runLandsDAnalysis() {
  if (state.google || !state.places.length) return;
  if (state.routeQueueRunning) { state.routeQueueRequested = true; return; }
  state.routeQueueRunning = true;
  const originVersion = state.originVersion, origin = { ...ORIGIN };
  const distanceAtStart = state.distanceMetres, slopeAtStart = state.slope, stepSlopeAtStart = state.stepSlope;
  try {
    await buildLandsDContour(origin, originVersion);
    if (state.google || originVersion !== state.originVersion || distanceAtStart !== state.distanceMetres || slopeAtStart !== state.slope || stepSlopeAtStart !== state.stepSlope) return;
    const maxSeedDistance = Math.min(4000, state.distanceMetres * 2);
    const todo = state.places.filter(p => !p.routeAnalysis && !state.routeFailures.has(p.id) && p.study_distance_m <= maxSeedDistance);
    for (let i = 0; i < todo.length; i += 1) {
      if (state.google || originVersion !== state.originVersion) break;
      const place = todo[i];
      $('data-status').textContent = `LANDS DEPARTMENT 3D ROUTE-TIME NETWORK · ${i + 1}/${todo.length}`;
      let result;
      try { result = { place, route: await landsDRoute(place, origin) }; }
      catch (error) { console.warn(`Route unavailable for ${place.name}.`, error); result = { place, error }; }
      if (state.google || originVersion !== state.originVersion) break;
      const index = state.places.findIndex(p => p.id === result.place.id);
      if (index >= 0 && result.route) state.places[index] = { ...state.places[index], ...result.route };
      else if (index >= 0) { state.places[index].routeError = true; state.routeFailures.add(result.place.id); }
      render();
      if (i + 1 < todo.length) await wait(500);
    }
  } finally {
    state.routeQueueRunning = false;
    if (state.routeQueueRequested) { state.routeQueueRequested = false; if (!state.google) scheduleLandsDAnalysis(); }
  }
}
function renderMapLibreSvgRoutes() {
  const map = state.maplibre, svg = $('map-route-overlay'); if (!map || !svg) return;
  const { width, height } = map.getContainer().getBoundingClientRect();
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`); svg.setAttribute('preserveAspectRatio', 'none');
  const geometry = (state.view === 'reach' || state.view === 'map') ? state.isochrone?.geometry : null;
  const rings = geometry?.type === 'Polygon' ? [geometry.coordinates[0]] : geometry?.type === 'MultiPolygon' ? geometry.coordinates.map(polygon => polygon[0]) : [];
  const bufferMarkup = rings.map(ring => {
    const screen = ring.map(point => map.project(point.slice(0, 2)));
    if (screen.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return '';
    const d = screen.map((point, i) => `${i ? 'L' : 'M'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ') + ' Z';
    return `<path class="map-reach-buffer" d="${d}"/>`;
  }).join('');
  const markup = state.places.filter(p => accessible(p) && (state.filter === 'all' || p.kind === state.filter)).map(p => {
    if (!p.path?.length) return '';
    const path = p.path.map(c => c.slice(0, 2));
    const screen = path.map(c => map.project(c));
    if (screen.some(c => !Number.isFinite(c.x) || !Number.isFinite(c.y))) return '';
    const d = screen.map((c, i) => `${i ? 'L' : 'M'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ');
    const end = screen[screen.length - 1]; const color = p.kind === 'gym' ? '#c89040' : '#287461';
    const label = escapeHtml(p.name);
    return `<path class="map-route-casing" d="${d}"/><path class="map-route-line" d="${d}"/><circle class="map-route-endpoint" cx="${end.x.toFixed(1)}" cy="${end.y.toFixed(1)}" r="7" fill="${color}"/><text class="map-route-label" x="${(end.x + 12).toFixed(1)}" y="${(end.y - 10).toFixed(1)}">${label}</text>`;
  }).join('');
  const origin = map.project([ORIGIN.longitude, ORIGIN.latitude]);
  const originMarkup = Number.isFinite(origin.x) && Number.isFinite(origin.y)
    ? `<circle class="map-route-origin-halo" cx="${origin.x.toFixed(1)}" cy="${origin.y.toFixed(1)}" r="12"/><circle class="map-route-origin-dot" cx="${origin.x.toFixed(1)}" cy="${origin.y.toFixed(1)}" r="7"/><text class="map-route-label map-origin-label" x="${(origin.x + 14).toFixed(1)}" y="${(origin.y - 11).toFixed(1)}">COMMUNITY CENTRE</text>`
    : '';
  svg.innerHTML = `${bufferMarkup}${markup}${originMarkup}`;
}
function addMapLibreLayers(map) {
  for (const layer of map.getStyle().layers) state.mapBasePaint.set(layer.id, { fillColor: layer.paint?.['fill-color'], lineColor: layer.paint?.['line-color'], visibility: layer.layout?.visibility || 'visible' });
  map.addSource('openfreemap', { type: 'vector', url: 'https://tiles.openfreemap.org/planet' });
  map.addLayer({ id: '3d-buildings-context', source: 'openfreemap', 'source-layer': 'building', type: 'fill-extrusion', minzoom: 14, filter: ['!=', ['get', 'hide_3d'], true], paint: { 'fill-extrusion-color': '#9fa99f', 'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 14, 0, 15, ['coalesce', ['get', 'render_height'], 15]], 'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0], 'fill-extrusion-opacity': .42 } });
  map.addLayer({ id: '3d-buildings', source: 'openfreemap', 'source-layer': 'building', type: 'fill-extrusion', minzoom: 14, filter: ['!=', ['get', 'hide_3d'], true], paint: { 'fill-extrusion-color': '#c5c8ba', 'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 14, 0, 15, ['coalesce', ['get', 'render_height'], 15]], 'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0], 'fill-extrusion-opacity': .58 } });
  map.addSource('walk-buffer', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addSource('reach-mask', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addSource('access-routes', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, lineMetrics: true });
  map.addSource('access-places', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addSource('map-origin', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addSource('reach-block-buildings', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'reach-mask-fill', type: 'fill', source: 'reach-mask', paint: { 'fill-color': '#f3f4ed', 'fill-opacity': .78 } });
  map.addLayer({ id: 'reach-block-buildings', type: 'fill-extrusion', source: 'reach-block-buildings', layout: { visibility: 'none' }, paint: { 'fill-extrusion-color': '#bed8c7', 'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 15], 'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0], 'fill-extrusion-opacity': .98 } });
  map.addLayer({ id: 'walk-buffer-fill', type: 'fill', source: 'walk-buffer', paint: { 'fill-color': '#cb634c', 'fill-opacity': .24 } });
  map.addLayer({ id: 'walk-buffer-outline', type: 'line', source: 'walk-buffer', paint: { 'line-color': '#c85d45', 'line-width': 2.5, 'line-dasharray': [2, 2], 'line-opacity': .95 } });
  map.addLayer({ id: 'accessible-route-casing', type: 'line', source: 'access-routes', paint: { 'line-color': '#fffdf6', 'line-width': 9, 'line-opacity': .96 } });
  map.addLayer({ id: 'accessible-routes', type: 'line', source: 'access-routes', paint: { 'line-color': '#16755f', 'line-width': 5, 'line-opacity': 1 } });
  map.addLayer({ id: 'access-place-points', type: 'circle', source: 'access-places', paint: { 'circle-radius': 8, 'circle-color': ['match', ['get', 'kind'], 'gym', '#c89040', '#287461'], 'circle-stroke-color': '#f8f7f0', 'circle-stroke-width': 3 } });
  map.addLayer({ id: 'access-place-labels', type: 'symbol', source: 'access-places', layout: { 'text-field': ['get', 'name'], 'text-font': ['Open Sans Semibold'], 'text-size': 12, 'text-offset': [0, 1.35], 'text-anchor': 'top', 'text-allow-overlap': false }, paint: { 'text-color': '#26332d', 'text-halo-color': '#f7f6ef', 'text-halo-width': 2 } });
  map.addLayer({ id: 'origin-point', type: 'circle', source: 'map-origin', paint: { 'circle-radius': 10, 'circle-color': '#c94f37', 'circle-stroke-color': '#fffdf6', 'circle-stroke-width': 3 } });
  map.addLayer({ id: 'origin-label', type: 'symbol', source: 'map-origin', layout: { 'text-field': 'COMMUNITY CENTRE', 'text-font': ['Open Sans Semibold'], 'text-size': 11, 'text-offset': [1.2, -.4], 'text-anchor': 'left', 'text-allow-overlap': true }, paint: { 'text-color': '#934633', 'text-halo-color': '#fffdf6', 'text-halo-width': 2 } });
  map.on('click', 'access-place-points', e => { const feature = e.features?.[0]; if (feature) focusPlace(feature.properties.id); });
  map.on('mouseenter', 'access-place-points', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'access-place-points', () => { map.getCanvas().style.cursor = ''; });
  map.on('click', e => {
    if (!state.pickOrigin) return;
    ORIGIN.longitude = e.lngLat.lng; ORIGIN.latitude = e.lngLat.lat; state.originVersion++; state.boundaryCache.clear(); state.boundaryRouteCache.clear(); state.isochrone = null; state.pickOrigin = false; $('locate-origin').textContent = '⌖  SET ON MAP';
    render();
    state.places = state.places.map(p => ({ ...p, routeAnalysis: false, routeError: false })); state.routeFailures.clear();
    showToast(state.google ? 'Origin updated. Recalculating walking reach.' : 'Origin moved. Recalculating Lands Department walking routes.');
    if (state.google) scheduleGoogleAnalysis(); else scheduleLandsDAnalysis();
  });
  map.on('move', renderMapLibreSvgRoutes); map.on('resize', renderMapLibreSvgRoutes); map.on('idle', () => { renderMapLibreSvgRoutes(); scheduleReachBuildingUpdate(); });
  renderMapLibreOverlays();
}
function initMapLibre() {
  if (!window.maplibregl) { $('map-loading').textContent = 'Map library unavailable · check your connection and reload'; $('map-loading').classList.add('map-loading-error'); showToast('The map library did not load. Check the connection and refresh.'); return; }
  const map = new maplibregl.Map({ container: 'maplibre-container', style: 'https://tiles.openfreemap.org/styles/liberty', center: [MAP_CENTER.longitude, MAP_CENTER.latitude], zoom: 16.7, pitch: 48, bearing: -12, maxPitch: 65, attributionControl: true, antialias: true, cooperativeGestures: true });
  state.maplibre = map;
  const mapLoadTimer = setTimeout(() => { if (!$('map-loading').hidden) $('map-loading').textContent = 'Map tiles are taking longer than usual · keep this page open while they load'; }, 12000);
  map.addControl(new maplibregl.NavigationControl({ showCompass: false, showZoom: false }), 'top-right');
  map.on('load', () => {
    try { addMapLibreLayers(map); }
    catch (error) { console.error('Could not add 3D building layer', error); showToast('Map loaded, but building extrusions are unavailable.'); }
    $('data-status').textContent = 'OPENSTREETMAP 3D BUILDINGS · CSDI DESTINATIONS';
    $('map-data-label').textContent = '3D BUILDINGS · OSM STREET MAP'; $('map-attribution').textContent = '© OpenStreetMap contributors · OpenFreeMap · routes/data © Lands Department';
    map.once('idle', () => { clearTimeout(mapLoadTimer); $('map-loading').hidden = true; applyPresentation(); renderMapLibreOverlays(); fitReachView(); });
  });
  map.on('error', e => { if (e.error) console.warn('MapLibre tile/style issue:', e.error.message); if (!map.isStyleLoaded()) { $('map-loading').textContent = 'Connecting to Hong Kong street and 3D building data…'; $('map-loading').classList.remove('map-loading-error'); } });
}
async function initGoogle() {
  let config = {};
  try { config = await fetch(apiUrl('config')).then(r => r.json()); }
  catch (error) { console.warn('Map backend configuration unavailable; using Hong Kong open-data basemap.', error); }
  state.google = Boolean(config.google_enabled);
  initMapLibre();
  if (state.google) scheduleGoogleAnalysis(); else scheduleLandsDAnalysis();
  if (!window.Cesium || (!config.google_enabled && !config.landsd_3d_enabled)) return;
  try {
    const viewer = new Cesium.Viewer('cesium-container', { animation: false, baseLayerPicker: false, fullscreenButton: false, geocoder: false, homeButton: false, infoBox: false, sceneModePicker: false, selectionIndicator: false, timeline: false, navigationHelpButton: false, creditContainer: $('google-credits'), skyAtmosphere: new Cesium.SkyAtmosphere(), baseLayer: false });
    viewer.scene.globe.show = false; viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#d4ded4');
    viewer.scene.screenSpaceCameraController.enableCollisionDetection = false;
    const endpoint = config.google_enabled ? apiUrl('google-3d-tiles/v1/3dtiles/root.json') : apiUrl('landsd-3d-tiles/f2/tileset.json');
    const tiles = await Cesium.Cesium3DTileset.fromUrl(endpoint, { showCreditsOnScreen: true });
    viewer.scene.primitives.add(tiles); state.tileset = tiles;
    viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(ORIGIN.longitude, ORIGIN.latitude, 1450), orientation: { heading: Cesium.Math.toRadians(12), pitch: Cesium.Math.toRadians(-48), roll: 0 } });
    viewer.scene.globe.depthTestAgainstTerrain = true;
    state.map = viewer;
    $('data-status').textContent = config.google_enabled ? 'GOOGLE PHOTOREALISTIC 3D · HONG KONG ACCESS DATA' : 'LANDS DEPARTMENT 3D MAP · HONG KONG ACCESS DATA';
    $('map-attribution').textContent = config.google_enabled ? 'Google Maps Platform · Lands Department destination and route overlays' : '3D visualisation map © Lands Department, HKSAR Government · CSDI route and destination data';
    $('map-attribution').classList.add('third-party-attribution');
    if (config.google_enabled) { $('google-credits').classList.add('active'); $('map-attribution').textContent = 'Lands Department · CSDI destination overlays'; }
    renderCesiumOverlays(); applyPresentation();
    new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas).setInputAction((evt) => {
      if (!state.pickOrigin) return;
      const ray = viewer.camera.getPickRay(evt.position); const point = viewer.scene.globe.pick(ray, viewer.scene);
      if (!point) return;
      const carto = Cesium.Cartographic.fromCartesian(point); ORIGIN.latitude = Cesium.Math.toDegrees(carto.latitude); ORIGIN.longitude = Cesium.Math.toDegrees(carto.longitude); state.originVersion++; state.boundaryCache.clear(); state.boundaryRouteCache.clear(); state.isochrone = null; state.pickOrigin = false; $('locate-origin').textContent = '⌖  SET ON MAP'; state.places = state.places.map(p => ({ ...p, routeAnalysis: false, routeError: false })); state.routeFailures.clear(); showToast('Origin updated. Recalculating walking routes.'); if (state.google) scheduleGoogleAnalysis(); else scheduleLandsDAnalysis();
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  } catch (error) {
    console.warn('Detailed 3D tile service unavailable; using interactive 3D building fallback.', error);
    showToast('Detailed 3D tiles are unavailable. OpenStreetMap 3D buildings remain available.');
  }
}

let requestTimer;
function scheduleGoogleAnalysis() {
  clearTimeout(requestTimer);
  state.googleAnalysisVersion += 1;
  if (state.googleController) { state.googleController.abort(); state.googleController = null; }
  requestTimer = setTimeout(() => runGoogleAnalysis(state.googleAnalysisVersion), 700);
}
async function runGoogleAnalysis(version) {
  if (!state.google) return;
  const controller = new AbortController();
  state.googleController = controller;
  const destinations = candidatePlaces().map(p => ({ id: p.id, name: p.name, kind: p.kind, latitude: p.coordinates[1], longitude: p.coordinates[0] }));
  try {
    const request = { origin: { latitude: ORIGIN.latitude, longitude: ORIGIN.longitude }, destinations, walk_time_seconds: state.walkTimeSeconds, max_route_slope_deg: state.slope, max_step_slope_deg: state.stepSlope };
    const [response, reachResponse] = await Promise.all([
      fetch(apiUrl('analyze'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: controller.signal }),
      fetch(apiUrl('isochrone'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: controller.signal }),
    ]);
    if (version !== state.googleAnalysisVersion) return;
    if (!response.ok) throw new Error(await response.text());
    const payload = await response.json();
    const reach = reachResponse.ok ? await reachResponse.json() : null;
    if (version !== state.googleAnalysisVersion) return;
    const byId = new Map(payload.results.map(result => [result.id, result]));
    state.places = state.places.map(place => {
      const result = byId.get(place.id);
      if (!result) return { ...place, routeAnalysis: false, routeError: false, accessible: undefined, path: undefined };
      return { ...place, ...result, routeAnalysis: true, googleAnalysis: true, route_source: 'Google Routes + Elevation API', coordinates: result.path?.length ? [result.path.at(-1)[0], result.path.at(-1)[1]] : place.coordinates };
    });
    state.isochrone = reach?.feature || null;
    $('data-status').textContent = 'GOOGLE WALKING REACH · ROUTES + ELEVATION'; render(); syncCesiumReachClip(); fitReachView();
  } catch (error) {
    if (version !== state.googleAnalysisVersion || error.name === 'AbortError') return;
    $('data-status').textContent = 'GOOGLE ROUTING UNAVAILABLE'; console.warn('Google route analysis failed.', error);
  } finally {
    if (state.googleController === controller) state.googleController = null;
  }
}

 $('distance').addEventListener('input', () => setRange(false)); $('slope').addEventListener('input', () => setRange(false)); $('step-slope').addEventListener('input', () => setRange(false));
 $('distance').addEventListener('change', () => setRange()); $('slope').addEventListener('change', () => setRange()); $('step-slope').addEventListener('change', () => setRange());
  document.querySelectorAll('.filter').forEach(b => b.addEventListener('click', () => { state.filter = b.dataset.filter; document.querySelectorAll('.filter').forEach(item => item.classList.toggle('active', item === b)); render(); }));
document.querySelectorAll('.view-option').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
document.querySelectorAll('.style-option').forEach(b => b.addEventListener('click', () => setMapStyle(b.dataset.style)));
document.querySelector('.profile-option').addEventListener('click', () => setView('section'));
$('about-btn').addEventListener('click', () => $('about-dialog').showModal()); $('source-btn').addEventListener('click', () => $('about-dialog').showModal());
document.querySelector('.dialog-close').addEventListener('click', () => $('about-dialog').close()); $('about-dialog').addEventListener('click', e => { if (e.target === $('about-dialog')) $('about-dialog').close(); });
$('locate-origin').addEventListener('click', () => { if (!state.map && !state.maplibre) return showToast('The map is still loading.'); state.pickOrigin = true; $('locate-origin').textContent = 'CLICK MAP TO SET'; showToast('Click the map to move the origin.'); });
$('zoom-in').addEventListener('click', () => { if (state.view !== 'map' && state.map) state.map.camera.zoomIn(250); else if (state.maplibre) state.maplibre.zoomIn({ duration: 250 }); });
$('zoom-out').addEventListener('click', () => { if (state.view !== 'map' && state.map) state.map.camera.zoomOut(250); else if (state.maplibre) state.maplibre.zoomOut({ duration: 250 }); });
$('reset-view').addEventListener('click', () => { if (state.view !== 'map' && state.map) setView(state.view); else if (state.maplibre) state.maplibre.flyTo({ center: [ORIGIN.longitude, ORIGIN.latitude], zoom: state.view === 'reach' ? 17.1 : state.view === 'map' ? 15.6 : 16.7, pitch: state.view === 'map' ? 0 : 48, bearing: state.view === 'map' ? 0 : -12, duration: 700 }); });
setRange(); loadAccessPoints().then(initGoogle);

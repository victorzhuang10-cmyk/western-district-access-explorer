const DEMO_PLACES = [
  { id: 'green-1', name: 'Cadogan Street Garden', kind: 'green', distance_m: 260, max_slope_deg: 4.5, minutes: 4, duration_s: 240, xy: [540, 404], bend: [535, 442] },
  { id: 'green-2', name: 'Smithfield Sitting-out Area', kind: 'green', distance_m: 410, max_slope_deg: 8.7, minutes: 7, duration_s: 420, xy: [686, 424], bend: [639, 425] },
  { id: 'green-3', name: 'Belcher Bay Promenade', kind: 'green', distance_m: 575, max_slope_deg: 12.5, minutes: 10, duration_s: 600, xy: [481, 545], bend: [515, 503] },
  { id: 'gym-1', name: 'Kennedy Town Outdoor Fitness Station', kind: 'gym', distance_m: 330, max_slope_deg: 6.1, minutes: 6, duration_s: 360, xy: [619, 548], bend: [581, 528] },
  { id: 'gym-2', name: 'Sai Woo Lane Fitness Corner', kind: 'gym', distance_m: 520, max_slope_deg: 15.5, minutes: 9, duration_s: 540, xy: [704, 354], bend: [648, 382] },
];
const ORIGIN = { latitude: 22.2833, longitude: 114.1285 };
const $ = (id) => document.getElementById(id);
const apiUrl = (path) => new URL(`${location.pathname.includes('/static/') ? '../' : './'}api/${path}`, document.baseURI).toString();
const state = { timeMinutes: 5, slope: 10, filter: 'all', view: 'terrain', places: structuredClone(DEMO_PLACES), google: false, isochrone: null, sectionPlaceId: 'green-1', map: null, maplibre: null, routeEntities: [], markerEntities: [], zoom: 1, pickOrigin: false };

function formatDistance(m) { return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`; }
function durationMinutes(p) { return p.duration_s != null ? p.duration_s / 60 : Number(p.minutes || 0); }
function accessible(p) { return p.googleAnalysis ? Boolean(p.accessible) : durationMinutes(p) <= state.timeMinutes && Number(p.max_slope_deg || 0) <= state.slope; }
function status(p) {
  if (durationMinutes(p) > state.timeMinutes) return ['OVER TIME', 'outside'];
  if (Number(p.max_slope_deg || 0) > state.slope) return [`${Number(p.max_slope_deg).toFixed(1)}° SLOPE`, 'steep'];
  return ['IN REACH', ''];
}
function updateSliderPaint(input) {
  const pct = ((Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min))) * 100;
  const color = input.id === 'distance' ? 'var(--rust)' : 'var(--pine)';
  input.style.background = `linear-gradient(to right,${color} 0%,${color} ${pct}%,#dcded5 ${pct}%,#dcded5 100%)`;
}
function setRange() {
  state.timeMinutes = Number($('distance').value); state.slope = Number($('slope').value); state.isochrone = null;
  $('distance-value').textContent = state.timeMinutes; $('slope-value').textContent = state.slope;
  $('caption-distance').textContent = state.timeMinutes;
  $('walk-time').textContent = `${state.timeMinutes} min`;
  updateSliderPaint($('distance')); updateSliderPaint($('slope'));
  render();
  if (state.google) scheduleGoogleAnalysis();
  else renderMapLibreOverlays();
}
function renderList() {
  const visible = state.places.filter(p => state.filter === 'all' || p.kind === state.filter);
  $('place-list').innerHTML = visible.map(p => {
    const [label, cls] = status(p);
    const icon = p.kind === 'green' ? '♧' : '✳';
    const extra = `${Math.max(1, Math.round(durationMinutes(p)))} min walk${p.max_slope_deg != null ? ` · ${Number(p.max_slope_deg).toFixed(1)}° max` : ''}`;
    return `<div class="place-item ${accessible(p) ? 'is-accessible' : ''}" data-id="${p.id}"><span class="place-icon ${p.kind}">${icon}</span><span class="place-info"><strong>${p.name}</strong><small>${extra}</small></span><span class="place-status ${cls}">${label}</span></div>`;
  }).join('');
  $('place-total').textContent = String(state.places.length).padStart(2, '0');
  $('all-count').textContent = String(state.places.length).padStart(2, '0');
  $('green-count').textContent = String(state.places.filter(p => p.kind === 'green').length).padStart(2, '0');
  $('gym-count').textContent = String(state.places.filter(p => p.kind === 'gym').length).padStart(2, '0');
  document.querySelectorAll('.place-item').forEach(el => el.addEventListener('click', () => focusPlace(el.dataset.id)));
}
function linePath(p) {
  const [x, y] = p.xy; const [bx, by] = p.bend || [x, y];
  const d = `M 590 470 Q ${bx} ${by} ${x} ${y}`;
  const classes = accessible(p) ? 'route' : (Number(p.max_slope_deg) > state.slope ? 'route route-steep' : 'route route-outside');
  return `<path class="${classes}" data-route="${p.id}" d="${d}"/>`;
}
function pinMarkup(p) {
  const [x, y] = p.xy;
  const cls = p.kind === 'green' ? 'green-dot' : 'gym-dot';
  const glyph = p.kind === 'green' ? '♧' : '✳';
  const [label, statusClass] = status(p);
  const opacity = durationMinutes(p) > state.timeMinutes || Number(p.max_slope_deg) > state.slope ? '.48' : '1';
  return `<g class="place-pin" data-id="${p.id}" opacity="${opacity}" transform="translate(${x} ${y})"><circle class="pin-halo" r="15"/><circle class="pin-dot ${cls}" r="9"/><text text-anchor="middle" y="3.5" fill="white" font-size="10">${glyph}</text><text class="pin-label" x="13" y="-8">${p.name}</text>${statusClass === 'steep' ? `<text x="13" y="7" fill="#a24634" font-size="8" font-family="DM Mono">SLOPE ${p.max_slope_deg.toFixed(1)}°</text>` : ''}</g>`;
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
    const collection = await fetch(apiUrl('access-points')).then(r => { if (!r.ok) throw new Error('GeoJSON not available'); return r.json(); });
    const loaded = (collection.features || []).map((feature, i) => {
      const coordinates = pointFromFeature(feature); if (!coordinates) return null;
      const properties = feature.properties || {};
      const kind = properties.kind === 'gym' || /fitness|exercise|gym/i.test(String(properties.kind || properties.facility_type || properties.category || '')) ? 'gym' : 'green';
      const id = String(feature.id || properties.id || `${kind}-${i + 1}`);
      const dlon = coordinates[0] - ORIGIN.longitude, dlat = coordinates[1] - ORIGIN.latitude;
      return { id, name: String(properties.name || properties.name_en || properties.facility_name_en || properties.facility_name || `Public ${kind === 'gym' ? 'fitness point' : 'green space'} ${i + 1}`), kind, coordinates, distance_m: Math.round(Math.hypot(dlon * 102000, dlat * 111000) * 1.22), max_slope_deg: 0, minutes: 0, xy: [590 + dlon * 10000, 470 - dlat * 12500], bend: [590 + dlon * 5200, 470 - dlat * 7400], demo: properties.demo === true };
    }).filter(Boolean);
    if (!loaded.length) return;
    state.places = loaded; render();
    if (loaded.some(p => !p.demo)) { $('data-status').textContent = 'HONG KONG OPEN DATA · ROUTES PENDING'; $('map-data-label').textContent = 'HONG KONG OPEN DATA LAYERS'; }
  } catch (error) { console.info('Using bundled illustrative access points.', error.message); }
}
function focusPlace(id) {
  const place = state.places.find(p => p.id === id); if (!place) return;
  state.sectionPlaceId = id;
  renderSectionMap();
  $('place-list').querySelector(`[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  showToast(`${place.name} · ${Math.max(1, Math.round(durationMinutes(place)))} min walking route`);
  const coordinates = place.coordinates || coordsForDemo(place).at(-1).slice(0, 2);
  if (state.map && coordinates) state.map.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(coordinates[0], coordinates[1], 950), duration: 1.2 });
  if (state.maplibre && coordinates) state.maplibre.flyTo({ center: coordinates, zoom: 17, pitch: 48, duration: 1000 });
}
let toastTimer;
function showToast(message) { const el = $('toast'); el.textContent = message; el.classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('visible'), 2300); }
function setView(mode) {
  state.view = mode;
  document.querySelectorAll('.view-option').forEach(b => b.classList.toggle('selected', b.dataset.view === mode));
  document.querySelector('.map-shell').classList.toggle('diagram-mode', mode === 'diagram');
  document.querySelector('.map-shell').classList.toggle('section-mode', mode === 'section');
  $('section-panel').hidden = mode !== 'section';
  renderSectionMap();
  if (state.maplibre && mode !== 'section') requestAnimationFrame(() => state.maplibre.resize());
  if (state.maplibre) $('map-data-label').textContent = mode === 'terrain' ? '3D BUILDINGS · OSM STREET MAP' : mode === 'diagram' ? 'SIMPLIFIED 3D ACCESS DIAGRAM' : '3D ELEVATION SECTION';
  if (state.map) { state.map.scene.screenSpaceCameraController.enableTilt = mode === 'terrain'; state.map.scene.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(114.1285, 22.2833, mode === 'terrain' ? 1400 : 2400), orientation: { heading: 0, pitch: mode === 'terrain' ? Cesium.Math.toRadians(-48) : Cesium.Math.toRadians(-68), roll: 0 }, duration: .7 }); }
  if (state.maplibre) {
    for (const layer of state.maplibre.getStyle().layers) {
      if (layer.type === 'fill-extrusion') {
        state.maplibre.setLayoutProperty(layer.id, 'visibility', mode === 'section' ? 'none' : 'visible');
        state.maplibre.setPaintProperty(layer.id, 'fill-extrusion-opacity', mode === 'diagram' ? .46 : .58);
      }
    }
    if (mode !== 'section') state.maplibre.flyTo({ center: state.maplibre.getCenter(), zoom: mode === 'terrain' ? 15.6 : 16.2, pitch: mode === 'terrain' ? 48 : 42, bearing: mode === 'terrain' ? -17 : 0, duration: 700 });
  }
}
function coordsForDemo(p) {
  const origin = [114.1285, 22.2833, 24];
  const deltas = { 'green-1': [-.0004, .0008], 'green-2': [.0012, .0004], 'green-3': [-.0012, -.0011], 'gym-1': [.0005, -.0008], 'gym-2': [.0018, .0010] }[p.id] || [0, 0];
  return [[origin[0], origin[1], 24], [origin[0] + deltas[0] * .45, origin[1] + deltas[1] * .6, 28], [origin[0] + deltas[0], origin[1] + deltas[1], 22]];
}
function renderCesiumOverlays() {
  if (!state.map) return;
  for (const entity of [...state.routeEntities, ...state.markerEntities]) state.map.entities.remove(entity);
  state.routeEntities = []; state.markerEntities = [];
  const origin = state.map.entities.add({ position: Cesium.Cartesian3.fromDegrees(ORIGIN.longitude, ORIGIN.latitude, 20), point: { pixelSize: 12, color: Cesium.Color.fromCssColorString('#cb5237'), outlineColor: Cesium.Color.WHITE, outlineWidth: 3, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND }, label: { text: 'COMMUNITY CENTRE', font: '12px DM Sans', pixelOffset: new Cesium.Cartesian2(16, -12), fillColor: Cesium.Color.fromCssColorString('#9e4535'), outlineColor: Cesium.Color.WHITE, outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND } });
  state.markerEntities.push(origin);
  const ring = state.isochrone?.geometry;
  if (ring?.type === 'Polygon') {
    const contour = ring.coordinates[0].flatMap(c => c.slice(0, 2));
    state.routeEntities.push(state.map.entities.add({ polygon: { hierarchy: Cesium.Cartesian3.fromDegreesArray(contour), material: Cesium.Color.fromCssColorString('#cb5237').withAlpha(.18), outline: true, outlineColor: Cesium.Color.fromCssColorString('#cb5237').withAlpha(.9), outlineWidth: 2, height: 8 } }));
  }
  for (const p of state.places) {
    if (!accessible(p)) continue;
    const path = p.path?.length ? p.path : coordsForDemo(p);
    const pos = path.map(c => Cesium.Cartesian3.fromDegrees(c[0], c[1], c[2] ?? 20));
    const route = state.map.entities.add({ polyline: { positions: pos, width: 4, material: Cesium.Color.fromCssColorString('#276d5d'), clampToGround: false } });
    state.routeEntities.push(route);
    const end = path[path.length - 1];
    const marker = state.map.entities.add({ position: Cesium.Cartesian3.fromDegrees(end[0], end[1], end[2] ?? 24), point: { pixelSize: 9, color: Cesium.Color.fromCssColorString(p.kind === 'green' ? '#276d5d' : '#ca974b'), outlineColor: Cesium.Color.WHITE, outlineWidth: 2, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND }, label: { text: p.name, font: '11px DM Sans', pixelOffset: new Cesium.Cartesian2(12, -8), fillColor: Cesium.Color.fromCssColorString('#26302a'), outlineColor: Cesium.Color.WHITE, outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, show: true } });
    state.markerEntities.push(marker);
  }
}
function circleFeature(center, radius) {
  const [lng, lat] = center, points = [];
  for (let i = 0; i <= 72; i++) {
    const bearing = i * 5 * Math.PI / 180, angular = radius / 6371008.8;
    const p1 = lat * Math.PI / 180, l1 = lng * Math.PI / 180;
    const p2 = Math.asin(Math.sin(p1) * Math.cos(angular) + Math.cos(p1) * Math.sin(angular) * Math.cos(bearing));
    const l2 = l1 + Math.atan2(Math.sin(bearing) * Math.sin(angular) * Math.cos(p1), Math.cos(angular) - Math.sin(p1) * Math.sin(p2));
    points.push([l2 * 180 / Math.PI, p2 * 180 / Math.PI]);
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [points] } };
}
function demoRoute(p) {
  const end = p.coordinates || coordsForDemo(p).at(-1).slice(0, 2);
  const midLng = (ORIGIN.longitude + end[0]) / 2, midLat = (ORIGIN.latitude + end[1]) / 2;
  const bend = (p.id.charCodeAt(0) % 2 ? 1 : -1) * .00012;
  return [[ORIGIN.longitude, ORIGIN.latitude], [midLng + bend, midLat - bend], [end[0], end[1]]];
}
function mapLibreLayersReady() { return state.maplibre && state.maplibre.isStyleLoaded() && state.maplibre.getSource('access-routes'); }
function renderSectionMap() {
  const host = $('section-panel'); if (!host) return;
  const place = state.places.find(p => p.id === state.sectionPlaceId) || state.places.find(accessible) || state.places[0];
  if (!place) { host.innerHTML = '<div class="section-empty">Select a place to inspect its route section.</div>'; return; }
  const path = place.path?.length ? place.path : coordsForDemo(place);
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
  const gradeText = `${Number(place.max_slope_deg || 0).toFixed(1)}° max grade`;
  const isGoogle = Boolean(place.googleAnalysis && place.elevations?.length);
  const markers = profile.filter((_, i) => i === 0 || i === profile.length - 1 || i % Math.max(1, Math.floor(profile.length / 7)) === 0).map((p, i) => `<circle cx="${p.x}" cy="${p.y}" r="${i === 0 || p === last ? 8 : 4}" fill="${i === 0 ? '#c94f37' : p === last ? '#287461' : '#f9f8f1'}" stroke="${i === 0 ? '#fff' : '#287461'}" stroke-width="3"/>`).join('');
  const lines = `<svg viewBox="0 0 960 520" role="img" aria-label="Terrain section from the community centre to ${escapeHtml(place.name)}"><defs><linearGradient id="sectionGround" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c9d6bd"/><stop offset="1" stop-color="#e7e6d9"/></linearGradient><linearGradient id="sectionCut" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#aabd9e"/><stop offset="1" stop-color="#738a75"/></linearGradient></defs><path d="M76 255 840 212 918 264 151 315Z" fill="#ebeee2" stroke="#adb8a5"/><path d="M151 315 918 264 918 351 151 405Z" fill="#d4d8ca" stroke="#adb8a5"/><path d="M${top} L${last.x.toFixed(1)} ${(last.y + 112).toFixed(1)} L${first.x.toFixed(1)} ${(first.y + 112).toFixed(1)}Z" fill="url(#sectionCut)" stroke="#667c68" stroke-width="2"/><path d="M${top}" fill="none" stroke="#f7f7ed" stroke-width="17" stroke-linejoin="round"/><path d="M${top}" fill="none" stroke="${accepted ? '#176d5a' : '#bb4c37'}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>${markers}<path d="M102 416h750" stroke="#858e83" stroke-dasharray="5 7"/><path d="M102 408v16m750-16v16" stroke="#858e83"/><text x="102" y="449" class="section-svg-label">0 m · COMMUNITY CENTRE</text><text x="850" y="449" text-anchor="end" class="section-svg-label">${escapeHtml(formatDistance(place.distance_m || total))} · ${escapeHtml(place.name)}</text><text x="76" y="242" class="section-svg-label">ELEVATION</text><text x="76" y="260" class="section-svg-small">${Math.round(minElevation)} m</text><text x="76" y="282" class="section-svg-small">${Math.round(maxElevation)} m</text><rect x="625" y="82" width="234" height="44" rx="3" fill="#fffdf6" stroke="#dadbd2"/><circle cx="647" cy="104" r="6" fill="${accepted ? '#287461' : '#bd4c38'}"/><text x="663" y="109" class="section-svg-label">${accepted ? 'WITHIN WALKING THRESHOLD' : 'OUTSIDE ACCESS THRESHOLD'}</text><text x="122" y="478" class="section-svg-small">VERTICAL RELIEF EXAGGERATED · ${isGoogle ? 'GOOGLE ELEVATION SAMPLES' : 'ILLUSTRATIVE DEMO PROFILE'}</text><text x="840" y="478" text-anchor="end" class="section-svg-label">${gradeText} · ${Math.max(1, Math.round(durationMinutes(place)))} min</text></svg>`;
  host.innerHTML = `<div class="section-heading"><span><b>ROUTE SECTION</b><small>Cutaway profile to the selected place</small></span><span class="section-place-name">${escapeHtml(place.name)}</span></div>${lines}`;
}
function renderMapLibreOverlays() {
  const map = state.maplibre; if (!map || !map.getSource('access-routes')) return;
  const inReach = state.places.filter(p => accessible(p) && (state.filter === 'all' || p.kind === state.filter));
  const routes = inReach.map(p => ({ type: 'Feature', properties: { id: p.id, name: p.name, kind: p.kind }, geometry: { type: 'LineString', coordinates: p.path?.length ? p.path.map(c => c.slice(0, 2)) : demoRoute(p) } }));
  const places = inReach.filter(p => p.coordinates || p.id.startsWith('green-') || p.id.startsWith('gym-')).map(p => {
    const position = p.coordinates || (coordsForDemo(p).at(-1).slice(0, 2));
    return { type: 'Feature', properties: { id: p.id, name: p.name, kind: p.kind }, geometry: { type: 'Point', coordinates: position } };
  });
  const routeData = { type: 'FeatureCollection', features: routes };
  const placeData = { type: 'FeatureCollection', features: places };
  const bufferData = { type: 'FeatureCollection', features: state.isochrone ? [state.isochrone] : [] };
  const originData = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: 'Western District Elderly Community Centre' }, geometry: { type: 'Point', coordinates: [ORIGIN.longitude, ORIGIN.latitude] } }] };
  map.getSource('access-routes')?.setData(routeData); map.getSource('access-places')?.setData(placeData); map.getSource('walk-buffer')?.setData(bufferData); map.getSource('map-origin')?.setData(originData);
  renderMapLibreSvgRoutes();
}
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
function renderMapLibreSvgRoutes() {
  const map = state.maplibre, svg = $('map-route-overlay'); if (!map || !svg) return;
  const { width, height } = map.getContainer().getBoundingClientRect();
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`); svg.setAttribute('preserveAspectRatio', 'none');
  const markup = state.places.filter(p => accessible(p) && (state.filter === 'all' || p.kind === state.filter)).map(p => {
    const path = p.path?.length ? p.path.map(c => c.slice(0, 2)) : demoRoute(p);
    const screen = path.map(c => map.project(c));
    if (screen.some(c => !Number.isFinite(c.x) || !Number.isFinite(c.y))) return '';
    const d = screen.map((c, i) => `${i ? 'L' : 'M'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ');
    const end = screen[screen.length - 1]; const color = p.kind === 'gym' ? '#c89040' : '#287461';
    const label = escapeHtml(p.name);
    return `<path class="map-route-casing" d="${d}"/><path class="map-route-line" d="${d}"/><circle class="map-route-endpoint" cx="${end.x.toFixed(1)}" cy="${end.y.toFixed(1)}" r="7" fill="${color}"/><text class="map-route-label" x="${(end.x + 12).toFixed(1)}" y="${(end.y - 10).toFixed(1)}">${label}</text>`;
  }).join('');
  svg.innerHTML = markup;
}
function addMapLibreLayers(map) {
  map.addSource('openfreemap', { type: 'vector', url: 'https://tiles.openfreemap.org/planet' });
  map.addLayer({ id: '3d-buildings', source: 'openfreemap', 'source-layer': 'building', type: 'fill-extrusion', minzoom: 14, filter: ['!=', ['get', 'hide_3d'], true], paint: { 'fill-extrusion-color': '#c5c8ba', 'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 14, 0, 15, ['coalesce', ['get', 'render_height'], 15]], 'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0], 'fill-extrusion-opacity': .58 } });
  map.addSource('walk-buffer', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addSource('access-routes', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, lineMetrics: true });
  map.addSource('access-places', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addSource('map-origin', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'walk-buffer-fill', type: 'fill', source: 'walk-buffer', paint: { 'fill-color': '#cb634c', 'fill-opacity': .09 } });
  map.addLayer({ id: 'walk-buffer-outline', type: 'line', source: 'walk-buffer', paint: { 'line-color': '#c85d45', 'line-width': 2, 'line-dasharray': [2, 2], 'line-opacity': .8 } });
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
    ORIGIN.longitude = e.lngLat.lng; ORIGIN.latitude = e.lngLat.lat; state.pickOrigin = false; $('locate-origin').textContent = '⌖  SET ON MAP';
    state.isochrone = null; render();
    showToast(state.google ? 'Origin updated. Recalculating Google walking-time reach.' : 'Origin moved. Demo routes stay illustrative until the Google backend is configured.');
    if (state.google) scheduleGoogleAnalysis();
  });
  map.on('move', renderMapLibreSvgRoutes); map.on('resize', renderMapLibreSvgRoutes); map.on('idle', renderMapLibreSvgRoutes);
  renderMapLibreOverlays();
}
function initMapLibre() {
  if (!window.maplibregl) { showToast('The 3D map library did not load. Check the connection and refresh.'); return; }
  const map = new maplibregl.Map({ container: 'maplibre-container', style: 'https://tiles.openfreemap.org/styles/liberty', center: [ORIGIN.longitude, ORIGIN.latitude], zoom: 15.6, pitch: 48, bearing: -17, maxPitch: 70, attributionControl: true, antialias: true, cooperativeGestures: true });
  state.maplibre = map;
  map.addControl(new maplibregl.NavigationControl({ showCompass: false, showZoom: false }), 'top-right');
  map.on('load', () => {
    try { addMapLibreLayers(map); }
    catch (error) { console.error('Could not add 3D building layer', error); showToast('Map loaded, but building extrusions are unavailable.'); }
    $('maplibre-container').style.display = 'block';
    $('data-status').textContent = state.places.every(p => p.demo) || state.places.every(p => !p.demo && DEMO_PLACES.some(d => d.id === p.id)) ? 'OPENSTREETMAP 3D BUILDINGS · DEMO TARGETS' : 'OPENSTREETMAP 3D BUILDINGS · HONG KONG DATA';
    $('map-data-label').textContent = '3D BUILDINGS · OSM STREET MAP'; $('map-attribution').textContent = '© OPENFREEMAP · © OPENSTREETMAP CONTRIBUTORS';
    map.once('idle', renderMapLibreOverlays);
  });
  map.on('error', e => { if (e.error) console.warn('MapLibre tile/style issue:', e.error.message); });
}
async function initGoogle() {
  try {
    const config = await fetch(apiUrl('config')).then(r => r.json());
    if (!config.google_enabled || !window.Cesium) { initMapLibre(); return; }
    state.google = true;
    const viewer = new Cesium.Viewer('cesium-container', { animation: false, baseLayerPicker: false, fullscreenButton: false, geocoder: false, homeButton: false, infoBox: false, sceneModePicker: false, selectionIndicator: false, timeline: false, navigationHelpButton: false, creditContainer: document.createElement('div'), skyAtmosphere: new Cesium.SkyAtmosphere(), baseLayer: false });
    viewer.scene.globe.show = false; viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#d4ded4');
    viewer.scene.screenSpaceCameraController.enableCollisionDetection = false;
    const tiles = await Cesium.Cesium3DTileset.fromUrl(apiUrl('google-3d-tiles/v1/3dtiles/root.json'));
    viewer.scene.primitives.add(tiles);
    viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(114.1285, 22.2833, 1450), orientation: { heading: Cesium.Math.toRadians(12), pitch: Cesium.Math.toRadians(-48), roll: 0 } });
    viewer.scene.globe.depthTestAgainstTerrain = true;
    state.map = viewer;
    $('cesium-container').style.display = 'block';
    $('data-status').textContent = 'GOOGLE 3D TILES · OPEN DATA LAYERS'; $('map-data-label').textContent = 'GOOGLE PHOTOREALISTIC 3D';
    $('map-attribution').textContent = 'POWERED BY GOOGLE, ©2026 · 3D MAP DATA';
    renderCesiumOverlays();
    new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas).setInputAction((evt) => {
      if (!state.pickOrigin) return;
      const ray = viewer.camera.getPickRay(evt.position); const point = viewer.scene.globe.pick(ray, viewer.scene);
      if (!point) return;
      const carto = Cesium.Cartographic.fromCartesian(point); ORIGIN.latitude = Cesium.Math.toDegrees(carto.latitude); ORIGIN.longitude = Cesium.Math.toDegrees(carto.longitude); state.pickOrigin = false; $('locate-origin').textContent = '⌖  SET ON MAP'; showToast('Origin updated. Recalculating walking routes.'); scheduleGoogleAnalysis();
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    scheduleGoogleAnalysis();
  } catch (error) { console.warn('Google 3D Tiles unavailable; starting the OpenStreetMap 3D view.', error); if (!state.map) initMapLibre(); }
}
let requestTimer;
function scheduleGoogleAnalysis() { clearTimeout(requestTimer); requestTimer = setTimeout(runGoogleAnalysis, 700); }
async function runGoogleAnalysis() {
  if (!state.google) return;
  const destinations = state.places.map(p => ({ id: p.id, name: p.name, kind: p.kind, latitude: p.coordinates?.[1] ?? { 'green-1':22.2843,'green-2':22.2824,'green-3':22.2846,'gym-1':22.2817,'gym-2':22.2850 }[p.id], longitude: p.coordinates?.[0] ?? { 'green-1':114.1280,'green-2':114.1305,'green-3':114.1247,'gym-1':114.1262,'gym-2':114.1312 }[p.id] }));
  try {
    const request = { origin: { latitude: ORIGIN.latitude, longitude: ORIGIN.longitude }, destinations, time_minutes: state.timeMinutes, max_slope_deg: state.slope };
    const [response, reachResponse] = await Promise.all([
      fetch(apiUrl('analyze'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) }),
      fetch(apiUrl('isochrone'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) }),
    ]);
    if (!response.ok) throw new Error(await response.text());
    const payload = await response.json();
    const reach = reachResponse.ok ? await reachResponse.json() : null;
    state.places = payload.results.map(result => {
      const old = DEMO_PLACES.find(p => p.id === result.id);
      return { ...old, ...result, googleAnalysis: true, minutes: result.duration_s / 60, coordinates: result.path?.length ? [result.path.at(-1)[0], result.path.at(-1)[1]] : old?.coordinates, xy: old?.xy || [590, 470] };
    });
    state.isochrone = reach?.feature || null;
    $('data-status').textContent = 'GOOGLE WALKING REACH · ROUTES + ELEVATION'; render();
  } catch (error) { showToast('Route service unavailable. Showing illustrative demo routes.'); console.warn('Route analysis failed', error); }
}
function setDemo() { state.places = structuredClone(DEMO_PLACES); render(); }

$('distance').addEventListener('input', setRange); $('slope').addEventListener('input', setRange);
  document.querySelectorAll('.filter').forEach(b => b.addEventListener('click', () => { state.filter = b.dataset.filter; document.querySelectorAll('.filter').forEach(item => item.classList.toggle('active', item === b)); render(); }));
document.querySelectorAll('.view-option').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
$('about-btn').addEventListener('click', () => $('about-dialog').showModal()); $('source-btn').addEventListener('click', () => $('about-dialog').showModal());
document.querySelector('.dialog-close').addEventListener('click', () => $('about-dialog').close()); $('about-dialog').addEventListener('click', e => { if (e.target === $('about-dialog')) $('about-dialog').close(); });
$('locate-origin').addEventListener('click', () => { if (!state.map && !state.maplibre) return showToast('The map is still loading.'); state.pickOrigin = true; $('locate-origin').textContent = 'CLICK MAP TO SET'; showToast('Click the map to move the origin.'); });
$('zoom-in').addEventListener('click', () => { if (state.map) state.map.camera.zoomIn(250); else if (state.maplibre) state.maplibre.zoomIn({ duration: 250 }); });
$('zoom-out').addEventListener('click', () => { if (state.map) state.map.camera.zoomOut(250); else if (state.maplibre) state.maplibre.zoomOut({ duration: 250 }); });
$('reset-view').addEventListener('click', () => { if (state.map) setView(state.view); else if (state.maplibre) state.maplibre.flyTo({ center: [ORIGIN.longitude, ORIGIN.latitude], zoom: 15.6, pitch: state.view === 'terrain' ? 48 : 30, bearing: state.view === 'terrain' ? -17 : 0, duration: 700 }); });
setRange(); loadAccessPoints().then(initGoogle);

const DEMO_PLACES = [
  { id: 'green-1', name: 'Cadogan Street Garden', kind: 'green', distance_m: 260, max_slope_deg: 4.5, minutes: 4, xy: [540, 404], bend: [535, 442] },
  { id: 'green-2', name: 'Smithfield Sitting-out Area', kind: 'green', distance_m: 410, max_slope_deg: 8.7, minutes: 7, xy: [686, 424], bend: [639, 425] },
  { id: 'green-3', name: 'Belcher Bay Promenade', kind: 'green', distance_m: 575, max_slope_deg: 12.5, minutes: 10, xy: [481, 545], bend: [515, 503] },
  { id: 'gym-1', name: 'Kennedy Town Outdoor Fitness Station', kind: 'gym', distance_m: 330, max_slope_deg: 6.1, minutes: 6, xy: [619, 548], bend: [581, 528] },
  { id: 'gym-2', name: 'Sai Woo Lane Fitness Corner', kind: 'gym', distance_m: 520, max_slope_deg: 15.5, minutes: 9, xy: [704, 354], bend: [648, 382] },
];
const ORIGIN = { latitude: 22.2833, longitude: 114.1285 };
const $ = (id) => document.getElementById(id);
const state = { radius: 300, slope: 10, filter: 'all', view: 'terrain', places: structuredClone(DEMO_PLACES), google: false, map: null, routeEntities: [], markerEntities: [], zoom: 1, pickOrigin: false };

function formatDistance(m) { return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`; }
function accessible(p) { return p.accessible != null ? p.accessible : p.distance_m <= state.radius && p.max_slope_deg <= state.slope; }
function status(p) {
  if (p.distance_m > state.radius) return ['OUT OF REACH', 'outside'];
  if (p.max_slope_deg > state.slope) return [`${p.max_slope_deg.toFixed(1)}° SLOPE`, 'steep'];
  return ['IN REACH', ''];
}
function updateSliderPaint(input) {
  const pct = ((Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min))) * 100;
  const color = input.id === 'distance' ? 'var(--rust)' : 'var(--pine)';
  input.style.background = `linear-gradient(to right,${color} 0%,${color} ${pct}%,#dcded5 ${pct}%,#dcded5 100%)`;
}
function setRange() {
  state.radius = Number($('distance').value); state.slope = Number($('slope').value);
  $('distance-value').textContent = state.radius; $('slope-value').textContent = state.slope;
  $('caption-distance').textContent = state.radius;
  $('walk-time').textContent = `${Math.max(2, Math.round(state.radius / 60))} min`;
  updateSliderPaint($('distance')); updateSliderPaint($('slope'));
  render();
  if (state.google) scheduleGoogleAnalysis();
}
function renderList() {
  const visible = state.places.filter(p => state.filter === 'all' || p.kind === state.filter);
  $('place-list').innerHTML = visible.map(p => {
    const [label, cls] = status(p);
    const icon = p.kind === 'green' ? '♧' : '✳';
    const extra = `${formatDistance(p.distance_m)} walk${p.max_slope_deg != null ? ` · ${p.max_slope_deg.toFixed(1)}° max` : ''}`;
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
  const classes = accessible(p) ? 'route' : (p.max_slope_deg > state.slope && p.distance_m <= state.radius ? 'route route-steep' : 'route route-outside');
  return `<path class="${classes}" data-route="${p.id}" d="${d}"/>`;
}
function pinMarkup(p) {
  const [x, y] = p.xy;
  const cls = p.kind === 'green' ? 'green-dot' : 'gym-dot';
  const glyph = p.kind === 'green' ? '♧' : '✳';
  const [label, statusClass] = status(p);
  const opacity = p.distance_m > state.radius ? '.53' : '1';
  return `<g class="place-pin" data-id="${p.id}" opacity="${opacity}" transform="translate(${x} ${y})"><circle class="pin-halo" r="15"/><circle class="pin-dot ${cls}" r="9"/><text text-anchor="middle" y="3.5" fill="white" font-size="10">${glyph}</text><text class="pin-label" x="13" y="-8">${p.name}</text>${statusClass === 'steep' ? `<text x="13" y="7" fill="#a24634" font-size="8" font-family="DM Mono">SLOPE ${p.max_slope_deg.toFixed(1)}°</text>` : ''}</g>`;
}
function renderSvg() {
  const ringRadius = Math.max(15, state.radius * .13);
  const routeLines = state.places.map(linePath).join('');
  $('route-layer').innerHTML = `<ellipse class="ring" cx="590" cy="470" rx="${ringRadius * 1.2}" ry="${ringRadius * .77}"/><path class="route" d="M 590 470 L 590 452"/>${routeLines}`;
  $('pin-layer').innerHTML = `<g transform="translate(590 470)"><circle class="pin-halo" r="18"/><circle class="pin-dot origin-dot" r="11"/><text class="origin-label" x="16" y="-12">COMMUNITY CENTRE</text></g>${state.places.map(pinMarkup).join('')}`;
  document.querySelectorAll('.place-pin').forEach(el => el.addEventListener('click', () => focusPlace(el.dataset.id)));
  document.querySelectorAll('.route').forEach(el => { if (el.dataset.route) el.classList.toggle('inactive', !accessible(state.places.find(p => p.id === el.dataset.route))); });
}
function render() { renderList(); renderSvg(); renderCesiumOverlays(); }
function pointFromFeature(feature) {
  const geom = feature.geometry; if (!geom) return null;
  if (geom.type === 'Point') return geom.coordinates;
  const ring = geom.type === 'Polygon' ? geom.coordinates?.[0] : geom.type === 'MultiPolygon' ? geom.coordinates?.[0]?.[0] : null;
  if (!ring?.length) return null;
  return [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];
}
async function loadAccessPoints() {
  try {
    const collection = await fetch('/api/access-points').then(r => { if (!r.ok) throw new Error('GeoJSON not available'); return r.json(); });
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
  $('place-list').querySelector(`[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  showToast(`${place.name} · ${formatDistance(place.distance_m)} walking route`);
  if (state.map && place.coordinates) state.map.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(place.coordinates[0], place.coordinates[1], 950), duration: 1.2 });
}
let toastTimer;
function showToast(message) { const el = $('toast'); el.textContent = message; el.classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('visible'), 2300); }
function setView(mode) {
  state.view = mode;
  document.querySelectorAll('.view-option').forEach(b => b.classList.toggle('selected', b.dataset.view === mode));
  document.querySelector('.map-shell').classList.toggle('diagram-mode', mode === 'diagram');
  if (state.map) { state.map.scene.screenSpaceCameraController.enableTilt = mode === 'terrain'; state.map.scene.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(114.1285, 22.2833, mode === 'terrain' ? 1400 : 2400), orientation: { heading: 0, pitch: mode === 'terrain' ? Cesium.Math.toRadians(-48) : Cesium.Math.toRadians(-68), roll: 0 }, duration: .7 }); }
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
  const semi = Math.max(100, state.radius);
  state.routeEntities.push(state.map.entities.add({ position: Cesium.Cartesian3.fromDegrees(ORIGIN.longitude, ORIGIN.latitude), ellipse: { semiMajorAxis: semi, semiMinorAxis: semi, material: Cesium.Color.fromCssColorString('#cb5237').withAlpha(.08), outline: true, outlineColor: Cesium.Color.fromCssColorString('#cb5237').withAlpha(.8), outlineWidth: 2, height: 10 } }));
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
async function initGoogle() {
  try {
    const config = await fetch('/api/config').then(r => r.json());
    if (!config.google_enabled || !window.Cesium) return;
    state.google = true;
    const viewer = new Cesium.Viewer('cesium-container', { animation: false, baseLayerPicker: false, fullscreenButton: false, geocoder: false, homeButton: false, infoBox: false, sceneModePicker: false, selectionIndicator: false, timeline: false, navigationHelpButton: false, creditContainer: document.createElement('div'), skyAtmosphere: new Cesium.SkyAtmosphere(), baseLayer: false });
    viewer.scene.globe.show = false; viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#d4ded4');
    viewer.scene.screenSpaceCameraController.enableCollisionDetection = false;
    const tiles = await Cesium.Cesium3DTileset.fromUrl('/api/google-3d-tiles/v1/3dtiles/root.json');
    viewer.scene.primitives.add(tiles);
    viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(114.1285, 22.2833, 1450), orientation: { heading: Cesium.Math.toRadians(12), pitch: Cesium.Math.toRadians(-48), roll: 0 } });
    viewer.scene.globe.depthTestAgainstTerrain = true;
    state.map = viewer;
    $('cesium-container').style.display = 'block'; $('demo-terrain').style.display = 'none';
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
  } catch (error) { console.warn('Google 3D Tiles unavailable; using illustrative map.', error); }
}
let requestTimer;
function scheduleGoogleAnalysis() { clearTimeout(requestTimer); requestTimer = setTimeout(runGoogleAnalysis, 700); }
async function runGoogleAnalysis() {
  if (!state.google) return;
  const destinations = state.places.map(p => ({ id: p.id, name: p.name, kind: p.kind, latitude: p.coordinates?.[1] ?? { 'green-1':22.2843,'green-2':22.2824,'green-3':22.2846,'gym-1':22.2817,'gym-2':22.2850 }[p.id], longitude: p.coordinates?.[0] ?? { 'green-1':114.1280,'green-2':114.1305,'green-3':114.1247,'gym-1':114.1262,'gym-2':114.1312 }[p.id] }));
  try {
    const response = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ origin: { latitude: ORIGIN.latitude, longitude: ORIGIN.longitude }, destinations, radius_m: state.radius, max_slope_deg: state.slope }) });
    if (!response.ok) throw new Error(await response.text());
    const payload = await response.json();
    state.places = payload.results.map(result => {
      const old = DEMO_PLACES.find(p => p.id === result.id);
      return { ...old, ...result, coordinates: result.path?.length ? [result.path.at(-1)[0], result.path.at(-1)[1]] : old?.coordinates, xy: old?.xy || [590, 470] };
    });
    $('data-status').textContent = 'GOOGLE ROUTES + ELEVATION · DEMO PLACE DATA'; render();
  } catch (error) { showToast('Route service unavailable. Showing illustrative demo routes.'); console.warn('Route analysis failed', error); }
}
function setDemo() { state.places = structuredClone(DEMO_PLACES); render(); }

$('distance').addEventListener('input', setRange); $('slope').addEventListener('input', setRange);
document.querySelectorAll('.filter').forEach(b => b.addEventListener('click', () => { state.filter = b.dataset.filter; document.querySelectorAll('.filter').forEach(item => item.classList.toggle('active', item === b)); renderList(); }));
document.querySelectorAll('.view-option').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
$('about-btn').addEventListener('click', () => $('about-dialog').showModal()); $('source-btn').addEventListener('click', () => $('about-dialog').showModal());
document.querySelector('.dialog-close').addEventListener('click', () => $('about-dialog').close()); $('about-dialog').addEventListener('click', e => { if (e.target === $('about-dialog')) $('about-dialog').close(); });
$('locate-origin').addEventListener('click', () => { if (!state.map) return showToast('Choose a point on the map after enabling Google 3D Tiles.'); state.pickOrigin = true; $('locate-origin').textContent = 'CLICK MAP TO SET'; showToast('Click the map to place the origin.'); });
$('zoom-in').addEventListener('click', () => { if (state.map) state.map.camera.zoomIn(250); else { state.zoom = Math.min(1.6, state.zoom + .12); $('demo-terrain').style.transform = `scale(${state.zoom})`; } });
$('zoom-out').addEventListener('click', () => { if (state.map) state.map.camera.zoomOut(250); else { state.zoom = Math.max(.8, state.zoom - .12); $('demo-terrain').style.transform = `scale(${state.zoom})`; } });
$('reset-view').addEventListener('click', () => { state.zoom = 1; $('demo-terrain').style.transform = ''; if (state.map) setView(state.view); else showToast('Map view reset.'); });
setRange(); loadAccessPoints().then(initGoogle);

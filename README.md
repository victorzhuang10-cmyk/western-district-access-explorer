# Western District Age-Friendly Access Explorer

An interactive 3D walking-accessibility prototype for public green space and outdoor fitness facilities around the Western District Elderly Community Centre in Hong Kong.

## Open the site

- Public preview: <https://victorzhuang10-cmyk.github.io/western-district-access-explorer/>
- Public source repository: <https://github.com/victorzhuang10-cmyk/western-district-access-explorer>

The preview uses an OpenStreetMap/OpenFreeMap 3D vector map with extruded building footprints, controls for a 2–30 minute walking-time threshold and a 3–20° maximum sampled slope, and selectable city, access-diagram, and route-section presentations. The sample destinations and routes are illustrative. The preview does not pretend to have Google walking results when no backend is connected.

## Run the full app locally

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Add GOOGLE_MAPS_API_KEY to .env, then:
uvicorn app:app --reload
```

Open <http://127.0.0.1:8000>. The FastAPI service keeps the Google key on the server and provides Google Routes walking directions, route elevation samples, a sampled walking-time contour, and Google Photorealistic 3D Tiles. Enable the Map Tiles API, Routes API, and Elevation API in the Google Cloud project and configure billing and key restrictions. Never commit `.env`.

GitHub Pages hosts only the static preview; it does not run FastAPI or provide server secrets. Google routes, elevation filtering, Google Photorealistic 3D Tiles, and server-loaded Hong Kong data are available only on a deployment with the backend and a configured key.

## Data workflow

`notebooks/prepare_access_data.ipynb` uses GeoPandas to inspect CSDI / GeoInfo and DATA.GOV.HK layers, project them to Hong Kong 1980 Grid (EPSG:2326), request the app's walking-time contour, clip green-space polygons and outdoor-fitness locations to that contour, and export web-ready GeoJSON. Download source records into `data/source/`, check the schema and CRS, verify the community-centre entrance, and record source URLs, retrieval dates, and licence metadata. The checked-in `static/data/access-points.geojson` is illustrative only.

Install the optional notebook tools with `pip install -r requirements-gis.txt`. The notebook expects the configured local API to provide a walking contour; it does not make Google API calls until you explicitly request and save that response.

## How the access screening works

Google Routes computes walking travel time and route geometry. The app samples elevation along each route and estimates the steepest absolute segment angle as `atan(abs(Δelevation) / horizontal distance)`. The contour endpoint samples Google walking routes across 24 directions and checks candidate edge routes against the time and slope thresholds. This is a sampled approximation of walkable reach, not a complete pedestrian-network isochrone; it can miss alleys, route alternatives, stairs, kerbs, crossing quality, surface condition, closures, and step-free entrances. Elevation resolution may miss short ramps or steps. Field checks and a verified pedestrian network are needed before product or policy decisions.

The 3D section is based on Google route elevation samples when the service is configured. Its fallback profile is explicitly marked illustrative. Treat every result as exploratory, not as an accessibility certification. Google map data must retain required attribution and be used under the applicable Maps Platform terms.

## Sources

- Hong Kong GeoData Store / CSDI: <https://portal.csdi.gov.hk/>
- DATA.GOV.HK outdoor fitness equipment: <https://data.gov.hk/en-data/dataset/hk-lcsd-facility-facility-ofe/resource/75a32704-f3d7-4a53-935e-b946fc8c8078>
